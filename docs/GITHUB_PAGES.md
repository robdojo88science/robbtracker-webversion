# Publish and share with GitHub Pages

The selected version has **no shared access PIN** and needs no Cloudflare account or activation server. Each person keeps their personal four-digit action PIN and local financial records.

Repository: https://github.com/robdojo88science/robbtracker-webversion

Expected app address: https://robdojo88science.github.io/robbtracker-webversion/

**Publication is pending until GitHub Pages confirms a successful deployment.** An expected address alone is not proof that the app is live.

## Owner setup

GitHub Pages is free for public repositories on GitHub Free. This publishes the application source code. It does not publish the financial records stored inside an installed user's browser.

If the repository is not public yet, finish the visibility change for this web repository only. Keep the original native repository separate.

Then, in the web repository on GitHub:

1. Open **Settings -> Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Open **Actions** and run or wait for the Pages deployment workflow.
4. When the deployment succeeds, open the address shown in its deployment result.
5. Check that the app opens, all offline files finish downloading and Settings -> Install & share shows **Ready to use offline**.

The publishing operator may enable Pages through GitHub's API instead of these settings. No separate Cloudflare account, purchased domain, server database or shared-PIN secrets are needed.

## Automatic publishing

The GitHub Actions workflow installs locked dependencies with `npm ci`, builds with `npm run build:pages`, runs `npm run check`, uploads the static site and deploys it through GitHub Pages.

The repository base path is `/robbtracker-webversion/`. Keep that path when building and serving this project; the service worker, database engine and app routes use it. The workflow publishes the generated `dist` files, not the source folder or a ZIP archive.

New commits pushed to the configured production branch trigger another hosted build. Users see **Install update & reopen** when a new cached version is ready. Local records stay on the same website origin when the application updates.

If the repository name or website address changes, update the build's base path. Moving to another origin does not automatically move browser data. Export a JSON backup first and restore it from the new app.

## Friend installation

1. Send your friend the published app link.
2. They open it in Safari while online.
3. They choose **Share -> Add to Home Screen**, enable **Open as Web App** if shown and tap Add.
4. They open the R icon and wait for **Ready to use offline**.
5. They create their own tracker and personal action PIN, or restore their own backup.

The first installation and later updates need internet. Everyday finance entry and calculations work offline after the cache is ready. Everyone has separate records. Use **Backup & data** to save JSON backups to Files; clearing website data can remove browser-local records.

Reminders remain visible offline, but browser alerts need permission and an open, visible app. The browser version uses the offline chat parser rather than native Apple intelligence.

## Check after publication

Verify the actual deployed link on iPhone and iPad, not only the build result:

- Install through Safari and wait for offline readiness.
- Create a tracker and confirm the personal action PIN works.
- Add an expense, close and reopen the app, and confirm the record remains.
- Turn on airplane mode and open Home, Transactions, Performance, Goals and Settings.
- Export a JSON backup to Files and check the spreadsheet export/import flow.
- Install an app update and confirm saved records remain.

## Official references

- [GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Configure the Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Install a web app from Safari](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)