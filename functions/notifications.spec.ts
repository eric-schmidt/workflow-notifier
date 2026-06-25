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

const baseContext = (cma: any, triggers: Array<{ workflowDefinitionId: string; stepId: string }>) =>
  ({
    spaceId: 'space-1',
    environmentId: 'env-1',
    cma,
    appInstallationParameters: { triggers },
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

  it('fans out one task per unique stakeholder across linked brands', async () => {
    const triggerEntry = {
      fields: {
        adminTitle: { 'en-US': 'Summer Campaign' },
        brands: {
          'en-US': [
            { sys: { id: 'brand-a' } },
            { sys: { id: 'brand-b' } },
          ],
        },
      },
    };
    const brandA = {
      fields: {
        stakeholders: {
          'en-US': [
            { userId: 'user-1', firstName: 'Ada', lastName: 'Lovelace' },
            { userId: 'user-2', firstName: 'Alan', lastName: 'Turing' },
          ],
        },
      },
    };
    const brandB = {
      fields: {
        stakeholders: {
          'en-US': [
            // user-1 appears on both brands; should only get one task.
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
            if (entryId === 'brand-a') return Promise.resolve(brandA);
            if (entryId === 'brand-b') return Promise.resolve(brandB);
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

  it('no-ops when the entry has no linked brands', async () => {
    const cma = makeCma({
      entry: {
        get: vi.fn().mockResolvedValue({
          fields: {
            adminTitle: { 'en-US': 'No Brand' },
            brand: { 'en-US': [] },
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
