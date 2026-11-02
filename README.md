# Robb Tracker - Shareable offline app

This is the separate web-app version of Robb Tracker. The original native app is unchanged. Friends open a link and install the app on their iPhone or iPad. There is no shared access PIN, account sign-in or Cloudflare setup.

Each person creates their own tracker and **personal 4-digit action PIN**. That PIN still protects edits, removals and important changes. Financial records stay on that person's device.

## Open and install

**Publication is being prepared.** The expected address is https://robdojo88science.github.io/robbtracker-webversion/ . It is not a verified live link until GitHub Pages reports a successful deployment.

Once published:

1. Open the app link in **Safari** while connected to the internet.
2. Tap **Share -> Add to Home Screen**. Enable **Open as Web App** if shown, then tap Add.
3. Open the new blue **R** icon and wait for **Ready to use offline** in Settings -> Install & share.
4. Create your tracker or restore your own JSON backup. Choose your personal action PIN during setup.

Daily transactions, wallets, transfers, budgets, charts, goals, saved reminders, history and quick chat work offline after the app files are ready. First installation and app updates require internet.

Send friends the same app link. **Sharing the app does not share your records.** They start with their own empty tracker. No Windows laptop, App Store submission, signing certificate or weekly sideload refresh is required to install, use or share the published app.

[Apple's Safari installation instructions](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)

## Publish and update

Source repository: https://github.com/robdojo88science/robbtracker-webversion

[GitHub Pages setup and update instructions](docs/GITHUB_PAGES.md)

GitHub Pages serves this app from its public repository. The application source is public; each user's financial records remain local in IndexedDB and are not uploaded to the repository or hosting service.

## Keep your records

Use **Settings -> Backup & data -> Save backup to Files** regularly. A JSON backup can restore your complete tracker on another device. Clearing website data, removing browser storage or storage eviction can remove local records and offline files. There is no automatic device-to-device synchronization.

The personal action PIN controls app changes; it does not encrypt the ledger or replace the phone's device protection. JSON backups and spreadsheet exports contain readable financial data, so save them somewhere private.

## Browser differences

- Offline quick chat keeps shorthand, spelling corrections, dates, multiple entries and spending questions. The native Apple intelligence module is unavailable in browsers.
- Reminders and summaries remain available in the app. Browser alerts require permission and an open, visible app. Reliable offline alerts after closing the app are unavailable.
- Excel/Google Sheets-compatible `.xlsx`, CSV and JSON backup import/export use the browser's file picker and share/download controls.
- Profile, goal and receipt images use portable JPEG, PNG and WebP data.
- App updates wait for the user. A failed download preserves the previous cached version and local records.

## Local development

Use Node.js 24 LTS.

```sh
npm ci
npm run build:pages
npm run check
npm run preview:web
```

The Pages build uses the repository path `/robbtracker-webversion/`. Open the matching path on the local preview server when checking that build. A local root-path web build is available through `npm run build:web`.

The generated static app includes every route chunk, icon, font, sound, SQL.js engine and WASM file needed for offline use. A public HTTPS host serves the files; no activation server or access-PIN secrets are required.

Automated checks cover the financial rules, browser storage, personal PIN and offline cache behavior. Physical iPhone/iPad installation and airplane-mode acceptance still need verification after publication. Older native-app documents are retained for reference; this README describes the selected web version.