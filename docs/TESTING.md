# Verification and device acceptance

## Version 1.4 status

The 1.4 source adds action-PIN protection, offline parsing and optional Apple on-device interpretation, goal images, first-use input refinements, oval glass tabs and versioned native launch branding. Use [VERIFICATION.md](VERIFICATION.md) for the final commit, automated counts and commands actually completed. The focused action-PIN suite currently covers 12 cases; these are source checks with injected storage boundaries, not a physical Keychain or device acceptance result.

Earlier 1.3 evidence included TypeScript/tests, a Hermes export, Expo compatibility checks and Home/tab inspection in an older Android development client. That client cannot establish 1.4 native module behavior. No completed native Swift compilation, signed iOS installation, physical iPhone/iPad photo/keyboard/AI/notification acceptance or security review is implied by those historical results. Record the build identifier and evidence separately for each release.

Every device item below remains unchecked until a tester records the device model, iOS version, build identifier, tester, date and evidence. Version 1.4 has an action PIN for changes, with no launch PIN or biometric gate. Cloud synchronization and online AI are absent.

## Available automated checks

Use Node.js 22.13 or later and the committed lockfile. On Windows PowerShell, use the `.cmd` variants if execution policy blocks npm's PowerShell wrapper.

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npx.cmd expo install --check
npx.cmd expo-doctor
```

Repository tests use `node:sqlite` against the actual SQL and migrations. Coverage includes restart persistence, transactional rollback, stable-ID retries, integer money, search and date filters, edits and reversals, goal allocations and completion, budget calculations, immutable audit rows, safe wallet archival/transfers, photo-note validation, and backup validation/restoration. Older supported schemas and backups must retain their financial history when upgraded.

Other tests cover offline chat interpretation and confirmation drafts, CSV/XLSX parsing and formula rejection, calendar periods, deterministic reminder planning, daily-summary totals and the 28-day summary window, timezone rescheduling, CSV escaping, build metadata and versioned launch resources. Current action-PIN tests compare PBKDF2 output with Node's implementation, validate normalization/salts, persist lockouts across service recreation, block unauthorized edits/imports and concurrent-ID bypasses, and distinguish committed reset from failed credential cleanup. Consult the actual AI test files and final command output for provider routing/schema/transport coverage. Automated tests do not invoke the iOS photo library, real Keychain failure modes, Apple models, notification delivery, native file pickers or device data-protection behavior.

## Required device matrix

| Device class | Portrait | Landscape | Light/dark/system | Largest practical Dynamic Type | Keyboard/forms/safe areas |
| --- | --- | --- | --- | --- | --- |
| iPhone 16 Pro Max class | [ ] | [ ] | [ ] | [ ] | [ ] |
| iPad Air M2 class | [ ] | [ ] | [ ] | [ ] | [ ] |
| Smaller supported iPhone | [ ] | [ ] | [ ] | [ ] | [ ] |

For iPad, also inspect centered form widths, chart sizing, resizing and permitted multitasking sizes. Check long wallet names, large currency amounts and readable text. Verify usable touch targets and VoiceOver announcements for fields, navigation, errors, progress, completion and saved status. Include both an Apple-AI-capable iPhone/iPad with its model ready and an unsupported/unavailable device or OS to check basic fallback. Native Foundation Models compilation and availability must be recorded from a real build; passing JavaScript tests cannot establish either.

## Upgrade, first use and navigation

- [ ] Back up the installed tracker, then update in place using the same signing identity and bundle ID. Verify all transactions, wallet balances, savings links, reminder definitions, photos and audit history survive migration.
- [ ] Complete fresh setup one animated question at a time, including its action-PIN/recovery step. On name, custom currency, wallet, amount, budget and balance-name inputs, type quickly, replace selected text, paste, correct text and use Back/Continue. Focus/caret and entered values must stay stable with the keyboard visible; input must not disappear or reset during animation. Test returning-user JSON restoration, cancellation, quick tour and information buttons.
- [ ] Inspect the blue gradient/glass appearance, 3 px box corners, full-width cards, circular profile photos and oval glass tab bar with its moving circular lens. Check every selected tab, safe-area clearance, long labels, light/dark appearance and Reduce Motion on iPhone; other platforms may use a different blur treatment.
- [ ] On both a fresh install and an in-place update, cold-launch repeatedly from the Home-screen icon with no Metro connection. Verify the R icon, native R splash and subsequent loading/welcome branding; no old F mark should flash. Confirm the installed version/build/commit. Inspect the generated and compiled versioned `RobbTrackerLaunchV1_4_0` storyboard/resource markers in build evidence, then test actual iOS launch snapshot behavior. Do not delete the user's data merely to hide an upgrade issue.
- [ ] Repeatedly open and return from every page using both the back button and swipe gesture. There must be no blank/loading flash or obstructing overlay; the header back button must omit the word “tabs”.
- [ ] Focus Notes near the bottom of a form and type multiple lines. The active text must remain visible above the keyboard. Repeat in Quick chat and searchable dropdowns.
- [ ] Change profile photo, display name, balance label and preferences. Save must be disabled without changes; successful updates must show clear feedback. Reopen to verify persistence.
- [ ] Customize Home shortcuts in Settings, reorder them and remove/add choices. Reopen to verify the selection and order persist. Check all destinations, including Quick chat, month overview, last 7/30 days, wallets, notifications, manual/FAQ, Performance, goals, audit and import.
- [ ] Confirm Home shortcut amounts and counts, notification status and Settings information update after changes. Last 7/30-day shortcuts must open the matching Performance range.

## Action PIN and recovery

- [ ] On a fresh tracker, create exactly 6 digits, confirm them and choose two distinct recovery questions, including the parents-meet option. Try a mismatched confirmation, short PIN, blank answers and duplicate questions. Invalid/cancelled setup must not silently advance as completed. Reopen the app: there must be no launch PIN.
- [ ] Upgrade a populated tracker without current action credentials. Open/read/export and add an income/expense/transfer/contribution/new wallet/goal/category/tag/reminder without a PIN prompt. Its first protected change must require PIN/recovery setup. If Keychain already has an action PIN after reinstall or incomplete cleanup, verify/recover it instead of silently overwriting it.
- [ ] For each protected action in [SECURITY.md](SECURITY.md), test a correct PIN, incorrect PIN and Cancel. Cover transaction edits/voids, an import updating an existing ID, wallet edits/rates/removal, category/tag edits/removal, goal edits/status, reminder edits/Dismiss, budget/threshold changes, backup replacement and full reset. Denied/cancelled authorization must leave money, records and audit history unchanged. Each new protected operation must ask again.
- [ ] Verify new-record imports and preallocated IDs remain PIN-free, and reminder Complete/Snooze plus cosmetic profile/theme/notification/Home preferences remain PIN-free. Automatic goal completion from a newly confirmed contribution must not introduce a second PIN request or invent money.
- [ ] Enter five wrong PINs, force quit and reopen. The 30-second lockout must persist and affect recovery too. After expiry, another failure must increase the delay; successful verification must clear failures. Confirm countdown and cancellation remain usable. Exercise unavailable/unwritable SecureStore with a controlled test build: protected operations must fail closed.
- [ ] Change PIN using the current PIN; the old PIN must stop working. Recover using both answers with different capitalization, fullwidth compatibility characters and extra spaces. One wrong answer must not reset the PIN. Change recovery questions with the current PIN and verify only the new pair works.
- [ ] Export backup/CSV and inspect for absence of PIN, recovery answers/hashes, retry state and AI keys/preferences. Restore on a clean device and configure that device's own action PIN; restore must not transfer another device's credentials.
- [ ] Reset with cancellation and incorrect confirmation first, then authorize a reset. A failed SQLite reset must retain PIN/AI credentials. A successful reset must attempt to clear both and remove financial records. Simulate secure cleanup failure after SQLite commit: show the truthful reset message and empty tracker, with recovery of any retained PIN possible; do not show old records as though the reset failed atomically. Previously exported files remain external copies.

## Transactions, wallets and goals

- [ ] Starting with PHP 10,000.00, add PHP 2,000.10 income and a PHP 100.01 expense. Available money must be PHP 11,900.09. Edit the expense to PHP 150.01, then reverse it; totals and audit history must follow each change.
- [ ] Create Cash, BDO, a wallet with a custom currency/manual rate, and a liability wallet. Verify currency labels, inclusion switches and asset-minus-liability totals. Rates are entered manually.
- [ ] Add transactions in the past, today and the future. Balances change when saved; calendar-month/year charts include the complete selected calendar period. Rolling periods retain their stated boundaries.
- [ ] Save income, expenses, transfers and adjustments through the form; save through Quick chat and CSV/XLSX import; save a goal contribution; create a wallet with an opening amount. Each successful financial entry must open Transactions with cleared filters, All time and Latest added selected, and the saved record visible/highlighted, including a past-dated entry.
- [ ] Edit and reverse a transaction, then verify the updated record is visible after returning to Transactions. Test Latest added, Earliest added, transaction-date sorting, amount sorting, all-time/7/30/365-day/custom ranges, type, wallet, category, tag and search filters.
- [ ] Confirm repeated save taps and retries create one intended financial record. Failed validation must keep the form/draft and preserve existing balances.
- [ ] Attempt an expense/transfer exceeding wallet funds and an expense exceeding the main balance. Cancel without saving, then explicitly accept the negative balance and verify the result.
- [ ] Transfer Cash to BDO, exchange currencies with separate sent/received amounts, repay a liability and reverse a transfer. Transfers and savings must not increase spending totals.
- [ ] Remove a funded asset wallet using Move all. Choose Cash or another asset wallet, including one with a different currency, then verify one full-balance transfer using saved rates, wallet archival, the destination balance, available total and preserved history/photos. Repeated taps must not duplicate the transfer.
- [ ] Remove a funded wallet using Exclude. Verify the confirmation names the amount, cancellation changes nothing, and confirmation removes the wallet's balance from the total while keeping its historical records. Repeat for a liability and a zero-balance wallet. The final active asset wallet cannot be removed.
- [ ] Record a PHP 500.00 goal contribution. Spendable balance must fall by PHP 500.00, goal progress must rise by PHP 500.00, and expense totals must stay unchanged. Reverse it and verify both effects reverse consistently.
- [ ] Tap Mark complete on an underfunded goal. It must explain the remaining amount and offer a separately reviewed contribution. Cancel without adding money; test the prefilled contribution, insufficient funds, paused-goal resume, automatic completion at the target and visible status feedback. Completion must never invent money.
- [ ] Create a goal with an optional image, replace/remove the image on an existing goal after PIN confirmation, and change its name without resupplying the image. Reopen and verify the image stays associated with the correct goal and does not affect funding. Check list/details display, large and unsupported image rejection, and older goals upgrading with no image.
- [ ] Mark a one-off reminder complete and verify its visible completed status. Complete a recurring reminder and verify feedback plus its advanced next due date. Test snooze, dismiss, related goal pause/resume/completion and persistence after relaunch.

## Photo notes and local backups

- [ ] Attach readable receipt/text images to a transaction and a savings contribution. Test JPEG, PNG and a supported library image requiring conversion. Preview full-screen, pinch to zoom, rotate the device, close the preview and remove an attachment.
- [ ] Save and reopen the record. Compare fine text against the selected original at the same zoom: resolution must be retained, with no intentional resize or lossy recompression. An already compressed original need not become smaller.
- [ ] Edit only the attached photos and verify Save becomes enabled. Save without changing anything and verify Save stays disabled. Confirm transaction details display the saved photos.
- [ ] Test photo-library cancellation, limited/denied access, three-photo maximum, over-24-megapixel sources and oversized attachments. A rejected selection must preserve the existing note/photos and explain the size problem. Verify no server upload is needed.
- [ ] Create a version-4 JSON backup containing profile/goal/note photos, reversed records, removed wallets, goals, reminders, Home shortcuts and daily-summary preferences. Restore on an empty installation and compare counts, balances, goal progress and readable image content. Confirm PIN and AI credentials/preferences were not included.
- [ ] Test older supported backups, replacement of an existing tracker after explicit confirmation, cancellation, corrupt checksums, invalid JSON, malformed images, broken references, duplicate IDs and files above 128 MB. Invalid input must leave current data intact. Restore must replace atomically rather than merge histories.
- [ ] Verify restored notification permission is not treated as authorization transferred from another device. Enable phone alerts explicitly on the new installation and inspect the scheduled queue.
- [ ] Export CSV and open it in Excel/Google Sheets. Check Unicode, commas, quotes, multiline notes, currency labels and escaped formula-like descriptions. CSV must not contain embedded note photos and must not be presented as a full backup.
- [ ] Download the separate import template, remove sample rows, fill past entries and import CSV/.xlsx. Verify row errors, duplicate skips, explicit confirmation, overdraft approval and repeat-upload behavior.
- [ ] Test full tracker deletion: cancellation, incorrect confirmation text and successful reset. App records and scheduled tracker alerts must be removed. Previously exported files and operating-system backups remain outside that reset.

## Daily summaries and phone notifications

- [ ] On a fresh tracker, verify daily summaries are enabled in preferences while phone delivery still requires enabled app alerts and operating-system authorization. Denying permission must leave all financial features and reminder definitions usable.
- [ ] Enable alerts and inspect the next local daily summary at 23:59:59. Test actual lock-screen delivery on a signed device build, including Airplane Mode and force quit. Exact-second delivery is controlled by iOS and must not be claimed from the schedule alone.
- [ ] For one day, record expenses in multiple currencies/wallets plus income, a transfer, a contribution, a reversed expense and an expense on another date. That day's summary must include only its active expenses, expressed in the main currency, with the correct count. Excluding a wallet from available balance must not erase its historical spending from the summary.
- [ ] Add, edit and reverse today's expenses, then inspect refreshed notification content and the in-app daily preview. Verify an empty day reports zero, future-dated expenses appear only on their chosen day, and supportive wording follows the saved budget/thresholds without invented spending.
- [ ] Inspect lock-screen previews: financial totals and expense counts can appear. Confirm the app's Hide balance switch does not imply notification redaction. Disable summaries separately, disable all phone alerts, and adjust iPhone previews; verify the corresponding pending alerts change.
- [ ] Verify default, Chime, Pop and Silent sounds, the five-second test alert, Focus and silent-mode behavior. Confirm income/expense/transfer sounds occur only after successful saves; Performance plays a short feedback sound and respects the sound preference. Test haptics disabled and Reduce Motion independently.
- [ ] Check one-off/daily/weekly/monthly reminders, day 29/30/31, leap February, complete, snooze and dismiss. Foregrounding must reconcile the queue without internet.
- [ ] With summaries enabled, verify up to 28 future daily summaries and the earliest reminders share at most 60 pending tracker alerts (normally 32 reminder slots remain). Disable summaries and verify reminders can use the released slots. Exceed the window, then reopen the app to confirm later alerts are replenished without duplication.
- [ ] Check local-midnight, month/year and timezone/daylight-saving transitions where applicable. After returning to the app, verify dates and queued summaries/reminders match the device's local time.

## Offline chat and on-device intelligence

- [ ] Supported short entries return through the local parser without waiting for model/status/storage checks. No network connection is required.
- [ ] Test Auto and basic-only modes. Basic-only must not invoke the native model. Auto may use Apple on-device intelligence for harder messages when already available.
- [ ] On a compatible signed build, test model availability, unsupported OS/device, a missing native module and an unavailable model. Basic entry must remain usable.
- [ ] Test status/model timeout, cancellation, navigation away and malformed/refused model output. No financial or proposed-tag writes may occur before confirmation. Ambiguous content must not silently become an inaccurate basic draft.
- [ ] Try reviewed expense/income/transfer drafts, historical spending questions, misspellings, named dates, unknown wallets/categories and destructive or compound requests. Compare the saved transaction with the reviewed draft.
- [ ] Upgrade an older installation and verify obsolete provider credentials are removed without being displayed or read, and cleanup does not delay opening the tracker.

## Offline and privacy acceptance

- [ ] Install a signed build with an embedded JavaScript bundle, force quit, enable Airplane Mode with Wi-Fi/cellular disabled, and cold launch. No development server or cloud login may be required.
- [ ] Add/edit income, expenses, transfers and contributions; use charts, audit history, basic Quick chat, photos and locally available import/backup files offline. Protected changes still require the local action PIN; no network is needed for that check. Force quit and reopen; all saved changes must persist.
- [ ] Try “Jollibee Chicken Joy 128.56 food #wants from Cash”, adding salary to Cash, a transfer, spelling corrections, named dates and balance/spending questions. Review/cancel drafts without writing money or proposed tags; Confirm must save the reviewed details and return to Transactions.
- [ ] Unsupported/ambiguous chat amounts and missing wallets must produce a helpful error, with no fabricated interpretation saved. New custom hashtags must be created only after confirmation.
- [ ] Review the generated app's permission strings, entitlements, privacy manifests and database protection attributes. The action PIN does not hide/encrypt records in an unlocked app; hide balance is a display preference. Do not mark app-level encryption or biometric security as passed.
- [ ] Inspect network activity while using chat in both modes: the app must make no AI or connectivity requests. Device-level backups and user-selected sharing destinations need separate assessment.

Record failures and their scope before distribution. Automated results must remain separate from physical-device acceptance and any security/privacy sign-off.
