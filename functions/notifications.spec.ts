import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handler } from './notifications';
import {
  MAX_CONCURRENT_CMA_REQUESTS,
  TASK_BODY_MAX_BYTES,
  utf8ByteLength,
} from '../shared/contract';

// Matches the real Workflow.save app event payload (WorkflowProps): stepId is
// top-level, while entry and workflowDefinition links live under sys.
const baseEvent = (bodyOverrides: Record<string, any> = {}) =>
  ({
    body: {
      sys: {
        id: 'workflow-instance-1',
        type: 'Workflow',
        entity: { sys: { type: 'Link', linkType: 'Entry', id: 'entry-1' } },
        workflowDefinition: {
          sys: { type: 'Link', linkType: 'WorkflowDefinition', id: 'wf-1' },
        },
      },
      stepId: 'step-approved',
      ...bodyOverrides,
    },
  }) as any;

const makeCma = (overrides: Record<string, any> = {}) => ({
  entry: { get: vi.fn(), ...overrides.entry },
  task: {
    create: vi.fn().mockResolvedValue({}),
    getMany: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    ...overrides.task,
  },
});

// Field IDs live in installation parameters as of the ConfigScreen refactor.
// Tests use names that mirror the project's prior defaults so the fixtures
// stay readable.
const FIELD_IDS = {
  pageTitleFieldId: 'pageTitle',
  pageStakeholderFieldId: 'stakeholderRefs',
  stakeholderMemberFieldId: 'members',
};

const MATCHING_TRIGGER = [
  { workflowDefinitionId: 'wf-1', stepId: 'step-approved' },
];

const baseContext = (
  cma: any,
  triggers: Array<{ workflowDefinitionId: string; stepId: string }>,
  paramOverrides: Record<string, any> = {}
) =>
  ({
    spaceId: 'space-1',
    environmentId: 'env-1',
    cma,
    appInstallationParameters: {
      triggers,
      ...FIELD_IDS,
      ...paramOverrides,
    },
  }) as any;

const member = (userId: string, firstName = 'Ada', lastName = 'Lovelace') => ({
  userId,
  firstName,
  lastName,
});

const entryWith = (title: unknown, refIds: string[]) => ({
  fields: {
    pageTitle: { 'en-US': title },
    stakeholderRefs: {
      'en-US': refIds.map((id) => ({ sys: { id } })),
    },
  },
});

const refWith = (...members: Array<ReturnType<typeof member>>) => ({
  fields: { members: { 'en-US': members } },
});

/** Routes entry.get by id, rejecting for ids given in `failing`. */
const entryRouter = (
  entries: Record<string, unknown>,
  failing: Record<string, unknown> = {}
) =>
  vi.fn().mockImplementation(({ entryId }: { entryId: string }) => {
    if (entryId in failing) {
      return Promise.reject(failing[entryId]);
    }
    if (entryId in entries) {
      return Promise.resolve(entries[entryId]);
    }
    return Promise.reject(new Error(`unexpected entry id ${entryId}`));
  });

const assigneesOf = (cma: any): string[] =>
  cma.task.create.mock.calls.map(([, payload]: any[]) => payload.assignedTo.sys.id);

/**
 * A `vi.fn()` that never settles on its own, and records the highest number of
 * calls in flight at once. Concurrency is invisible to a mock that resolves
 * immediately — the microtask queue drains each call before the next starts, so
 * even a fully sequential implementation would look parallel. Holding every
 * call open is the only way to observe the real overlap.
 */
const makeConcurrencyProbe = (resolveWith: (arg: any) => unknown = () => ({})) => {
  const pending: Array<() => void> = [];
  let inFlight = 0;
  let peak = 0;
  const fn = vi.fn().mockImplementation((arg: any) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    return new Promise((resolve) => {
      pending.push(() => {
        inFlight -= 1;
        resolve(resolveWith(arg));
      });
    });
  });
  return {
    fn,
    get peak() {
      return peak;
    },
    /**
     * Releases open calls until `promise` settles. Driven by the handler's
     * completion rather than by `pending` running dry, because the handler
     * awaits unprobed calls (`task.getMany`) between batches — a loop that
     * stopped at the first empty queue would abandon it mid-run.
     */
    async drain(result: void | Promise<unknown>) {
      // The handler's declared return type allows a synchronous void.
      const promise = Promise.resolve(result);
      let settled = false;
      const finish = () => {
        settled = true;
      };
      promise.then(finish, finish);
      while (!settled) {
        pending.splice(0).forEach((release) => release());
        // A macrotask yield outruns any microtask chain in the handler.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return promise;
    },
  };
};

const bodiesOf = (cma: any): string[] =>
  cma.task.create.mock.calls.map(([, payload]: any[]) => payload.body);

beforeEach(() => {
  // The handler narrates every decision on console.info by design; keep it out
  // of the test report. Tests that assert on warnings spy on console.warn
  // themselves.
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('notifications handler', () => {
  it('no-ops when no triggers are configured', async () => {
    const cma = makeCma();
    await handler(baseEvent(), baseContext(cma, []));
    expect(cma.entry.get).not.toHaveBeenCalled();
    expect(cma.task.create).not.toHaveBeenCalled();
  });

  it('no-ops when the step does not match a configured trigger', async () => {
    const cma = makeCma();
    await handler(
      baseEvent(),
      baseContext(cma, [{ workflowDefinitionId: 'wf-1', stepId: 'step-draft' }])
    );
    expect(cma.entry.get).not.toHaveBeenCalled();
    expect(cma.task.create).not.toHaveBeenCalled();
  });

  it('bails when any required field id is missing from parameters', async () => {
    const cma = makeCma();
    await handler(
      baseEvent(),
      baseContext(cma, MATCHING_TRIGGER, { pageTitleFieldId: '' })
    );
    expect(cma.entry.get).not.toHaveBeenCalled();
    expect(cma.task.create).not.toHaveBeenCalled();
  });

  it('bails when the CMA client is unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await handler(baseEvent(), {
      spaceId: 'space-1',
      environmentId: 'env-1',
      appInstallationParameters: { triggers: MATCHING_TRIGGER, ...FIELD_IDS },
    } as any);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('context.cma is unavailable')
    );
  });

  it('fans out one task per unique stakeholder across linked entries', async () => {
    const cma = makeCma({
      entry: {
        get: entryRouter({
          'entry-1': entryWith('Summer Campaign', ['ref-a', 'ref-b']),
          'ref-a': refWith(member('user-1'), member('user-2', 'Alan', 'Turing')),
          // user-1 appears on both refs; should only get one task.
          'ref-b': refWith(member('user-1'), member('user-3', 'Grace', 'Hopper')),
        }),
      },
    });

    await handler(baseEvent(), baseContext(cma, MATCHING_TRIGGER));

    expect(cma.task.create).toHaveBeenCalledTimes(3);
    expect(new Set(assigneesOf(cma))).toEqual(
      new Set(['user-1', 'user-2', 'user-3'])
    );
    expect(
      bodiesOf(cma).every((b) => b === 'Summer Campaign is ready for your review.')
    ).toBe(true);
  });

  it('no-ops when the entry has no linked stakeholder references', async () => {
    const cma = makeCma({
      entry: { get: entryRouter({ 'entry-1': entryWith('No References', []) }) },
    });

    await handler(baseEvent(), baseContext(cma, MATCHING_TRIGGER));
    expect(cma.task.create).not.toHaveBeenCalled();
  });

  it('still notifies the readable stakeholders when one linked entry is unreadable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cma = makeCma({
      entry: {
        get: entryRouter(
          {
            'entry-1': entryWith('Partly Broken', ['ref-a', 'ref-gone']),
            'ref-a': refWith(member('user-1')),
          },
          { 'ref-gone': new Error('notFound') }
        ),
      },
    });

    await handler(baseEvent(), baseContext(cma, MATCHING_TRIGGER));

    expect(assigneesOf(cma)).toEqual(['user-1']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('skipping unreadable stakeholder entry ref-gone'),
      expect.stringContaining('notFound')
    );
  });

  it('aborts with a log when the triggering entry cannot be fetched', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cma = makeCma({
      entry: { get: vi.fn().mockRejectedValue({ remote: true }) },
    });

    await handler(baseEvent(), baseContext(cma, MATCHING_TRIGGER));

    expect(cma.task.create).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not fetch triggering entry entry-1'),
      expect.stringContaining('remote')
    );
  });

  it('aborts when the configured stakeholder field is not a list of references', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cma = makeCma({
      entry: {
        get: entryRouter({
          'entry-1': {
            fields: {
              pageTitle: { 'en-US': 'Single Ref' },
              stakeholderRefs: { 'en-US': { sys: { id: 'ref-a' } } },
            },
          },
        }),
      },
    });

    await handler(baseEvent(), baseContext(cma, MATCHING_TRIGGER));

    expect(cma.task.create).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('is not a list of references')
    );
  });

  it('falls back to (untitled) when the title field is missing or blank', async () => {
    const cma = makeCma({
      entry: {
        get: entryRouter({
          'entry-1': entryWith('   ', ['ref-a']),
          'ref-a': refWith(member('user-1')),
        }),
      },
    });

    await handler(baseEvent(), baseContext(cma, MATCHING_TRIGGER));

    expect(bodiesOf(cma)).toEqual(['(untitled) is ready for your review.']);
  });

  it('truncates the task body to the CMA 512-byte limit', async () => {
    const cma = makeCma({
      entry: {
        get: entryRouter({
          'entry-1': entryWith('é'.repeat(600), ['ref-a']),
          'ref-a': refWith(member('user-1')),
        }),
      },
    });

    await handler(baseEvent(), baseContext(cma, MATCHING_TRIGGER));

    const [body] = bodiesOf(cma);
    expect(utf8ByteLength(body)).toBeLessThanOrEqual(TASK_BODY_MAX_BYTES);
    expect(body.endsWith(' is ready for your review.')).toBe(true);
  });

  it('skips stakeholders who already have an open review task on the entry', async () => {
    const cma = makeCma({
      entry: {
        get: entryRouter({
          'entry-1': entryWith('Repeat Visit', ['ref-a']),
          'ref-a': refWith(member('user-1'), member('user-2')),
        }),
      },
      task: {
        getMany: vi.fn().mockResolvedValue({
          items: [
            {
              status: 'active',
              body: 'Repeat Visit is ready for your review.',
              assignedTo: { sys: { id: 'user-1' } },
            },
            {
              // resolved tasks must not suppress a fresh request
              status: 'resolved',
              body: 'Repeat Visit is ready for your review.',
              assignedTo: { sys: { id: 'user-2' } },
            },
          ],
          total: 2,
        }),
      },
    });

    await handler(baseEvent(), baseContext(cma, MATCHING_TRIGGER));

    expect(assigneesOf(cma)).toEqual(['user-2']);
  });

  it('creates nothing when every stakeholder already has an open task', async () => {
    const cma = makeCma({
      entry: {
        get: entryRouter({
          'entry-1': entryWith('Already Sent', ['ref-a']),
          'ref-a': refWith(member('user-1')),
        }),
      },
      task: {
        getMany: vi.fn().mockResolvedValue({
          items: [
            {
              status: 'active',
              body: 'Already Sent is ready for your review.',
              assignedTo: { sys: { id: 'user-1' } },
            },
          ],
          total: 1,
        }),
      },
    });

    await handler(baseEvent(), baseContext(cma, MATCHING_TRIGGER));

    expect(cma.task.create).not.toHaveBeenCalled();
  });

  it('respects the 100-task-per-entry limit and logs who was left out', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cma = makeCma({
      entry: {
        get: entryRouter({
          'entry-1': entryWith('Crowded', ['ref-a']),
          'ref-a': refWith(member('user-1'), member('user-2'), member('user-3')),
        }),
      },
      task: { getMany: vi.fn().mockResolvedValue({ items: [], total: 99 }) },
    });

    await handler(baseEvent(), baseContext(cma, MATCHING_TRIGGER));

    expect(cma.task.create).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('not notified: user-2, user-3')
    );
  });

  it('still notifies when existing tasks cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cma = makeCma({
      entry: {
        get: entryRouter({
          'entry-1': entryWith('Unknown State', ['ref-a']),
          'ref-a': refWith(member('user-1')),
        }),
      },
      task: { getMany: vi.fn().mockRejectedValue(new Error('403')) },
    });

    await handler(baseEvent(), baseContext(cma, MATCHING_TRIGGER));

    expect(assigneesOf(cma)).toEqual(['user-1']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('proceeding without duplicate suppression'),
      expect.stringContaining('403')
    );
  });

  it('logs the underlying reason when a task creation fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cma = makeCma({
      entry: {
        get: entryRouter({
          'entry-1': entryWith('Failing Create', ['ref-a']),
          'ref-a': refWith(member('user-1')),
        }),
      },
      task: {
        create: vi.fn().mockRejectedValue(new Error('ValidationFailed: body')),
        getMany: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      },
    });

    await handler(baseEvent(), baseContext(cma, MATCHING_TRIGGER));

    // Guards the bug where the whole results array was passed to
    // JSON.stringify's replacer, which flattened every reason to `{}`.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('task creation failed for user user-1'),
      expect.stringContaining('ValidationFailed: body')
    );
  });

  describe('CMA request concurrency', () => {
    // The CMA allows 7 req/s (free) or 10 (paid), and the web app shares that
    // bucket. An unbounded fan-out over a many-reference entry bursts straight
    // through it; the SDK retries a 429 but serially, so the cost lands on
    // wall-clock against the function execution timeout.
    const manyIds = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => `${prefix}-${i}`);

    it(`fetches linked stakeholder entries at most ${MAX_CONCURRENT_CMA_REQUESTS} at a time`, async () => {
      const refIds = manyIds('ref', 12);
      const probe = makeConcurrencyProbe(({ entryId }) =>
        entryId === 'entry-1'
          ? entryWith('Wide Fanout', refIds)
          : refWith(member(`user-${entryId}`))
      );
      const cma = makeCma({ entry: { get: probe.fn } });

      await probe.drain(
        handler(baseEvent(), baseContext(cma, MATCHING_TRIGGER))
      );

      expect(probe.peak).toBeLessThanOrEqual(MAX_CONCURRENT_CMA_REQUESTS);
      // All 12 refs plus the triggering entry must still be read.
      expect(probe.fn).toHaveBeenCalledTimes(refIds.length + 1);
    });

    it(`creates tasks at most ${MAX_CONCURRENT_CMA_REQUESTS} at a time`, async () => {
      const refIds = ['ref-a'];
      const userIds = manyIds('user', 12);
      const probe = makeConcurrencyProbe();
      const cma = makeCma({
        entry: {
          get: entryRouter({
            'entry-1': entryWith('Many Stakeholders', refIds),
            'ref-a': refWith(...userIds.map((id) => member(id))),
          }),
        },
        task: { create: probe.fn },
      });

      await probe.drain(
        handler(baseEvent(), baseContext(cma, MATCHING_TRIGGER))
      );

      expect(probe.peak).toBeLessThanOrEqual(MAX_CONCURRENT_CMA_REQUESTS);
      expect(new Set(assigneesOf(cma))).toEqual(new Set(userIds));
    });

    it('preserves input order so failures are attributed to the right user', async () => {
      const userIds = manyIds('user', 8);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const cma = makeCma({
        entry: {
          get: entryRouter({
            'entry-1': entryWith('Ordered', ['ref-a']),
            'ref-a': refWith(...userIds.map((id) => member(id))),
          }),
        },
        task: {
          // Fail only the 6th create; a batched implementation that loses order
          // would pin this warning on the wrong stakeholder.
          create: vi.fn().mockImplementation((_params, payload: any) =>
            payload.assignedTo.sys.id === 'user-5'
              ? Promise.reject(new Error('BadRequest: nope'))
              : Promise.resolve({})
          ),
        },
      });

      await handler(baseEvent(), baseContext(cma, MATCHING_TRIGGER));

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('task creation failed for user user-5'),
        expect.stringContaining('BadRequest: nope')
      );
    });

    it('keeps notifying the rest when one request in a batch is rate limited', async () => {
      const userIds = manyIds('user', 9);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const rateLimited = Object.assign(new Error('Rate limit exceeded'), {
        status: 429,
      });
      const cma = makeCma({
        entry: {
          get: entryRouter({
            'entry-1': entryWith('Throttled', ['ref-a']),
            'ref-a': refWith(...userIds.map((id) => member(id))),
          }),
        },
        task: {
          create: vi.fn().mockImplementation((_params, payload: any) =>
            payload.assignedTo.sys.id === 'user-3'
              ? Promise.reject(rateLimited)
              : Promise.resolve({})
          ),
        },
      });

      await handler(baseEvent(), baseContext(cma, MATCHING_TRIGGER));

      // One 429 must not abort the batch or the batches after it.
      expect(cma.task.create).toHaveBeenCalledTimes(userIds.length);
    });
  });
});
