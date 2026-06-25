# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Contentful App with two parts:
- **Frontend** (`src/`) — React 18 + Forma 36 + `@contentful/app-sdk`. Renders inside the Contentful web app at the ConfigScreen and Field locations. Most other location files (Dialog, EntryEditor, Home, Page, Sidebar) are stubs.
- **Serverless function** (`functions/notifications.ts`) — App Event handler for `Workflow.save`. Reads the entry's brands, dedupes stakeholders, and creates a Task per unique user.

Build tooling: Vite 6 + Vitest 3 + TypeScript 4.9 (`strict: true`). Package manager: **npm** (`package-lock.json`).

## Commands

- `npm start` — local dev (Vite)
- `npm test` — Vitest
- `npm run build` — **two-stage**: Vite builds the frontend, then `contentful-app-scripts build-functions` bundles `functions/notifications.ts` to `build/functions/notifications.js`. Both stages must complete before upload.
- `npm run build:functions` — function bundle only (rarely run alone)
- `npm run upload` / `npm run upload-ci` — push to Contentful (CI variant reads `$CONTENTFUL_ORG_ID`, `$CONTENTFUL_APP_DEF_ID`, `$CONTENTFUL_ACCESS_TOKEN`)

No lint script configured. ESLint inherits `react-app` preset via `package.json` `eslintConfig`.

## Gotchas

- **Hardcoded field IDs in `functions/notifications.ts`**: `BRAND_FIELD_ID='brands'`, `STAKEHOLDERS_FIELD_ID='stakeholders'`, `ADMIN_TITLE_FIELD_ID='adminTitle'`. These are not driven by the ConfigScreen — they must match the actual content model. Changing them in code without a matching model change will silently break the function.
- **Manual event wiring after upload**: After `npm run upload`, the `notifications` function must be wired to the `Workflow.save` topic in the Contentful web UI (App Definition → Events). Not automated.
- **Opaque CMA errors inside Functions**: Errors thrown by the CMA client inside a Contentful Function surface as `{ remote: true }` with the original message lost. To debug, reproduce the failing call against a plain CMA client outside the Function runtime.

## When researching Contentful / Forma 36 / App SDK

- **Verify with Glean first** before changing SDK usage, Forma 36 component props, or App SDK APIs — internal docs and prior incidents land there. Don't guess from memory.
- **Use Contentful MCP tools** (`get_content_type`, `get_entry`, `search_entries`) to confirm content-model field IDs and shapes rather than inferring from code.
