# App Store metadata draft

This describes the implemented local-only version. Replace publisher-specific fields and verify all claims against the signed candidate before submission. Screenshots must come from the real iPhone/iPad app; none have been captured here.

## Listing copy

Name: **F-Tracker**

Subtitle: **Your private money tracker**

Promotional text: **Make room for everyday spending and bigger plans. Track your money offline, save toward goals, and keep your records in your own private space.**

Description:

F-Tracker gives your personal finances a calm home on your iPhone or iPad. Create your tracker without an account, then record income and expenses even when you have no internet connection.

See your spendable balance, set a monthly budget, search your transaction history, and explore spending by category and period. Create savings goals and record actual contributions as you go. An activity trail keeps the history behind edits, adjustments, and voids.

Set local bill and savings reminders, hide your balance, and add an app PIN with optional Face ID or Touch ID. Choose light, dark, or system appearance.

Your financial records stay on the device in this version. Create a complete local backup for recovery or device migration, or export a readable CSV. Backups contain unencrypted financial information, so keep them somewhere private. Automatic cloud synchronization and shared wallets are not included.

Keywords draft: **budget,expenses,savings,peso,money,offline,spending,income,goals,finance**

Category suggestion: **Finance**. Complete age-rating and App Privacy questionnaires using the actual release binary and current App Store Connect questions.

Version notes draft: **Initial release: offline personal tracking, budgets, savings goals, reminders, private app unlock, local backup, and CSV export.**

## Publisher fields still required

- Publisher/legal name and copyright.
- Real support contact and support URL.
- Reviewed privacy-policy public URL; see [draft](PRIVACY_POLICY.md).
- App Store Connect identity, current content-rights/export-compliance answers, and applicable regional terms.

## Screenshot plan

Capture the required current App Store display classes from the signed release candidate using fictional financial records. Verify exact pixel requirements in App Store Connect at submission time.

| Scene | iPhone | iPad |
| --- | --- | --- |
| Home with spendable balance, budget and recent activity | Portrait, safe areas visible | Portrait and landscape two-column view |
| Expense history with date and category filters | Search and filtered ledger | Wider list with readable amounts |
| Performance trend and category breakdown | Local chart and period controls | Larger chart with side-by-side cards |
| Savings goal and contribution progress | Goal card with contribution | Multiple goal cards |
| App security and backup controls | No PIN or secrets visible | Centered settings/forms |

Do not advertise unimplemented cloud backup, automatic multi-device sync, bank integrations, encryption beyond the documented device protections, or completed device testing.

## Review notes draft

This release is local-only and requires no online login. On first launch, select Create My Tracker and enter optional opening funds and budget. Core features continue to operate in Airplane Mode. App lock is optional and user-created; a fresh installation has no preset PIN. Notification prompts appear only when the user enables local alerts in Preferences. Marking reminders complete does not automatically create payments.
