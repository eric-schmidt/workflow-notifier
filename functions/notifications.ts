// Purpose: App Event handler for Workflow.save. Reads installation triggers
// and field-id parameters, walks the configured stakeholder-reference field on
// the triggering entry, dedupes stakeholder members by userId across the linked
// entries, and fans out a Task per stakeholder. Body shape per WorkflowProps
// (entry/definition links live under sys, stepId at top level). Field IDs are
// curated on the ConfigScreen and persisted as installation parameters; the
// handler aborts if any are missing.

import type {
  AppEventRequest,
  FunctionEventContext,
  FunctionEventHandler as EventHandler,
  FunctionTypeEnum,
} from '@contentful/node-apps-toolkit';

const TASK_BODY = (pageTitle: string) =>
  `${pageTitle} is ready for your review.`;

export type Trigger = {
  workflowDefinitionId: string;
  stepId: string;
};

export type AppParameters = {
  triggers?: Trigger[];
  pageStakeholderFieldId?: string;
  stakeholderMemberFieldId?: string;
  pageTitleFieldId?: string;
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
  // Multi-locale stakeholder content would need an explicit locale strategy.
  const titleLocale = firstLocale(entry.fields[pageTitleFieldId] as any);
  const pageTitle: string =
    (titleLocale &&
      (entry.fields[pageTitleFieldId] as Record<string, string>)[
        titleLocale
      ]) ||
    '(untitled)';

  const refLocale = firstLocale(entry.fields[pageStakeholderFieldId] as any);
  const stakeholderRefLinks: Array<{ sys: { id: string } }> =
    (refLocale &&
      (entry.fields[pageStakeholderFieldId] as Record<
        string,
        Array<{ sys: { id: string } }>
      >)[refLocale]) ||
    [];
  if (!stakeholderRefLinks.length) {
    console.warn(
      `notifications: entry ${entryId} has no linked stakeholder entries on field "${pageStakeholderFieldId}"; nothing to assign.`
    );
    return;
  }

  const stakeholderEntries = await Promise.all(
    stakeholderRefLinks.map((l) =>
      cma.entry.get({ spaceId, environmentId, entryId: l.sys.id })
    )
  );

  const uniqueUsers = new Map<string, Stakeholder>();
  for (const ref of stakeholderEntries) {
    const memberLocale = firstLocale(
      ref.fields[stakeholderMemberFieldId] as any
    );
    const members: Stakeholder[] =
      (memberLocale &&
        (ref.fields[stakeholderMemberFieldId] as Record<
          string,
          Stakeholder[]
        >)[memberLocale]) ||
      [];
    for (const s of members) {
      if (s?.userId) uniqueUsers.set(s.userId, s);
    }
  }
  if (!uniqueUsers.size) {
    console.warn(
      `notifications: linked stakeholder entries had no members for entry ${entryId}.`
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
          body: TASK_BODY(pageTitle),
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
