# Robb Tracker 1.3

## Changes

- Completion buttons now show their result. One-time reminders move to Completed; recurring reminders show the next date. A goal that has not reached its target explains the remaining amount and offers a contribution form; it never creates money just to mark itself complete.
- Page content no longer resets its fade when another page opens, preventing blank flashes during back navigation. Back buttons use the arrow alone.
- Profiles are circular. Other boxes use a radius of 3 points. Glass panels extend to the page edges; Home shortcuts remain a compact grid. The tab bar has a moving circular selection lens and honors Reduce Motion.
- Saving transactions through forms, chat, imports, wallet opening balances, or savings opens Transactions. It starts at All time / Latest added and highlights the saved record. You can still sort by transaction date, creation time, or amount.
- Preferences → Home shortcuts lets you choose and reorder shortcuts, including this month, last 7/30 days, chat, notifications, wallets, help, imports, and activity. The Help screen contains a searchable manual and FAQ.
- Notification settings show actual phone permission and scheduled counts, plus today's current expense total. Performance uses a brief optional sound; the sound/vibration switches control feedback.
- Removing a wallet offers moving its full positive asset balance to another wallet or excluding it from totals. Both preserve history. Transfers and removal commit atomically. At least one active asset wallet must remain; debts cannot be moved as if they were cash.
- Notes accept up to three local photos, with removal and zoom previews. The picker preserves original resolution and uses lossless PNG when that is smaller than the original. Already compressed originals may remain unchanged. Oversized images are rejected rather than blurred or silently resized. Photos travel in JSON backups; audit history retains fingerprints instead of duplicating image data. Backup upload limit is 128 MB.
- Chat includes income/transfer examples and understands `Jollibee Chicken Joy 128.56 food #wants from cash`. New tags are created only when you confirm the transaction.

## Daily summary

Daily spending summaries are enabled by default. App alerts and iPhone notification permission must also be allowed. A summary is scheduled at **11:59:59 PM in the phone's local time**, with that day's active expense total/count and a supportive budget-pace message. Saved edits and voids refresh the pending content. Tap the notification to open that day's transactions.

The offline app schedules a rolling 28-day window and reserves remaining notification slots for reminders. Open the app periodically to renew the window. iPhone controls actual presentation, timing, Focus and sound; delivery at an exact second cannot be guaranteed. No server, push token, or internet connection is required for these local alerts.

## Sharing with friends

AirDrop alone cannot make this personal unsigned IPA installable on another iPhone. TestFlight and the App Store are the usual options without Developer Mode; publishing through them requires Apple Developer Program membership. TestFlight builds expire after 90 days. The existing free Apple-ID sideloading route retains its signing/renewal requirements.

References: [Apple distribution](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases), [Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device), [TestFlight availability](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).

## Update and verification

Save a JSON backup, then build a new IPA from the latest main commit under **Actions → Build Robb Tracker iPhone → Run workflow** using the existing free-usage checks. Download the `RobbTracker-1.3.0-…` artifact and install over the existing app with the same Apple ID/bundle identity. More shows the version and commit. Do not rerun an old workflow run to obtain new code.

TypeScript, 81 tests, all 20 Expo compatibility checks, and the iOS Hermes bundle pass. Tests include actual database migration/backups, funded-wallet removal/transfer rollback, goal/reminder completion, photo persistence, chat, daily-summary scheduling and time-zone changes. Home shortcuts and the tab selection were visually checked in the existing Android development client. Native iPhone photo picking/compression, zoom, blur/lens, permissions, sound, back gestures and late-night delivery still need physical-device acceptance testing. This workspace does not produce a signed native iPhone IPA.
