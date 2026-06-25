// Purpose: App Event handler for Workflow.save. Reads installation triggers,
// walks the entry's brands[] links, dedupes stakeholders by userId, and fans
// out a Task per stakeholder. Body shape per WorkflowProps (entry/definition
// links live under sys, stepId at top level).

import type {
  AppEventRequest,
  FunctionEventContext,
  FunctionEventHandler as EventHandler,
  FunctionTypeEnum,
} from '@contentful/node-apps-toolkit';

const TASK_BODY = (adminTitle: string) =>
  `${adminTitle} is ready for your review.`;
const BRAND_FIELD_ID = 'brands';
const STAKEHOLDERS_FIELD_ID = 'stakeholders';
const ADMIN_TITLE_FIELD_ID = 'adminTitle';

export type Trigger = {
  workflowDefinitionId: string;
  stepId: string;
};

export type AppParameters = {
  triggers?: Trigger[];
};

export type Stakeholder = {
  userId: string;
  firstName: string;
  lastName: string;
};

const firstLocale = (
  field: Record<string, unknown> | undefined
): string | undefined => (field ? Object.keys(field)[0] : undefined);

export const handler: EventHandler<FunctionTypeEnum.AppEventHandler> = async (
  event: AppEventRequest,
  context: FunctionEventContext<AppParameters>
) => {
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

  // The `Workflow.save` app event delivers the Workflow entity itself
  // (WorkflowProps from contentful-management):
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

  const entry = await cma.entry.get({ spaceId, environmentId, entryId });

  // We treat this app as single-locale: read whichever locale the field defines.
  // Multi-locale brand stakeholders would need an explicit locale strategy.
  const titleLocale = firstLocale(entry.fields[ADMIN_TITLE_FIELD_ID] as any);
  const adminTitle: string =
    (titleLocale &&
      (entry.fields[ADMIN_TITLE_FIELD_ID] as Record<string, string>)[
        titleLocale
      ]) ||
    '(untitled)';

  const brandLocale = firstLocale(entry.fields[BRAND_FIELD_ID] as any);
  const brandLinks: Array<{ sys: { id: string } }> =
    (brandLocale &&
      (entry.fields[BRAND_FIELD_ID] as Record<
        string,
        Array<{ sys: { id: string } }>
      >)[brandLocale]) ||
    [];
  if (!brandLinks.length) {
    console.warn(
      `notifications: entry ${entryId} has no linked brands; nothing to assign.`
    );
    return;
  }

  const brands = await Promise.all(
    brandLinks.map((l) =>
      cma.entry.get({ spaceId, environmentId, entryId: l.sys.id })
    )
  );

  const uniqueUsers = new Map<string, Stakeholder>();
  for (const brand of brands) {
    const stakeholdersLocale = firstLocale(
      brand.fields[STAKEHOLDERS_FIELD_ID] as any
    );
    const stakeholders: Stakeholder[] =
      (stakeholdersLocale &&
        (brand.fields[STAKEHOLDERS_FIELD_ID] as Record<string, Stakeholder[]>)[
          stakeholdersLocale
        ]) ||
      [];
    for (const s of stakeholders) {
      if (s?.userId) uniqueUsers.set(s.userId, s);
    }
  }
  if (!uniqueUsers.size) {
    console.warn(
      `notifications: linked brands had no stakeholders for entry ${entryId}.`
    );
    return;
  }

  console.info(
    `notifications: creating ${uniqueUsers.size} task(s) for entry ${entryId}.`
  );

  const results = await Promise.allSettled(
    [...uniqueUsers.keys()].map((userId) =>
      cma.task.create(
        { spaceId, environmentId, entryId },
        {
          body: TASK_BODY(adminTitle),
          status: 'active',
          assignedTo: {
            sys: { type: 'Link', linkType: 'User', id: userId },
          },
        }
      )
    )
  );

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length) {
    console.warn(
      `notifications: ${failures.length}/${results.length} task creations failed.`,
      JSON.stringify(failures, Object.getOwnPropertyNames(failures))
    );
  }
};
