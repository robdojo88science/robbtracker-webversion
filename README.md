# Robb Tracker - Shareable offline app

This is the separate browser/PWA version of Robb Tracker. The original native project is unchanged. The web version keeps the existing finance screens, offline chat, wallets, transfers, budgets, goals, reminders, history, spreadsheet import/export and JSON backup features.

Friends activate with a separate six-digit access PIN supplied by the owner. They do not need Google, ChatGPT or another account. Each person then creates their own four-digit action PIN and independent local tracker.

## Current status

The web app and access-PIN Worker build successfully. TypeScript and all 184 tests pass. The original project's 136 recorded source files match their baseline hashes.

Publication is not complete. The Sites connection currently returns `Sites project not found` for the previously created project, and its project list is empty. No live shareable URL or working production activation PIN is claimed. Keep the existing project ID until the same hosting account is restored; do not create a duplicate Site automatically.

Browser visual QA could not complete because Computer Use could not verify the active Chrome URL. Physical iPhone/iPad installation and airplane-mode acceptance still need testing after publication.

## Using it on iPhone or iPad

1. Receive the published app link and access PIN from the owner.
2. Open the link in Safari while online and enter the access PIN.
3. Choose Share -> Add to Home Screen. Enable Open as Web App if shown.
4. Open the new blue R icon. Enter the access PIN again if this new web-app context asks for it.
5. Wait until Install & share says Ready to use offline, then create or restore your tracker.
6. Daily transactions, balances, budgets, charts, goals, saved reminders and quick chat work without internet. First activation, initial installation and app updates require internet.

Settings -> Install & share sends the app link without your financial records. Friends start with separate empty trackers. An iPhone or iPad is enough to install, use and share the published app; no laptop, signing certificate, App Store submission or weekly sideload refresh is needed for that workflow.

Apple's current instructions: https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios

## Browser differences

- Quick chat uses the existing fast offline parser, including misspellings, dates, multiple entries and spending questions. Browsers cannot use the native Apple intelligence module.
- Reminders and summaries remain visible and editable. Browser alerts require permission and an open, visible app; reliable offline alerts after the web app closes are unavailable.
- File saves use the browser share/download controls. Imports use the file picker. Profile, goal and receipt images use portable JPEG, PNG and WebP data.
- Local records and salted PIN hashes are stored in IndexedDB. The action PIN protects app mutations; it does not encrypt the ledger or replace device protection.
- Save JSON backups to Files. Clearing browser website data can remove local records and offline assets. Records do not automatically sync between devices.

## Access PIN and offline approval

The access PIN is verified on the server using salted PBKDF2-SHA256 and never embedded in client bundles. A signed, secure, HttpOnly cookie approves the device for up to one year. Guesses are rate-limited to eight attempts per address per 15 minutes. The small hosted database stores hashed rate-limit keys and attempt counters, never financial records.

An already activated, cached device can keep working offline. Changing the access PIN controls future activations and online asset requests; it cannot instantly revoke a device that is offline. A shared access PIN can be forwarded by someone who knows it. It is a shared invitation gate, not individual remote account management.

## Development

Use Node.js 24 LTS.

```sh
npm ci
npm run build
npm run check
npm run preview:web
```

The local preview opens http://127.0.0.1:4173 and intentionally serves app assets for local QA. It is not the deployed PIN gate. Test the access Worker with `tests/access.test.ts` and `tests/worker.test.ts`.

`npm run build:web` creates the app shell, all route chunks, local font, sounds, SQL.js engine and WASM, icons, manifest and service worker. All are cached before offline-ready is reported. Updates wait for the user; failed downloads preserve the previous offline version and local database.

`npm run build` additionally bundles `worker/index.mjs` with its app assets into `dist/server/index.js`. Deploy the Worker, not the raw static app directory, to enforce the access PIN.

## Hosting setup

The retained `.openai/hosting.json` identifies the existing Site and its `DB` D1 binding. `drizzle/` contains the generated schema migration for access attempts. The hosting workflow applies migrations; the request handler never creates schema.

Before deployment, set these runtime values as secrets through the hosting service:

- `ACCESS_PIN_SALT`: 32 random bytes encoded as 64 lowercase hex characters.
- `ACCESS_PIN_HASH`: 32-byte PBKDF2-SHA256 result using the six-digit access PIN, the decoded salt and 100,000 iterations, encoded as lowercase hex.
- `ACCESS_SESSION_SECRET`: 32 independent random bytes encoded as lowercase hex.

The gate fails closed if configuration or rate-limit storage is unavailable. Do not put the PIN or secrets in source, hosting metadata, ZIP archives, build logs or browser code. Runtime secrets from the previous interrupted session need to be replaced with a newly chosen PIN at publication because that PIN was never delivered to the owner.

Use the existing Sites project after restoring its account connection, push this source through the Sites source helper, package the matching build, then publish. Configure the hosting audience to allow visitors to reach the app's PIN gate; the gate supplies the requested activation check. Do not use Google/ChatGPT sign-in as an extra gate for friends.

For future app updates, edit this separate project and publish a new build to the same HTTPS origin. Users choose Install update & reopen when ready. Their local records stay on that origin. Changing hosting domains does not move browser data; export and restore a JSON backup first.

The copied native build scripts and older docs are retained for reference. This README describes the selected shareable web version.