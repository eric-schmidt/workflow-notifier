import { describe, expect, it, vi } from 'vitest';
import { handler } from './notifications';

// Matches the real Workflow.save app event payload (WorkflowProps): stepId is
// top-level, while entry and workflowDefinition links live under sys.
const baseEvent = (overrides: Record<string, any> = {}) =>
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
      ...overrides,
    },
  } as any);

const makeCma = (overrides: Record<string, any> = {}) => ({
  entry: { get: vi.fn(), ...overrides.entry },
  task: { create: vi.fn().mockResolvedValue({}), ...overrides.task },
});

// Field IDs live in installation parameters as of the ConfigScreen refactor.
// Tests use names that mirror the project's prior defaults so the fixtures
// stay readable.
const FIELD_IDS = {
  pageTitleFieldId: 'pageTitle',
  pageStakeholderFieldId: 'stakeholderRefs',
  stakeholderMemberFieldId: 'members',
};

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
  } as any);

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
      baseContext(cma, [
        { workflowDefinitionId: 'wf-1', stepId: 'step-draft' },
      ])
    );
    expect(cma.entry.get).not.toHaveBeenCalled();
    expect(cma.task.create).not.toHaveBeenCalled();
  });

  it('bails when any required field id is missing from parameters', async () => {
    const cma = makeCma();
    await handler(
      baseEvent(),
      baseContext(
        cma,
        [{ workflowDefinitionId: 'wf-1', stepId: 'step-approved' }],
        { pageTitleFieldId: '' }
      )
    );
    expect(cma.entry.get).not.toHaveBeenCalled();
    expect(cma.task.create).not.toHaveBeenCalled();
  });

  it('fans out one task per unique stakeholder across linked entries', async () => {
    const triggerEntry = {
      fields: {
        pageTitle: { 'en-US': 'Summer Campaign' },
        stakeholderRefs: {
          'en-US': [
            { sys: { id: 'ref-a' } },
            { sys: { id: 'ref-b' } },
          ],
        },
      },
    };
    const refA = {
      fields: {
        members: {
          'en-US': [
            { userId: 'user-1', firstName: 'Ada', lastName: 'Lovelace' },
            { userId: 'user-2', firstName: 'Alan', lastName: 'Turing' },
          ],
        },
      },
    };
    const refB = {
      fields: {
        members: {
          'en-US': [
            // user-1 appears on both refs; should only get one task.
            { userId: 'user-1', firstName: 'Ada', lastName: 'Lovelace' },
            { userId: 'user-3', firstName: 'Grace', lastName: 'Hopper' },
          ],
        },
      },
    };

    const cma = makeCma({
      entry: {
        get: vi
          .fn()
          .mockImplementation(({ entryId }) => {
            if (entryId === 'entry-1') return Promise.resolve(triggerEntry);
            if (entryId === 'ref-a') return Promise.resolve(refA);
            if (entryId === 'ref-b') return Promise.resolve(refB);
            throw new Error(`unexpected entry id ${entryId}`);
          }),
      },
    });

    await handler(
      baseEvent(),
      baseContext(cma, [
        { workflowDefinitionId: 'wf-1', stepId: 'step-approved' },
      ])
    );

    expect(cma.task.create).toHaveBeenCalledTimes(3);
    const createdAssignees = cma.task.create.mock.calls.map(
      ([, payload]: any[]) => payload.assignedTo.sys.id
    );
    expect(new Set(createdAssignees)).toEqual(
      new Set(['user-1', 'user-2', 'user-3'])
    );
    const bodies = cma.task.create.mock.calls.map(
      ([, payload]: any[]) => payload.body
    );
    expect(bodies.every((b: string) => b === 'Summer Campaign is ready for your review.')).toBe(
      true
    );
  });

  it('no-ops when the entry has no linked stakeholder references', async () => {
    const cma = makeCma({
      entry: {
        get: vi.fn().mockResolvedValue({
          fields: {
            pageTitle: { 'en-US': 'No References' },
            stakeholderRefs: { 'en-US': [] },
          },
        }),
      },
    });

    await handler(
      baseEvent(),
      baseContext(cma, [
        { workflowDefinitionId: 'wf-1', stepId: 'step-approved' },
      ])
    );
    expect(cma.task.create).not.toHaveBeenCalled();
  });
});
