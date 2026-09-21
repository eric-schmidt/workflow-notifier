// Purpose: Single source of truth for everything that crosses a process
// boundary in this app. The Field editor (browser) *writes* stakeholder JSON
// that the notifications function (Contentful Functions runtime) *reads*, and
// the ConfigScreen (browser) *writes* installation parameters that the same
// function reads. Neither side can type-check the other at runtime, so both
// import their shapes from here — a rename breaks the build instead of
// silently breaking notifications. Also holds the CMA limits the function has
// to respect, because they are contract, not implementation detail.

/**
 * One user as persisted on a stakeholder JSON field. Written by
 * `src/locations/Field.tsx`, read by `functions/notifications.ts`.
 */
export type Stakeholder = {
  userId: string;
  firstName: string;
  lastName: string;
};

/**
 * A (workflow definition, step) pair that should fire notifications. The two
 * `*Name` values are display-only — they exist so the ConfigScreen can label a
 * saved trigger without re-fetching definitions. Only the IDs are matched
 * against an incoming event.
 */
export type WorkflowStepTrigger = {
  workflowDefinitionId: string;
  workflowDefinitionName: string;
  stepId: string;
  stepName: string;
};

/**
 * The installation parameter blob. The ConfigScreen guarantees these are all
 * present when it saves; the function must not assume that, because an
 * installation may predate any given parameter — it reads
 * `Partial<AppInstallationParameters>` instead.
 */
export type AppInstallationParameters = {
  pageTitleFieldId: string;
  pageStakeholderFieldId: string;
  stakeholderMemberFieldId: string;
  triggers: WorkflowStepTrigger[];
};

/**
 * Prefilled on a fresh install. These match the example space in
 * `exports/space/export.json` (`pdpPage.adminTitle`, `pdpPage.stakeholders`,
 * `stakeholders.members`) so importing that export and installing the app
 * line up without retyping field IDs. They are only defaults — any content
 * model works, which is the entire point of making them parameters.
 */
export const DEFAULT_PARAMETERS: AppInstallationParameters = {
  pageTitleFieldId: 'adminTitle',
  pageStakeholderFieldId: 'stakeholders',
  stakeholderMemberFieldId: 'members',
  triggers: [],
};

/**
 * CMA limit: a task `body` over 512 bytes is rejected with
 * `422 ValidationFailed`.
 * @see https://www.contentful.com/developers/docs/references/content-management-api/#/reference/entry-tasks
 */
export const TASK_BODY_MAX_BYTES = 512;

/**
 * CMA limit: creating the 101st task on an entry is rejected with
 * `400 BadRequest`.
 */
export const MAX_TASKS_PER_ENTRY = 100;

/**
 * How many CMA requests the notifications function keeps in flight at once.
 *
 * The CMA allows 7 req/s on free plans and 10 on paid, and that bucket is
 * **shared with the Contentful web app** — a space with active editors has less
 * than the nominal limit actually available. An entry with many stakeholder
 * references would otherwise fan out unbounded and burst straight through it.
 *
 * The `contentful-management` client injected as `context.cma` does retry a 429
 * (`retryOnError` defaults to true, 5 attempts, backoff honouring
 * `x-contentful-ratelimit-reset`), so a burst is not silently dropped. But it
 * does *not* throttle proactively — `throttle` defaults to `0`, and the
 * runtime-provided client gives us no way to set it — so every retry is paid in
 * wall-clock against the function's execution timeout. Capping the fan-out
 * keeps requests inside the budget instead of recovering from exceeding it.
 *
 * 5 leaves headroom under the 7 req/s floor for the handler's two serial reads
 * (triggering entry, existing tasks) and for other traffic in the space.
 */
export const MAX_CONCURRENT_CMA_REQUESTS = 5;

/**
 * Everything after the page title in a generated task body. Doubles as the
 * marker the function uses to recognise its own tasks when deciding whether a
 * stakeholder has already been asked to review this entry — tasks carry no
 * app metadata, so the body is the only thing available to match on.
 */
export const TASK_BODY_SUFFIX = ' is ready for your review.';

/** Shown when the configured title field is empty or not a string. */
export const UNTITLED_PAGE_TITLE = '(untitled)';

/** Exact UTF-8 byte length, without depending on TextEncoder or Buffer. */
export const utf8ByteLength = (value: string): number => {
  let bytes = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    bytes +=
      codePoint < 0x80
        ? 1
        : codePoint < 0x800
          ? 2
          : codePoint < 0x10000
            ? 3
            : 4;
  }
  return bytes;
};

/**
 * Cuts `value` to at most `maxBytes` UTF-8 bytes, appending an ellipsis when
 * it had to cut. Iterates code points rather than UTF-16 units so a surrogate
 * pair is never split in half.
 */
export const truncateToBytes = (value: string, maxBytes: number): string => {
  if (utf8ByteLength(value) <= maxBytes) {
    return value;
  }
  const ellipsis = '…';
  const budget = maxBytes - utf8ByteLength(ellipsis);
  let kept = '';
  let bytes = 0;
  for (const char of value) {
    const charBytes = utf8ByteLength(char);
    if (bytes + charBytes > budget) {
      break;
    }
    kept += char;
    bytes += charBytes;
  }
  return `${kept}${ellipsis}`;
};

/**
 * Builds a task body that is guaranteed to satisfy `TASK_BODY_MAX_BYTES` by
 * truncating the page title, never the instruction that follows it.
 */
export const buildTaskBody = (pageTitle: string): string => {
  const titleBudget = TASK_BODY_MAX_BYTES - utf8ByteLength(TASK_BODY_SUFFIX);
  return `${truncateToBytes(pageTitle, titleBudget)}${TASK_BODY_SUFFIX}`;
};

/**
 * Whether an existing task body looks like one this app created. Used for
 * idempotency: `Workflow.save` fires on every workflow update, so the same
 * trigger step can be reached repeatedly and must not fan out twice.
 */
export const isReviewRequestBody = (body: string | undefined): boolean =>
  typeof body === 'string' && body.endsWith(TASK_BODY_SUFFIX);
