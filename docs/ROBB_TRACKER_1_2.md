# Robb Tracker 1.2

## What changed

- Home keeps your available balance, spending performance, and coming up. The shortcut row opens Quick chat, Monthly overview, Wallets, and all money activity.
- Transactions is a main tab. It starts at All time and includes money in, expenses, transfers, savings, and balance adjustments. Choose Last 7, 30, or 365 days, or a custom range. Additional category/tag/wallet/sort filters stay behind Filters.
- Performance uses one period selector, a Categories/Tags switch, and an optional wallet filter. This year and All time are included.
- This month now means the full calendar month, including later dates in that month. An expense dated next month belongs to next month. Monthly budget left is the budget minus active expenses dated in that month; editing or voiding updates it immediately.
- Expense entry uses a compact layout with the Save button fixed at the bottom. Tags and notes are under More details. The information icon beside Description explains where the transaction name is used.
- Screens use wider content, tight readable spacing, flat sections, nearly square corners, moving blue gradients, and iPhone glass backgrounds. Reduce Motion disables continuous movement.
- Activity history uses a flat dated list. Tap an entry to see readable before/after values.
- Choose more currencies or Custom currency while creating a wallet or during first setup. Use a code with 3–8 uppercase letters/digits, starting with a letter. Set its conversion rate manually. All ledger amounts still use two decimal places, including custom codes.
- Quick chat is visible on Home. Short entries such as `transpo 25 today`, `tranpo 25 yesterdy`, and `coffee 80 Nov5,2024` create editable drafts, using Cash by default. Nothing is saved until Confirm & save. Common spelling corrections are supported; ambiguous amounts/dates still ask for clearer input.
- The UTF-8 CSV template opens in Microsoft Excel and Google Sheets. Keep the headings and replace the sample rows. Save/download as CSV UTF-8 or .xlsx and review before importing.

## Install

Commit and push the changes, then start a **new** run under **Actions → Build Robb Tracker iPhone → Run workflow → main**, after confirming the existing free-usage requirements. Download the uniquely named **RobbTracker-1.2.0-…** artifact and install its IPA over the current app with the same Apple ID/bundle identifier. Save a JSON backup first. More shows the installed version and build.

## Checks

TypeScript and 60 tests pass, including actual SQLite budget changes, date ranges, custom-currency backup restoration, shorthand chat, and CSV template round trips. The iOS Hermes bundle exports successfully. Home and the compact expense form were visually inspected in the local Android emulator; main expense fields and Save fit on the first screen. This preview uses an older client and does not validate new native audio/photo modules or iPhone blur. A clean Android preview build encountered an existing Gradle-cache file error. Physical iPhone layout, keyboard, glass effects, and sound delivery still need acceptance testing on a newly built IPA.
