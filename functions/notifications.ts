// Purpose: App Event handler for Workflow.save / Workflow.create. Reads
// installation triggers and field-id parameters, walks the configured
// stakeholder-reference field on the triggering entry, dedupes stakeholder
// members by userId across the linked entries, and fans out a Task per
// stakeholder. Body shape per WorkflowProps (entity/definition links live
// under sys, stepId at top level). Field IDs are curated on the ConfigScreen
// and persisted as installation parameters; the handler aborts if any are
// missing. Shapes and CMA limits come from ../shared/contract.ts, which the
// ConfigScreen and Field editor import too.
//
// Failure policy: every read is tolerant (skip the bad link, keep notifying
// everyone else) and every early return is logged, because CMA errors inside
// a Function surface as opaque `{ remote: true }` objects — the log is the
// only diagnostic available.

import type {
  FunctionEventHandler as EventHandler,
  FunctionTypeEnum,
} from '@contentful/node-apps-toolkit';
import type { PlainClientAPI } from 'contentful-management';
import {
  AppInstallationParameters,
  MAX_CONCURRENT_CMA_REQUESTS,
  MAX_TASKS_PER_ENTRY,
  Stakeholder,
  UNTITLED_PAGE_TITLE,
  buildTaskBody,
  isReviewRequestBody,
} from '../shared/contract';

/**
 * Installation parameters as the function must treat them: an installation may
 * predate any individual parameter, so nothing is assumed present.
 */
type StoredParameters = Partial<AppInstallationParameters>;

/** `fields` as the CMA returns it: fieldId -> locale -> value. */
type LocalizedFields = Record<string, Record<string, unknown> | undefined>;

type EntryLink = { sys: { id: string } };

/**
 * We treat this app as single-locale: read whichever locale the field defines.
 * Multi-locale stakeholder content would need an explicit locale strategy.
 */
const readFirstLocale = <T>(
  fields: LocalizedFields,
  fieldId: string
): T | undefined => {
  const field = fields[fieldId];
  if (!field) {
    return undefined;
  }
  const locale = Object.keys(field)[0];
  return locale === undefined ? undefined : (field[locale] as T);
};

/**
 * Serializes one rejection for logging. `Error` needs the
 * getOwnPropertyNames dance because `message`/`stack` are non-enumerable —
 * applied to a single error, never to the array of results, or the property
 * allowlist filters every nested object down to `{}`.
 */
const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return JSON.stringify(error, Object.getOwnPropertyNames(error));
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const isEntryLink = (value: unknown): value is EntryLink =>
  typeof (value as EntryLink)?.sys?.id === 'string';

/**
 * `Promise.allSettled` over `items`, but with at most `limit` calls in flight.
 *
 * Results come back in input order regardless of completion order, because the
 * callers log failures by index (`items[i]` named in the warning) — a batched
 * implementation that returned completion order would attribute a failure to
 * the wrong entry or user.
 *
 * Written inline rather than pulled from `p-limit`: this function is bundled by
 * `contentful-app-scripts build-functions`, and extra bundling surface in the
 * Functions runtime fails at module load rather than at build time.
 */
const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> => {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      const [settled] = await Promise.allSettled([fn(items[index])]);
      results[index] = settled;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker)
  );
  return results;
};

export const handler: EventHandler<
  FunctionTypeEnum.AppEventHandler,
  StoredParameters
> = async (event, context) => {
  if (!context.cma) {
    console.warn('notifications: context.cma is unavailable; aborting.');
    return;
  }
  const {
    cma,
    appInstallationParameters: params,
    spaceId,
    environmentId,
  } = context;
  const triggers = params?.triggers ?? [];
  if (!triggers.length) {
    console.info('notifications: no triggers configured; nothing to do.');
    return;
  }

  const pageStakeholderFieldId = params?.pageStakeholderFieldId?.trim();
  const stakeholderMemberFieldId = params?.stakeholderMemberFieldId?.trim();
  const pageTitleFieldId = params?.pageTitleFieldId?.trim();
  if (
    !pageStakeholderFieldId ||
    !stakeholderMemberFieldId ||
    !pageTitleFieldId
  ) {
    console.warn(
      'notifications: installation parameters are missing one or more required field ids; aborting.',
      JSON.stringify({
        pageStakeholderFieldId,
        stakeholderMemberFieldId,
        pageTitleFieldId,
      })
    );
    return;
  }

  // The `Workflow.save` and `Workflow.create` app events both deliver the
  // Workflow entity itself (WorkflowProps from contentful-management):
  //   { sys: { id, type: 'Workflow', entity: Link<Entry>,
  //            workflowDefinition: Link<WorkflowDefinition>, ... },
  //     stepId? }
  // stepId is top-level; entity/workflowDefinition links live under sys.
  const body = event.body as any;
  const stepId: string | undefined = body?.stepId;
  const workflowDefinitionId: string | undefined =
    body?.sys?.workflowDefinition?.sys?.id;
  const entryId: string | undefined = body?.sys?.entity?.sys?.id;

  if (!stepId || !workflowDefinitionId || !entryId) {
    console.warn(
      'notifications: payload missing required fields; aborting.',
      JSON.stringify({ stepId, workflowDefinitionId, entryId })
    );
    return;
  }

  const matches = triggers.some(
    (t) =>
      t.workflowDefinitionId === workflowDefinitionId && t.stepId === stepId
  );
  if (!matches) {
    console.info(
      `notifications: step ${stepId} on workflow ${workflowDefinitionId} is not a configured trigger.`
    );
    return;
  }

  console.info(
    `notifications: triggered for entry ${entryId} (workflow=${workflowDefinitionId}, step=${stepId}).`
  );

  let entryFields: LocalizedFields;
  try {
    const entry = await cma.entry.get({ spaceId, environmentId, entryId });
    entryFields = entry.fields as LocalizedFields;
  } catch (error) {
    console.warn(
      `notifications: could not fetch triggering entry ${entryId}; aborting.`,
      describeError(error)
    );
    return;
  }

  const rawTitle = readFirstLocale<unknown>(entryFields, pageTitleFieldId);
  const pageTitle =
    typeof rawTitle === 'string' && rawTitle.trim()
      ? rawTitle
      : UNTITLED_PAGE_TITLE;

  const rawLinks = readFirstLocale<unknown>(entryFields, pageStakeholderFieldId);
  if (rawLinks !== undefined && !Array.isArray(rawLinks)) {
    console.warn(
      `notifications: field "${pageStakeholderFieldId}" on entry ${entryId} is not a list of references; aborting. Point pageStakeholderFieldId at a multi-reference field.`
    );
    return;
  }
  const stakeholderRefLinks = (rawLinks ?? []).filter(isEntryLink);
  if (!stakeholderRefLinks.length) {
    console.warn(
      `notifications: entry ${entryId} has no linked stakeholder entries on field "${pageStakeholderFieldId}"; nothing to assign.`
    );
    return;
  }

  // Tolerant read: a dangling or unreadable link must cost that one entry's
  // stakeholders, not everybody's notification. Concurrency-capped so a
  // many-reference entry does not burst past the CMA's per-second limit.
  const fetched = await mapWithConcurrency(
    stakeholderRefLinks,
    MAX_CONCURRENT_CMA_REQUESTS,
    (link) => cma.entry.get({ spaceId, environmentId, entryId: link.sys.id })
  );
  fetched.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(
        `notifications: skipping unreadable stakeholder entry ${stakeholderRefLinks[index].sys.id}.`,
        describeError(result.reason)
      );
    }
  });

  const uniqueUserIds = new Set<string>();
  for (const result of fetched) {
    if (result.status !== 'fulfilled') {
      continue;
    }
    const members = readFirstLocale<Stakeholder[]>(
      result.value.fields as LocalizedFields,
      stakeholderMemberFieldId
    );
    for (const member of Array.isArray(members) ? members : []) {
      if (typeof member?.userId === 'string' && member.userId) {
        uniqueUserIds.add(member.userId);
      }
    }
  }
  if (!uniqueUserIds.size) {
    console.warn(
      `notifications: linked stakeholder entries had no members for entry ${entryId}.`
    );
    return;
  }

  const taskBody = buildTaskBody(pageTitle);
  const targetUserIds = await withoutAlreadyNotified(
    cma,
    { spaceId, environmentId, entryId },
    uniqueUserIds
  );
  if (!targetUserIds.length) {
    console.info(
      `notifications: every stakeholder already has an open review task on entry ${entryId}; nothing to do.`
    );
    return;
  }

  console.info(
    `notifications: creating ${targetUserIds.length} task(s) for entry ${entryId}.`
  );

  const results = await mapWithConcurrency(
    targetUserIds,
    MAX_CONCURRENT_CMA_REQUESTS,
    (userId) =>
      cma.task.create(
        { spaceId, environmentId, entryId },
        {
          body: taskBody,
          status: 'active',
          assignedTo: {
            sys: { type: 'Link', linkType: 'User', id: userId },
          },
        }
      )
  );

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(
        `notifications: task creation failed for user ${targetUserIds[index]} on entry ${entryId}.`,
        describeError(result.reason)
      );
    }
  });
  const failures = results.filter((r) => r.status === 'rejected').length;
  if (failures) {
    console.warn(
      `notifications: ${failures}/${results.length} task creations failed for entry ${entryId}.`
    );
  }
};

/**
 * Drops users who already have an open review task on the entry, then caps the
 * remainder to the entry's remaining task capacity.
 *
 * `Workflow.save` fires on every workflow update, so a step can be re-entered
 * and this handler re-run against the same entry; without this the entry
 * accumulates duplicate tasks until it hits the CMA's 100-task ceiling and
 * every further create hard-fails.
 *
 * If the existing tasks can't be read we notify anyway and say so: a duplicate
 * task is a nuisance, a missed review request is a broken feature.
 */
const withoutAlreadyNotified = async (
  cma: PlainClientAPI,
  params: { spaceId: string; environmentId: string; entryId: string },
  userIds: Set<string>
): Promise<string[]> => {
  const { entryId } = params;
  let existing;
  try {
    existing = await cma.task.getMany({
      ...params,
      query: { limit: MAX_TASKS_PER_ENTRY },
    });
  } catch (error) {
    console.warn(
      `notifications: could not read existing tasks on entry ${entryId}; proceeding without duplicate suppression.`,
      describeError(error)
    );
    return [...userIds];
  }

  const alreadyNotified = new Set(
    existing.items
      .filter(
        (task) => task.status === 'active' && isReviewRequestBody(task.body)
      )
      .map((task) => task.assignedTo?.sys?.id)
      .filter((id): id is string => typeof id === 'string')
  );

  const pending = [...userIds].filter((id) => !alreadyNotified.has(id));
  const skipped = userIds.size - pending.length;
  if (skipped) {
    console.info(
      `notifications: ${skipped} stakeholder(s) already have an open review task on entry ${entryId}; skipping them.`
    );
  }

  const capacity = MAX_TASKS_PER_ENTRY - (existing.total ?? existing.items.length);
  if (pending.length <= capacity) {
    return pending;
  }
  console.warn(
    `notifications: entry ${entryId} can take ${Math.max(capacity, 0)} more task(s) of the ${MAX_TASKS_PER_ENTRY}-per-entry CMA limit, but ${pending.length} stakeholder(s) need one. Creating ${Math.max(capacity, 0)}; not notified: ${pending.slice(Math.max(capacity, 0)).join(', ')}.`
  );
  return capacity > 0 ? pending.slice(0, capacity) : [];
};
