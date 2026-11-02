# Robb Tracker 1.4

This update keeps the existing app identity and local financial records. Save a JSON backup before installing a new IPA over the existing app with the same Apple ID.

## Setup and appearance

Opening amount and monthly budget now have full-width fields, larger minimum heights and line heights that fit their text. Setup includes an action-PIN step before the final review, including when bringing back a backup.

The native iOS launch screen and its image catalogue use versioned Robb Tracker names. The build regenerates native files and checks the compiled launch storyboard and blue-R brand markers before packaging. This addresses stale launch resources without changing the bundle ID or asking you to delete the app. The operating system still controls launch snapshots; confirm the actual launch appearance on the new installed build.

Tabs use compact translucent glass with subtle movement. Ordinary surfaces use 1px corners. Goal images can be selected, previewed, changed or removed; complete JSON backups include them.

## Action PIN

The action PIN uses six digits. It is not an app-opening lock. New income, expenses, transfers, savings contributions, wallets, categories, tags, goals and reminders remain PIN-free. Routine appearance, notification and Home-shortcut settings also remain quick.

Editing or voiding saved transactions, editing or removing wallets, renaming/deleting existing categories and tags, changing existing goals, dismissing/editing reminders, changing budgets or important spending settings, replacing a tracker from backup and full reset require confirmation. Each protected write is checked through the same repository wrapper; imports and concurrent writes cannot bypass an edit check.

Preferences → Action PIN lets you change the PIN using the current PIN, change recovery questions, or reset a forgotten PIN by answering both saved questions. Answers ignore case, compatibility-character differences and extra spaces. Choose answers that other people cannot easily guess. The PIN and each recovery answer have independent salts and PBKDF2-HMAC-SHA256 hashes with 210,000 iterations. SecureStore holds these credentials and persistent failed-attempt delays. They do not enter financial records, backups or audit history. This protects normal app operations; it does not encrypt SQLite or prevent reads on an unlocked phone.

## Offline quick chat

Short entries use the fast local parser on every device. Auto mode can use Apple Foundation Models for harder messages on compatible iPhones and iPads when the model is already available. Basic mode uses only the parser. Both modes work without internet and require no API key or provider account. Open Preferences > Offline chat to change this local preference.

Review the description, amount, wallet, category and date before confirming any draft. Local validation calculates totals and rejects unsupported actions. Cancelling an interpretation never saves a record. The native bridge needs a newly compiled compatible iOS build; older clients retain basic entry.

## Install the update

After this code is pushed, start a new **Actions → Build Robb Tracker iPhone → Run workflow → main** run using the existing free-usage confirmation. Rerunning an older run builds its older commit. Download the new `RobbTracker-1.4.0-…` artifact, extract it and select that exact IPA in Sideloadly. Check More for the version and commit after installation.

This Windows workspace checks TypeScript, logic tests, native configuration/autolinking and JavaScript packaging. A successful macOS build and physical iPhone/iPad acceptance are still needed for Swift compilation, first-use keyboard layout, PIN dialogs, native launch snapshots, goal picking, the glass tab appearance and actual on-device responses.

References: [Apple Foundation Models](https://developer.apple.com/foundation-models-framework/).
