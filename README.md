# Workflow Notifier

## Local Setup

1. Clone down this repo.
2. Ensure you are using a minimum of Node v22 (if using [NVM](https://github.com/nvm-sh/nvm) you can just run `nvm use` in the repo root).
3. Run `npm install` to install dependencies.
4. Run `npm run build` to create the build directory that can be uploaded to Contentful.
5. You can run the *frontend* portion of this app locally using `npm run start`; however, the backend Functions have to be uploaded to Contentful in order to work properly (see next section).

## App Definition Setup
1. Navigate to your Contentful Organization overview and click on **Apps**.
2. Click **Create app** on the top right.
3. Add a **Title** and set the hosing URL to http://localhost:3000 for now (just so you can save the definition).
4. Under **Locations**, select **Entry field** and the **JSON** field type.
5. Click **Save** at the top right.

## Uploading a bundle to Contentful
1. Once the App Definition has been created above, in the root directory for this repo, copy `.env.example` to `.env` and fill in the values. You can get the App Definition ID from the config screen above.
2. Run `npm run build && npm run upload`, which will build the bundle and upload to Contentful in one simple step.

## Content Type Configuration

1. Install the app to your chosen Space.
2. Navigate to your content model and edit your chosen "Stakeholders" JSON field, applying your App Definition (see above) to the field's appearance.
  - Note: This repo contains an example content model (`space-export.json`) that you can import into a blank Space to get a head start.

## Overview

A Contentful App that ties two missing pieces together:

1. A **Stakeholders field editor** for picking users from a Space and storing them on an entry as JSON.
2. An **App Event handler** that watches Workflow step changes and, on the configured trigger steps, creates a Contentful Task for each stakeholder on the entry's linked brand(s).

The intended flow:

> An entry referencing one or more brands moves through a Workflow. When it
> reaches a configured step (e.g. "Ready for review"), every user listed as a
> stakeholder on those brands automatically gets a Task on the entry asking
> them to review it.

## How it fits together

```
┌──────────────────────────────┐      ┌─────────────────────────────┐
│ Brand entry                  │      │ PDP entry (or similar)      │
│                              │      │                             │
│  stakeholders: JSON ◄────────┼──────┤  brands: Array<Link>        │
│   (user picker, this app)    │      │                             │
└──────────────────────────────┘      │  workflow ──┐               │
                                      └─────────────┼───────────────┘
                                                    │
                                       Workflow.save│event
                                                    ▼
                              ┌─────────────────────────────────────┐
                              │ functions/notifications.ts          │
                              │                                     │
                              │ if step matches a configured        │
                              │ trigger → walk brands → dedupe      │
                              │ stakeholders → create one Task each │
                              └─────────────────────────────────────┘
```

The **Field app** (`src/locations/Field.tsx`) populates the JSON. The **App Event Handler function** (`functions/notifications.ts`) consumes it. The **ConfigScreen** (`src/locations/ConfigScreen.tsx`) is where you pick which workflow + step pairs should fire the handler.

## Stakeholders Field

`src/locations/Field.tsx` renders on any JSON field a brand uses to store stakeholders. It:

- Fetches every user in the current Space via `sdk.cma.user.getManyForSpace`.
- Lets editors search and pick users via a Forma 36 `Autocomplete`.
- Renders each selection as a removable `Pill`.
- Persists the selection as `Array<{ userId, firstName, lastName }>` on the JSON field.

Picker UX lives in a shared component, `src/components/PillSelector.tsx`, so the same widget powers both this field and the ConfigScreen's trigger picker.

Field configuration recommendation in Contentful:
- Field type: **JSON object**
- Field id: `stakeholders` (or any name — the function reads the field by id from the brand entry, currently `stakeholders`).

## Workflow Notifier ConfigScreen

`src/locations/ConfigScreen.tsx` lists every Workflow Definition in the current environment (`sdk.cma.workflowDefinition.getMany`), flattens them to one row per `(workflow → step)`, and lets the installer pick which steps should trigger the notifier. Selections persist as installation parameters:

```ts
type WorkflowStepTrigger = {
  workflowDefinitionId: string;
  workflowDefinitionName: string;
  stepId: string;
  stepName: string;
};
type AppInstallationParameters = { triggers: WorkflowStepTrigger[] };
```

## Notifications App Event Function

`functions/notifications.ts` is registered in `contentful-app-manifest.json` as an `appevent.handler`. It expects to be wired to the **`Workflow.save`** topic on the app's event subscription.

On each event it:

1. Reads `stepId` from the event body and `workflowDefinitionId` / `entryId` from the body's `sys.workflowDefinition` and `sys.entity` links. (The `Workflow.save` payload is the Workflow entity itself — `WorkflowProps` from `contentful-management`, not the legacy changelog shape.)
2. Bails if `(workflowDefinitionId, stepId)` isn't in the installation's `triggers`.
3. Fetches the triggering entry, reads its `brands` array field.
4. Fetches each linked brand entry and unions all `stakeholders[].userId` values across them — one task per unique user.
5. Creates a Contentful Task on the triggering entry per stakeholder, with body `"<adminTitle> is ready for your review."` and `assignedTo: Link<User>`.

### Hardcoded field IDs

The function reads three fields by id. Change these constants at the top of `functions/notifications.ts` if your content model uses different names:

| Constant | Default | Lives on |
| --- | --- | --- |
| `BRAND_FIELD_ID` | `'brands'` | The entry that fires the workflow |
| `STAKEHOLDERS_FIELD_ID` | `'stakeholders'` | The linked brand entries |
| `ADMIN_TITLE_FIELD_ID` | `'adminTitle'` | The triggering entry (used in the task body) |

### Wiring the subscription (one-time, per app definition)

After deploying:

1. In the Contentful web app, open the App Definition for this app.
2. **Events** tab → enable events.
3. Subscribe to topic `Workflow.save`.
4. Link the `notifications` function to the subscription.

### Debugging

CMA errors inside Contentful Functions surface as opaque `{ remote: true }` rejections — the underlying message is lost across the function boundary. The handler logs every early-return and every failed `task.create`; if a fan-out fails, log the inputs and reproduce the same CMA call against the plain client to see the real error.

## Project layout

```
src/
├── components/
│   └── PillSelector.tsx          # Shared Autocomplete + Pill list
├── hooks/
│   └── useDropdownAwareAutoResizer.ts  # Field/Sidebar/Dialog iframe sizing
├── locations/
│   ├── ConfigScreen.tsx          # Workflow + step picker
│   ├── Field.tsx                 # Stakeholders picker
│   ├── Dialog.tsx, EntryEditor.tsx, Home.tsx, Page.tsx, Sidebar.tsx (unused stubs)
│   └── *.spec.tsx
├── App.tsx
└── index.tsx

functions/
├── notifications.ts              # App Event Handler
└── notifications.spec.ts

contentful-app-manifest.json      # Declares the notifications function
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Vite dev server for the frontend locations |
| `npm run build` | Builds the frontend AND bundles `functions/` via `contentful-app-scripts build-functions` |
| `npm run build:functions` | Just the function bundle |
| `npm run upload` | Interactive upload of `build/` (frontend + functions + manifest) |
| `npm run upload-ci` | Same, but reads `CONTENTFUL_ORG_ID`, `CONTENTFUL_APP_DEF_ID`, `CONTENTFUL_ACCESS_TOKEN` from env |
| `npm test` / `npm run test:ci` | Vitest |
| `npm run create-app-definition` | Interactive scaffold of a new app definition in Contentful |
| `npm run add-locations` | Adds locations to an existing app definition |

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
- Localized stakeholders / brand fields — the function reads whichever locale the field happens to define.
