# Private, free-only personal iPhone installation

The current plan keeps the source private and uses Windows for installation. No Apple Developer Program enrollment, EAS cloud build, TestFlight, App Store upload, subscription, or paid signing service is part of this plan.

There is no promise of unlimited free cloud builds. GitHub Free includes a limited allowance for private-repository Actions compute and artifact storage. macOS builds consume that allowance. The account must block paid usage; when included usage is exhausted, stop and wait for the reset rather than purchase more. See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## Account setup before any build

1. Use a GitHub Free account and a **private** repository containing only this source project. Do not upload financial databases, exported backups, `.env`, signing keys, or `node_modules`.
2. In GitHub billing settings, verify Actions paid usage is blocked. An account without a payment method is blocked after included compute is used, according to GitHub's billing documentation. If a payment method is present, set applicable Actions spending budgets to zero **with usage blocking enabled**, and verify both compute and artifact/storage coverage. An alert-only budget does not block charges.
3. Check the remaining included compute and artifact storage before each run. Existing usage elsewhere on the account also counts. Keep storage within the included allowance and delete downloaded artifacts promptly.
4. Only after those checks, add a repository Actions variable `FTRACKER_FREE_BUILDS_ENABLED` with value `true` under Settings → Secrets and variables → Actions → Variables. This enables the manual job; it does not inspect or change account billing settings.

No repository has been uploaded or build triggered by preparing these files. Your billing state has not been inspected. It is not safe to call an unverified account setup guaranteed free.

## Build from Windows through the private repository

The prepared `.github/workflows/ios-personal.yml` uses a standard macOS runner and has **only a manual trigger**. It does not run on every commit or on a schedule. It requires the repository variable and the manual free-only confirmation. It uses no Expo, Apple, or signing credentials.

Once the source is in your private repository, open Actions → **Build Robb Tracker iPhone** → **Run workflow** and choose **main**. Confirm the free-only conditions only after checking them. Start a new run after pushing updates: **Re-run jobs** on an old run reuses its original code.

A successful build produces a uniquely named download such as `RobbTracker-1.1.0-ab12cd3-build4-1`, retained for one day. Its ZIP contains the matching `.ipa` and `ios-build-manifest.json`. The run summary lists the source commit and verifies the packaged app name, version, build, offline bundle, and checksum. Extract the ZIP into a new folder on Windows and select that exact IPA in Sideloadly. After installation, More displays its version, build, and commit. Existing `ftracker-unsigned-ipa` downloads are from the previous workflow and are not renamed retroactively.

The 60-minute timeout, one concurrent build, 150 MB output cap, no explicit caches, and one-day artifact retention reduce usage, but do not replace account-level billing controls.

This workflow has not been run on a macOS runner yet. It may need adjustments for the runner's Xcode version, CocoaPods, or Expo SDK native compilation. If the standard runner cannot compile this SDK, stop and fix the toolchain; do not switch to a paid/larger runner. Failed runs still consume included compute.

## Install and renew on your iPhone/iPad

Use [AltStore Classic for Windows](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows) or [Sideloadly](https://sideloadly.io/faq) from their official sites. These tools sign the unsigned IPA using your free Apple account and install it on your own device. They do not compile the app source. Complete Apple authentication directly in the selected tool, never in GitHub secrets or this chat.

Free-account provisioning expires after seven days. Refresh it with internet before expiry. Sideloadly supports refresh over USB or configured Wi-Fi access to your computer. Keep the same Apple ID and bundle identifier when refreshing, and update the existing installation rather than deleting it. Keep a F-Tracker backup before changing builds; uninstalling can remove local financial data.

The unsigned IPA is not a finished signed installer and cannot simply be tapped to install. Device compatibility, local notifications, secure storage, offline relaunch, and data preservation across re-signing still need actual device verification. If a free-signing tool reports an unsupported entitlement, stop and adjust the native configuration for local-only capabilities; do not buy a certificate to bypass it.

## If you later have access to a Mac

With Xcode, CocoaPods, Node.js 24, and dependencies installed:

```sh
npm ci
npm run check
npm run build:ios:unsigned
```

The same script compiles and packages the unsigned IPA locally without calling a cloud build service. A Mac and native iOS toolchain are required for compilation; Windows runs the sideloading tool afterward.

## Costs excluded by the current plan

- No paid Apple membership or App Store publishing.
- No paid EAS builds, upgraded GitHub plan, larger runner, or paid build overage.
- No paid sideloading certificate or subscription.
- No cloud database subscription; the tracker remains local-only.

Your existing internet connection and computer/device are assumed. Third-party plans and signing rules can change; recheck their official terms before enabling the build.
