# Security and privacy

This document describes the 1.4 implementation: a local financial ledger, action-only PIN protection, and offline chat parsing and optional Apple on-device intelligence. Final automated results and their scope belong in [VERIFICATION.md](VERIFICATION.md). Native security and AI behavior still require the physical-device checks in [TESTING.md](TESTING.md). Source tests and a JavaScript export do not establish native iOS compilation or a security review.

## Data and threat model

Each installation has one private tracker. SQLite is the source of truth for balances, transactions, budgets, goals, reminders, and audit history. There are no shared accounts, household dashboards, administrator views, application analytics, advertising integrations, or implemented cloud synchronization endpoints. Chat messages are interpreted on the device; there is no online AI provider. Development tooling and builds use network services separately from installed financial features.

The app protects against accidental disclosure and casual access to a normally secured personal device. It does not claim protection against a compromised operating system, a jailbroken device, malicious code running with app privileges, or an attacker who can extract and modify the app's files.

The SQLite database is **not encrypted with SQLCipher**. Local storage relies on the iOS application sandbox and the device's OS encryption/Data Protection. The project does not configure a stricter custom file-protection class. Inspect the generated app and actual database protection attributes before release, and decide whether the intended threat model needs SQLCipher and device-protected encryption keys. Expo documents SQLCipher as a separate native build option in its [SQLite reference](https://docs.expo.dev/versions/latest/sdk/sqlite/).

## Action PIN and device protection

Version 1.4 introduces a **4-digit action PIN**, not an app-opening lock. Anyone able to open the app on an unlocked phone can still read records, view photos, export a backup, and add new records. There is no launch PIN, Face ID gate, or background privacy overlay. Use the iPhone's device protection for access to the app itself. Hide balance is a display preference, not authentication, encryption, or notification redaction.

New PINs have four digits. Existing six-digit credentials continue to verify until changed or recovered into a four-digit PIN. Setup stores two recovery questions; either correct answer can reset the PIN. An existing tracker without action credentials is asked to configure them at its first protected action. If Keychain already contains an action PIN, setup requires that PIN or recovery instead of overwriting it. Settings → Action PIN can change the PIN using the current PIN, reset a forgotten PIN using either saved answer, or change recovery questions using the current PIN. Recovery answers undergo NFKC normalization, trimming, whitespace collapsing and lowercase comparison. Keep both answers private. Entry fields offer show/hide controls; saved answers are never displayed.

| Operation | Action PIN |
| --- | --- |
| Open/read the app, charts, audit history, backup/CSV export | No |
| New income, expense, transfer, savings contribution, wallet, goal, category, tag, or reminder | No |
| Import containing only new transaction IDs; restore into an empty tracker | No |
| Reminder Complete or Snooze; profile, photo, theme, sound, notification and Home-shortcut preferences | No |
| Edit/void an existing transaction; import that updates an existing transaction ID | Required |
| Edit/remove a wallet, including its rate or inclusion in available balance | Required |
| Edit a goal or change its status; edit a reminder or Dismiss it | Required |
| Rename/edit/delete an existing category or tag | Required |
| Budget, spending thresholds or main-currency change attempt | Required; currency validity restrictions still apply |
| Replace an existing tracker from backup; full tracker reset | Required, in addition to the existing confirmation |
| Change offline interpretation preference | No |

The repository supplied by AppProvider checks financial operations centrally. It distinguishes a preallocated ID for a new record from an ID already present in the ledger. Imports follow the same rule. Mutations are serialized so concurrent calls using one ID cannot turn a second add into an unprotected edit. Authorization applies to one operation; there is no cached unlock period. PIN confirmation does not waive normal financial validation or create funds. A new contribution that automatically reaches a goal's target remains a new-record operation.

PIN and recovery answers are stored as independently salted PBKDF2-HMAC-SHA256 hashes: 210,000 iterations, 32-byte random salts, and 32-byte derived values. They are not stored as plaintext or a single fast digest. The record is held in SecureStore with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; the installation identifier uses SecureStore separately. Old launch-lock credentials are not reused.

PIN and recovery share a persistent attempt counter. Attempts are saved before verification. The fifth failure starts a 30-second retry delay; later failures increase the delay to a maximum of 15 minutes. Closing or restarting the app does not clear this state. A correct verification clears failures after any active delay expires. Unavailable, unreadable or unwritable secure storage blocks protected operations instead of silently replacing the PIN. This is an application control, not protection against extracted/modified files or malicious code with app privileges.

Credentials and retry state are excluded from finance snapshots, audit history and backups. A restored tracker does not carry another phone's PIN or recovery answers. Full reset clears finance records first, then attempts both PIN and offline-preference cleanup. Failed financial reset preserves credentials. If secure cleanup fails after financial reset commits, the app reports that records were reset and refreshes to the empty tracker; it does not claim the old ledger remains. SecureStore and SQLite are separate stores, so their cleanup is not one atomic transaction.

## Offline interpretation

Basic chat parsing and ledger calculations run locally. Simple accepted entries return before native model availability or preference reads. Auto mode uses Apple on-device intelligence for harder messages when available; basic mode skips that model. Unsupported or ambiguous messages produce an error and save nothing.

The native Apple implementation uses Foundation Models when the build, OS and device report it available. A missing module, unsupported build/device or unavailable model leaves basic entry usable. Native checks and interpretation have bounded deadlines and cancellation. Model readiness is controlled by the device; the app does not start a model download while interpreting.

There is no online AI transport, provider-key input or connectivity polling. Offline preferences are stored separately from financial records. An upgrade cleanup deletes the obsolete provider key without reading or displaying it, and retries if deletion fails. This does not retract submissions made by an older build. No API keys or messages are sent to an AI server.

Models return an untrusted structured intent. Local code checks its schema, supported action, amount, dates and existing wallet/category references. It calculates balance/spending answers from SQLite and shows transaction drafts for explicit confirmation. Models cannot call repository methods, execute code, edit/delete/reset the ledger, or save a transaction by themselves. Prompt instructions and validation reduce errors; they do not guarantee a model always understands a message correctly. Review the draft before saving.
## Ledger and audit integrity

Money uses integer centavos. Financial writes, related records, and audit entries share a SQLite transaction. Stable identifiers prevent repeated successful requests from creating duplicate ledger entries. Edits record before/after values; voids preserve financial history and reverse their balance effect. Savings contributions allocate funds from spendable balance and are kept separate from expense totals.

SQLite triggers prevent ordinary updates and deletion of audit rows. The normal UI offers no audit editing or individual deletion. This is an application integrity control, not a cryptographic or forensic guarantee: someone able to modify the database schema can bypass it, and an explicitly confirmed full tracker reset erases the audit history with the rest of the tracker.

Wallet removal is archival, not deletion of transaction records. The user can exclude a wallet and its balance, or atomically transfer the full positive asset balance to another asset wallet before archival. Historical records, including note photos, remain available. Transfers use saved manual currency rates, and at least one active asset wallet must remain. Goal completion does not fabricate funding; an incomplete goal offers a separate contribution for review and saving. Goal images do not change a goal's funding or balance effects.

## Photo notes

Transactions and savings contributions can store up to three local JPEG, PNG, or WebP data-URI attachments in SQLite. The repository validates image encoding and size limits before saving or restoring: at most 8,000,000 characters per attachment and 12,000,000 across a record. The picker also rejects sources over 24 megapixels. These bounds limit accepted storage and processing input; they do not constitute content inspection or a guarantee against malicious image decoders.

The picker retains source resolution, attempts lossless PNG encoding, and retains an eligible original image when smaller. It does not promise a smaller file for an already compressed source, and original image metadata may remain. The user can preview and zoom before saving; oversized images are rejected rather than silently blurred. New photo-note audit entries retain change fingerprints instead of duplicate image payloads. Image data remains in the transaction and full JSON backup. Removing an attachment does not remove previously exported backups; reversing a transaction keeps its attached history.

Goals can also hold one optional local image, limited to 8,000,000 encoded characters. New images are portable data URIs in JSON backups; older goals migrate with no image. Goal-image audit changes retain fingerprints rather than duplicate image contents. Images are not sent to chat interpretation by the app.

## Backups, exports, and restore

Backup JSON and transaction CSV contain **unencrypted private financial information**. The user chooses the destination through the native share sheet. Temporary application cache files are removed after sharing completes. Files already saved or sent to another application remain under the user's control and are not deleted by resetting Robb Tracker.

Version-4 backups contain the full snapshot, including profile, goal and note photos, Home shortcuts and daily-summary preferences, and a SHA-256 checksum. PIN/recovery credentials, their retry state, and offline interpretation preferences are excluded. The checksum detects corruption; it is **not a signature or proof of authenticity**. Restore validates data types, supported values, relationships, image limits, ledger consistency, and uniqueness before committing atomically. Supported versions 1–3 are checked against their original checksum before being upgraded. The file picker accepts backups up to 128 MB. The user can explicitly confirm replacement of an existing tracker and authorize it with the action PIN. Invalid input and transaction failures preserve the existing tracker. Restore does not merge histories.

Device notification permissions are excluded from backups. CSV is a readable export, not a complete backup; the separate import template has its own columns. Formula prefixes are escaped during CSV export, and XLSX imports reject formula cells. Imported files are parsed locally with size and row limits; no financial file is uploaded to a server.

## Notifications and device copies

Reminder definitions live in SQLite; each device schedules local alerts without a server or push token. Notifications display reminder titles. Daily spending summaries, enabled by default in preferences, can additionally expose the day's financial total, expense count, and a supportive budget-performance message on the lock screen. They include active expenses dated that day across wallets; income, transfers, savings, and reversed records are excluded. Hide balance does not redact these alerts. Users can disable summaries separately, disable app alerts, or adjust lock-screen previews in iPhone Settings. The OS controls permission, Focus, sound, and presentation. Sound choices are the default or app-bundled files. See Expo's [Notifications reference](https://docs.expo.dev/versions/latest/sdk/notifications/).

When permission and app alerts are enabled, the scheduler prepares up to 28 daily summaries for 23:59:59 local time, reserving the remaining slots of a combined 60-alert budget for the earliest reminder events. With all 28 summaries enabled, 32 reminder slots remain. The queue refreshes on app opening, foregrounding, and saved data changes. Summary contents are computed from saved records when scheduled, not by guaranteed background execution at midnight. Later changes refresh the affected scheduled content; future dates with no recorded expenses have a zero-expense summary. Later alerts beyond the rolling window require another app opening. Opening does not require internet. Denying notifications does not delete definitions or stop financial features, and scheduled delivery at an exact second is not guaranteed by the app.

An iPhone and iPad have separate local databases. This release has no automatic synchronization. Device-level backups, file sharing, and any destinations chosen by the user have their own access and retention behavior. Review those separately when selecting a backup location.

## Before distribution

The project dependency audit on 2026-10-31 reported 13 moderate findings and no high or critical findings. The advisories concern transitive Expo build tooling (`glob` / `minimatch`). A compatible `npm audit fix` did not clear them; the suggested forced downgrade to an obsolete Expo SDK was not applied. EAS CLI is invoked separately through `npx`, rather than installed in the project as prohibited by Expo Doctor. Re-run both the project audit and the selected external build tool's security checks, review upstream patches and actual exposure, and resolve or explicitly assess findings before a production release. Functional checks are not a dependency security sign-off.

Release builds set `FTRACKER_BUILD_MODE=release`, disabling arbitrary cleartext HTTP in iOS App Transport Security. Development profiles permit Metro/local networking. Installed financial and chat features need no network. Cloud synchronization remains absent.

Tracker deletion is a logical application data reset. It is not a promise of forensic erasure of flash storage, operating-system backups, or files previously shared outside the app.

- Verify generated entitlements, privacy manifests, permission strings, and data-protection attributes in the signed app.
- Test local persistence, daily-summary privacy and delivery, reminder completion/recurrence, photo selection and readable previews, wallet archival/transfer, destructive reset, and safe backup replacement on each target device.
- Test an exported backup after a clean install and confirm no app secrets are present.
- Test action-PIN setup, per-operation cancellation, recovery, persisted lockouts and secure-storage failures. Confirm launch and new-record entry remain PIN-free.
- Test Apple availability, basic-only mode, model timeouts/cancellation and airplane-mode operation on the signed build. Confirm chat causes no outbound network requests or unintended ledger writes.
- Review dependencies and the final binary for unexpected network traffic or data collection.
- Reassess this document and the privacy policy before enabling any future cloud account, crash reporting, or telemetry module.
