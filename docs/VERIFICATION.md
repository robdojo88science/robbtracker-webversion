# Current verification — 2026-11-02

Strict TypeScript and all **148 automated tests** pass. The current iOS JavaScript export passes with `--no-bytecode` at `dist/ios-js`. The app now has fully offline chat, optional Apple on-device intelligence, no online provider transport or API-key UI, and no connectivity dependency. Shipped AI-module checks reject network calls. Upgrade cleanup deletes the obsolete provider key without reading it.

Tests cover cached and cancelled on-device interpretation, the parser path without storage/native work, coalesced refreshes with concurrent-commit freshness, setup/cleanup replay, notification-input deduplication, one-pass daily summaries and wallet/trend/budget calculations, and retained money, PIN, audit, import and backup guarantees. See [offline responsiveness details](OFFLINE_PERFORMANCE.md).

No newly signed iOS app or physical-device latency/visual result is claimed. The Windows preview APK is missing. The earlier normal Hermes export was blocked by Windows denying compiler execution; the JavaScript-only export does not complete production packaging or native Swift compilation. Native PIN acceleration still requires a new iOS build.

The following sections are archived verification snapshots. Their former online-provider behavior and earlier appearance do not describe the current source.

# Robb Tracker 1.4 verification — 2026-11-01

The 1.4 update passes strict TypeScript and **111 tests**, all 20 Expo compatibility checks, iOS configuration introspection and native-module autolinking. The Hermes bundle exports to `dist/ios-v1.4`. Tests exercise action-PIN hashing/recovery, persistent lockouts, centrally guarded writes and concurrency, goal-image migration/v4 backup restoration, versioned native R launch resources, AI intent/transport validation, merchant/date routing, consent/offline gates, cancellation and quota fallback. No real Groq requests are made by tests.

The existing Android development client was used to inspect the Home layout, working oval tab selection, both setup amount fields and the first individual PIN question. A typed monthly budget remains readable with the keyboard open. No tracker reset, PIN creation or financial transaction was used for this preview. The older client cannot verify new native photo/audio/network modules or Apple Foundation Models. Temporary preview routes are removed from release source.

The Swift source and podspec are tracked and Expo resolves the `RobbAIModule` registration. Release packaging requires iOS SDK 26+, successful RobbAI CocoaPods installation and the compiled versioned launch storyboard. This Windows workspace does not establish successful native Swift compilation, signing, installation or physical iPhone/iPad behavior. Actual Apple/Groq responses, first-use keyboard interactions, PIN modal interaction, photo selection, native glass and launch snapshots remain device checks. See [the 1.4 guide](ROBB_TRACKER_1_4.md).

## Earlier 1.3 verification

Current update passes strict TypeScript, **81 tests**, all 20 Expo compatibility checks, and `expo export --platform ios --output-dir dist/ios-v1.3`. Schema 5 migrates installed data; v3 backups restore photo notes and upgrade v1/v2 files only after checking their original checksum. Regressions cover completion persistence, wallet archive/transfer rollback, savings availability after wallet removal, photo edit/backup preservation, deferred chat tag creation, and daily summaries at device-local 23:59:59, including rescheduling after time-zone changes. Home shortcuts and the working tab selection were visually checked in the existing Android development client. Exact iOS delivery, native photo tools, iPhone blur/selection lens, sounds, and back gestures remain device checks.

## Earlier 1.2 verification

Current update: `npm run check` passes strict TypeScript and **60 tests**. The new checks cover full-calendar future dates, rolling 7/30/365-day windows, dynamic budget remainder after edits/voids, custom currency backup restoration, shorthand/typo/named-date chat, and an Excel/Google Sheets CSV round trip. The iOS Hermes bundle exports to `dist/ios-v1.2` successfully.

Home and the compact expense form were visually inspected in the local Android emulator. Main expense fields and its fixed Save button fit on the first screen. The inspection caught a gradient-alpha issue, corrected using explicit SVG stop opacity. The emulator has an older native client, so it does not verify new audio/photo modules or iPhone blur. A clean Android compile failed on existing Gradle-cache native-library hard links; no successful fresh native compile or physical iPhone acceptance is claimed. See [the 1.2 update guide](ROBB_TRACKER_1_2.md).

## Earlier 1.1 verification

Current source uses Expo SDK 58 and React Native 0.88.1 on Windows. `npm run check` passes strict TypeScript and all **55** build identity, financial, migration, backup, import, chat, and notification tests. `npx expo-doctor` passes all 20 checks. Release config introspection verifies Robb Tracker 1.1.0, the unchanged `com.ftracker.personal` bundle identifier, arbitrary HTTP disabled, notification sound assets, and the new native modules. No app-lock module is configured.

The stale-install investigation verified remote main at commit `d52841e` contains the 1.1 update, while the IPA cached by Sideloadly identifies itself as F-Tracker 1.0.0 and contains the old green theme. The exact private workflow run could not be inspected, so the point where old code was selected is not confirmed. Build downloads now include version/commit/run/attempt, an exact-file checksum manifest, and native identity checks. Windows dry-run and identity tests pass; native macOS compilation remains an external check.

`expo export --platform ios --output-dir dist/ios-v1.1` exports Hermes bytecode and bundled assets successfully. This verifies JavaScript packaging, not native iOS compilation or signing.

The local Android preview attempt stopped at a generated-file deletion/access error; no usable emulator AVD or in-app browser session was available. Visual layout, keyboard interaction, native sounds/haptics, photo picker, offline cold launch, and reminder delivery remain unverified on the updated app. No signed 1.1 IPA or physical iPhone acceptance result is claimed. See [the update guide](ROBB_TRACKER_1_1.md) and the current device checklist at the top of TESTING.md.

The earlier snapshot below is historical. Its PIN/biometric tests and privacy-overlay descriptions do not apply to 1.1, which removes the separate app lock.

## Historical snapshot — 2026-10-31

Environment: Windows, Node.js 24.18.0, npm 11.16.0, Expo SDK 58, React Native 0.88.1. Results below apply to the source in this folder, not to an installed iOS binary.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed, strict TypeScript |
| `npm test` | 32 passed, 0 failed |
| `npx expo-doctor` | 20/20 checks passed |
| Release-mode `expo config --type introspect` | Passed; valid bundle ID, tablet support, iPad orientations, Face ID description, arbitrary HTTP off, remote updates off |
| Release-mode `expo export --platform ios --output-dir dist/ios` | Passed; native iOS Hermes bytecode and assets exported |
| `npm audit` | 13 moderate findings in transitive Expo build tooling; no high/critical project findings; review required before release |
| `eas whoami` | Not logged in |
| Local iOS prebuild | Unsupported on this Windows host; EAS/macOS required |
| Signed native iOS compilation / IPA | Pending account setup and signing |
| Physical iPhone/iPad, Airplane Mode, native Face ID/Touch ID, real notification delivery | Pending |
| TestFlight / App Store | Pending |

Tests use actual SQLite tables/migrations/repositories for financial persistence and backup restore, and injected native boundaries for platform-domain security tests. Currency formatting additionally preserves every centavo at the maximum safe aggregate integer. Notification planning covers month-end clamping and same-/cross-month snoozes without skipping the upcoming preferred payment day.

The Hermes export is stored in ignored `dist/ios`; it is not an installable IPA. No cloud account was created, no signed cloud build was started, no physical-device pass was claimed, and no store submission was made. See [device acceptance](TESTING.md), [release runbook](RELEASE.md), and [security review](SECURITY.md).
