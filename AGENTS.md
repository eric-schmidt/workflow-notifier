# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Contentful App with three parts:
- **Frontend** (`src/`) — React 18 + Forma 36 + `@contentful/app-sdk`. Renders inside the Contentful web app at exactly two locations: ConfigScreen (app-config) and Field (entry-field). No other location files exist; the unused stubs were deleted.
- **Serverless function** (`functions/notifications.ts`) — App Event handler for `Workflow.save` and `Workflow.create`. Walks the configured reference field on the triggering entry, dedupes stakeholders across the linked entries, skips anyone who already has an open task, and creates a Task per remaining user.
- **Shared contract** (`shared/contract.ts`) — the types and CMA limits both halves import.

Build tooling: Vite 6 + Vitest 3 + TypeScript 4.9 (`strict: true`). Package manager: **npm** (`package-lock.json`).

## Commands

- `npm start` — local dev (Vite)
- `npm test` — Vitest
- `npm run typecheck` — `tsc --noEmit` over `src/`, `shared/`, `functions/`, `test/`
- `npm run build` — **two-stage**: Vite builds the frontend, then `contentful-app-scripts build-functions` bundles `functions/notifications.ts` to `build/functions/notifications.js`. Both stages must complete before upload.
- `npm run build:functions` — function bundle only (rarely run alone)
- `npm run upload` / `npm run upload-ci` — push to Contentful (CI variant reads `$CONTENTFUL_ORG_ID`, `$CONTENTFUL_APP_DEF_ID`, `$CONTENTFUL_ACCESS_TOKEN`)

No lint script configured. ESLint inherits `react-app` preset via `package.json` `eslintConfig`. Neither `npm run build` nor the function bundler typechecks — run `npm run typecheck` yourself.

## Gotchas

- **`shared/contract.ts` is the boundary**: the Field editor writes stakeholder JSON that the function reads, and the ConfigScreen writes installation parameters that the function reads. Both sides import their shapes from `shared/contract.ts`. Never redeclare one of those shapes locally — that's how a rename becomes a silent production break instead of a build error. The CMA limits (`TASK_BODY_MAX_BYTES`, `MAX_TASKS_PER_ENTRY`, `MAX_CONCURRENT_CMA_REQUESTS`) and the task-body builder live there too.
- **Field IDs are installation parameters, not constants**: The notifications function reads `pageTitleFieldId`, `pageStakeholderFieldId`, and `stakeholderMemberFieldId` from `context.appInstallationParameters`. They're curated on the ConfigScreen and required to save. The function aborts with a warn log if any are missing — there's no fallback. Their defaults match `exports/space/export.json`.
- **The app-config location is mandatory**: without it the installer has no way to set those parameters, so the handler aborts on every event. An App Definition needs **both** app-config and entry-field.
- **Manual event wiring after upload**: After `npm run upload`, the `notifications` function must be wired to the `Workflow.save` **and** `Workflow.create` topics in the Contentful web UI (App Definition → Events). Not automated. `Workflow.save` alone misses workflows that *start* on a trigger step.
- **Opaque CMA errors inside Functions**: Errors thrown by the CMA client inside a Contentful Function surface as `{ remote: true }` with the original message lost. To debug, reproduce the failing call against a plain CMA client outside the Function runtime. When logging a rejection, serialize it **individually** with `JSON.stringify(err, Object.getOwnPropertyNames(err))` — passing that replacer an *array* of settled results filters every nested object down to `{}`.
- **Every CMA fan-out is concurrency-capped**: both loops in `functions/notifications.ts` go through `mapWithConcurrency(..., MAX_CONCURRENT_CMA_REQUESTS, ...)`, not `Promise.all`/`allSettled` over the whole array. The CMA allows 7–10 req/s and the bucket is shared with the web app, so an entry with many stakeholder references bursts past it. The injected `context.cma` retries a 429 but never throttles proactively (`throttle` defaults to `0` and is not settable on the provided client), so an uncapped burst is paid in wall-clock against the execution timeout. The helper returns results in **input order** because both call sites log failures by index — reordering would blame the wrong user. Don't swap it back for `Promise.allSettled` to "simplify", and don't reach for `p-limit`: extra bundling surface breaks at module load in the Functions runtime, not at build time.
- **Concurrency needs a probe, not a resolved mock**: a `vi.fn()` that resolves immediately makes even sequential code look parallel, because the microtask queue drains each call before the next begins. `makeConcurrencyProbe` in `functions/notifications.spec.ts` holds every call open and records peak in-flight; its `drain()` is driven by the handler's own promise, because the handler awaits unprobed calls (`task.getMany`) between batches.
- **`Workflow.save` fires on every workflow update**, so the handler can run repeatedly against the same entry and must stay idempotent — it reads existing tasks and skips users who already have an open one. Don't remove that check to save a request.
- **Test doubles are module singletons**: `test/mocks` exports `mockSdk`/`mockCma` plus `resetMocks()`. Call `resetMocks()` in a `beforeEach`, and read the *latest* registration (`mock.calls.at(-1)`) rather than `mock.calls[0]` — call history accumulates across every render in a file.
- **`useAutoResizer` throws in app-config/page locations**: `useDropdownAwareAutoResizer` is Field/Sidebar/Dialog only. `PillSelector` therefore takes optional `onOpen`/`onClose` instead of owning the resizer.
