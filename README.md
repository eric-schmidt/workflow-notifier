# Workflow Notifier

## Setup

### Local
1. Clone down this repo.
2. Ensure you are using a minimum of Node v24 (if using [NVM](https://github.com/nvm-sh/nvm) you can just run `nvm use` in the repo root, which reads `.nvmrc`).
3. Run `npm install` to install dependencies.
4. Run `npm run build` to create the build directory that can be uploaded to Contentful.
5. You can run the *frontend* portion of this app locally using `npm run start`; however, the backend Functions have to be uploaded to Contentful in order to work properly (see next section).

### App Definition Setup
1. Navigate to your Contentful Organization overview and click on **Apps**.
2. Click **Create app** on the top right.
3. Add a **Title** and set the hosting URL to http://localhost:3000 for now (just so you can save the definition).
4. Under **Locations**, select **both**:
   - **App configuration** — renders the ConfigScreen. **Required.** The three field IDs below are curated here and the notifications function aborts without them, so an install with no configuration screen can never do anything.
   - **Entry field** with the **JSON** field type — renders the Stakeholders picker.
5. Click **Save** at the top right.

### Uploading a bundle to Contentful
1. Once the App Definition has been created above, in the root directory for this repo, copy `.env.example` to `.env` and fill in the values. You can get the App Definition ID from the config screen above.
2. Run `npm run build && npm run upload`, which will build the bundle and upload to Contentful in one simple step.

### Content Type Configuration
1. Install the app to your chosen Space and fill in the three field IDs on the app's configuration screen.
2. Navigate to your content model and edit your chosen "Stakeholders" JSON field, applying your App Definition (see above) to the field's appearance.
  - Note: This repo contains an example content model (`exports/space/export.json`) that you can import into a blank Space to get a head start. The app's default field IDs match it.

### Importing the Space Export
1. Make sure the target space is blank — `contentful-import` is idempotent by entity `sys.id`, so re-running against a populated space will *update* matching entities in place rather than fail.
2. Run `npm run import-content-model` and follow the prompts. The script lists every `.json` in `exports/space/` and (if there's more than one) asks which to use; then prompts for space ID, environment ID, and a y/N confirm. Pass `--yes` to skip the confirm in scripted environments.
3. The chosen export is sent through `contentful-import` in full — content types, editor interfaces, locales, tags, entries, and assets (with binaries). CMA errors are surfaced verbatim, including a `details:` block with the underlying response.

### Importing Workflows
1. Run `npm run import-workflows` to automatically import the workflows defined in `@/exports/workflows`.
2. Assign any relevant content types to the imported Workflows as needed (see [these docs](https://www.contentful.com/help/ai-automations/workflows/creating-a-workflow/)), noting the field requirements (e.g. `stakeholders`) noted below.

## Overview

A Contentful App that ties two missing pieces together:

1. A **Stakeholders field editor** for picking users from a Space and storing them on an entry as JSON.
2. An **App Event handler** that watches Workflow step changes and, on the configured trigger steps, creates a Contentful Task for each stakeholder listed on the entries the triggering entry references.

The intended flow:

> An entry referencing one or more stakeholder entries moves through a Workflow.
> When it reaches a configured step (e.g. "Ready for review"), every user listed
> as a stakeholder on those referenced entries automatically gets a Task on the
> entry asking them to review it.

Nothing in the code knows what the referenced entries *represent* — in the example space they're brands, but the reference field and the member field are both installation parameters, so any content model works.

## How it fits together

```
┌──────────────────────────────┐      ┌─────────────────────────────┐
│ Stakeholder entry            │      │ Page entry (or similar)     │
│  (a brand, a region, …)      │      │                             │
│                              │      │  <pageStakeholderFieldId>   │
│  <stakeholderMemberFieldId>  │◄─────┤    : Array<Link>            │
│    : JSON (user picker)      │      │  <pageTitleFieldId>: Symbol │
└──────────────────────────────┘      │                             │
                                      │  workflow ──┐               │
                                      └─────────────┼───────────────┘
                                                    │
                              Workflow.save / .create│event
                                                    ▼
                              ┌─────────────────────────────────────┐
                              │ functions/notifications.ts          │
                              │                                     │
                              │ if step matches a configured        │
                              │ trigger → walk the reference field  │
                              │ → dedupe stakeholders → skip anyone  │
                              │ already asked → create one Task each │
                              └─────────────────────────────────────┘
```

The **Field app** (`src/locations/Field.tsx`) populates the JSON. The **App Event Handler function** (`functions/notifications.ts`) consumes it. The **ConfigScreen** (`src/locations/ConfigScreen.tsx`) is where you pick the field IDs and which workflow + step pairs should fire the handler.

Everything that crosses the browser↔function boundary — the stakeholder JSON shape, the installation parameter shape, and the CMA limits the function must respect — is declared once in **`shared/contract.ts`** and imported by both sides. Change a shape there and the build breaks, instead of notifications silently breaking in production.

## Stakeholders Field

`src/locations/Field.tsx` renders on any JSON field used to store stakeholders. It:

- Fetches every user in the current Space via `sdk.cma.user.getManyForSpace`, **paging through the whole list** (one request returns at most 100 users).
- Lets editors search and pick users via a Forma 36 `Autocomplete`.
- Renders each selection as a removable `Pill`.
- Persists the selection as `Array<{ userId, firstName, lastName }>` on the JSON field.
- Surfaces a notifier error if the user list can't be loaded, rather than showing an empty picker.
- Ignores malformed stored values (the field is plain JSON, so anything could be in there).

Picker UX lives in a shared component, `src/components/PillSelector.tsx`, so the same widget powers both this field and the ConfigScreen's trigger picker.

Field configuration recommendation in Contentful:
- Field type: **JSON object**
- Field id: anything — the function reads it by the id you set as `stakeholderMemberFieldId`. The example space uses `members`.

## Workflow Notifier ConfigScreen

`src/locations/ConfigScreen.tsx` lists every Workflow Definition in the current environment (`sdk.cma.workflowDefinition.getMany`), flattens them to one row per `(workflow → step)`, and lets the installer pick which steps should trigger the notifier. Everything persists as installation parameters:

```ts
type WorkflowStepTrigger = {
  workflowDefinitionId: string;
  workflowDefinitionName: string; // display only
  stepId: string;
  stepName: string;               // display only
};

type AppInstallationParameters = {
  pageTitleFieldId: string;
  pageStakeholderFieldId: string;
  stakeholderMemberFieldId: string;
  triggers: WorkflowStepTrigger[];
};
```

Save rules:
- The three field IDs are always required.
- At least one trigger is required **only when the environment actually has workflow definitions to choose from**. In a space with none — or when the definitions request fails — the field IDs can still be saved, and you reopen the screen to pick triggers once workflows exist.
- A failed definitions request is reported as a failure, with the CMA message, rather than as "no workflow definitions found".

## Notifications App Event Function

`functions/notifications.ts` is registered in `contentful-app-manifest.json` as an `appevent.handler`. It expects to be wired to the **`Workflow.save`** and **`Workflow.create`** topics on the app's event subscription.

On each event it:

1. Reads `stepId` from the event body and `workflowDefinitionId` / `entryId` from the body's `sys.workflowDefinition` and `sys.entity` links. (The payload is the Workflow entity itself — `WorkflowProps` from `contentful-management`, not the legacy changelog shape.)
2. Bails if `(workflowDefinitionId, stepId)` isn't in the installation's `triggers`.
3. Fetches the triggering entry and reads the reference field named by `pageStakeholderFieldId`.
4. Fetches each linked entry (at most `MAX_CONCURRENT_CMA_REQUESTS` at a time) and unions all member `userId` values across them — one task per unique user. An unreadable or dangling link is skipped and logged; it doesn't cancel everyone else's notification.
5. Drops any user who already has an **open** review task on the entry, then creates a Contentful Task per remaining stakeholder with body `"<title> is ready for your review."` and `assignedTo: Link<User>`.

### CMA limits it respects

| Limit | Behaviour |
| --- | --- |
| Task `body` ≤ 512 bytes | The title is truncated (with an ellipsis) so the body always fits; the instruction text is never cut. |
| 100 tasks per entry | The fan-out is capped to the entry's remaining capacity, and anyone left out is named in a warning log. |
| 7–10 requests/second | Both fan-outs (linked-entry reads, task creates) run at most `MAX_CONCURRENT_CMA_REQUESTS` (5) at a time instead of all at once. |

On that last one: an entry with many stakeholder references would otherwise issue `1 + N + 1 + U` requests in two unbounded bursts — a dozen brands with three stakeholders each is ~40 requests, well past the limit. The CMA bucket is **shared with the Contentful web app**, so a space with active editors has less than the nominal 7–10 req/s actually available.

The injected `context.cma` client *does* retry a 429 (`retryOnError` defaults on, 5 attempts, backoff honouring `x-contentful-ratelimit-reset`), so an over-limit burst is not silently dropped. But it does **not** throttle proactively — `throttle` defaults to `0` and the runtime gives us no way to set it on the provided client — so every retry is paid in wall-clock against the function's execution timeout. Capping concurrency keeps requests inside the budget rather than recovering from exceeding it.

### Not creating duplicates

`Workflow.save` fires on every workflow update, so a trigger step can be re-entered and this handler re-run against the same entry. Before creating anything it reads the entry's existing tasks and skips users who already have an `active` task whose body ends with `" is ready for your review."`. Tasks carry no app-specific metadata, so the body is the only marker available — a stakeholder whose task has been **resolved** will be asked again the next time the entry re-enters a trigger step, which is the intended behaviour.

If the existing tasks can't be read, the function notifies anyway and logs that duplicate suppression was skipped: a duplicate task is a nuisance, a missed review request is a broken feature.

### Configurable field IDs

The function reads three field IDs from installation parameters — curate them on the ConfigScreen, not in code. All three are required; the function aborts if any are missing.

| Parameter | Lives on | Purpose | Default |
| --- | --- | --- | --- |
| `pageTitleFieldId` | The entry that fires the workflow | Used in the task body; falls back to `(untitled)` when empty or non-string | `adminTitle` |
| `pageStakeholderFieldId` | The entry that fires the workflow | Multi-reference field whose linked entries hold the stakeholder lists | `stakeholders` |
| `stakeholderMemberFieldId` | Each linked stakeholder entry | JSON field listing individual users | `members` |

The defaults match the example space in `exports/space/export.json` (`pdpPage.adminTitle`, `pdpPage.stakeholders`, `stakeholders.members`) so an imported example space and a fresh install line up without retyping.

### Wiring the subscription (one-time, per app definition)

After deploying:

1. In the Contentful web app, open the App Definition for this app.
2. **Events** tab → enable events.
3. Subscribe to topics `Workflow.save` **and** `Workflow.create`. `Workflow.save` fires when a workflow is updated (a step change); `Workflow.create` fires when a workflow is *started*. Without the second, a workflow whose **first** step is a configured trigger never notifies anyone.
4. Link the `notifications` function to the subscription.

### Debugging

CMA errors inside Contentful Functions surface as opaque `{ remote: true }` rejections — the underlying message is lost across the function boundary. The handler logs every early return and serializes every rejection individually (`JSON.stringify(err, Object.getOwnPropertyNames(err))`, which is required because `Error.message` and `.stack` are non-enumerable — applying that replacer to an *array* of results instead silently flattens every entry to `{}`). If a fan-out still fails, log the inputs and reproduce the same CMA call against the plain client to see the real error.

### Why not native workflow step actions?

A workflow step can natively define up to three task actions, but each needs a **static** assignee link baked into the workflow definition. This app exists to assign the task to whoever the *entry's* stakeholders happen to be, which the native feature can't express.

## Project layout

```
shared/
└── contract.ts                   # Types + CMA limits shared by browser & function

src/
├── components/
│   ├── LocalhostWarning.tsx
│   └── PillSelector.tsx          # Shared Autocomplete + Pill list
├── hooks/
│   └── useDropdownAwareAutoResizer.ts  # Field/Sidebar/Dialog iframe sizing
├── locations/
│   ├── ConfigScreen.tsx          # Field IDs + workflow/step picker
│   └── Field.tsx                 # Stakeholders picker
├── App.tsx                       # Routes app-config and entry-field locations
└── index.tsx

functions/
└── notifications.ts              # App Event Handler

test/mocks/                       # Shared SDK/CMA doubles + resetMocks()
contentful-app-manifest.json      # Declares the notifications function
```

Every source file has a co-located `*.spec.ts(x)`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Vite dev server for the frontend locations |
| `npm run build` | Builds the frontend AND bundles `functions/` via `contentful-app-scripts build-functions` |
| `npm run build:functions` | Just the function bundle |
| `npm run typecheck` | `tsc --noEmit` over `src/`, `shared/`, `functions/`, and `test/` |
| `npm run upload` | Interactive upload of `build/` (frontend + functions + manifest) |
| `npm run upload-ci` | Same, but reads `CONTENTFUL_ORG_ID`, `CONTENTFUL_APP_DEF_ID`, `CONTENTFUL_ACCESS_TOKEN` from env |
| `npm test` / `npm run test:ci` | Vitest |
| `npm run create-app-definition` | Interactive scaffold of a new app definition in Contentful |
| `npm run add-locations` | Adds locations to an existing app definition |
| `npm run import-workflows` | Creates a Workflow Definition in the target space/env from each JSON in `exports/workflows/`. Prompts interactively for the space ID and environment ID; reads `CONTENTFUL_ACCESS_TOKEN` from `.env`. Create-only — re-running may produce duplicates or 4xx; failures are logged per file. |
| `npm run import-content-model` | Picks a `.json` export from `exports/space/` (auto-selects if only one, prompts otherwise) and imports it in full — content types, editor interfaces, locales, tags, entries, assets — via `contentful-import`. Prompts for space ID, environment ID, and a y/N confirm (`--yes` skips); reads `CONTENTFUL_ACCESS_TOKEN` from `.env`. Idempotent by `sys.id` — existing entities are updated, not failed. CMA errors surface with a `details:` block. |

## Stack

- [Forma 36](https://f36.contentful.com/) — design system
- [`@contentful/app-sdk`](https://www.contentful.com/developers/docs/extensibility/app-framework/sdk/) — runtime SDK for the locations
- [`@contentful/react-apps-toolkit`](https://www.contentful.com/developers/docs/extensibility/app-framework/react-apps-toolkit/) — `useSDK`, `useAutoResizer`, auto-authed CMA client
- [`@contentful/node-apps-toolkit`](https://github.com/contentful/node-apps-toolkit) — types and runtime for App Event functions
- [`contentful-management`](https://github.com/contentful/contentful-management.js) — CMA client used by both the ConfigScreen and the function
- Vite + Vitest

## Out of scope (today)

- Proceeding to an "Approved" step once all assigned Tasks are completed.
- Auto-resolving tasks when the workflow leaves the trigger step.
- Backfill for entries already past the trigger step at install time.
- Localized stakeholders / reference fields — the function reads whichever locale the field happens to define.
- Re-notifying a stakeholder whose earlier task was resolved is treated as intended, not suppressed; only *open* tasks suppress a new one.
