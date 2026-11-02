# Finance and interface refresh

Home keeps the available balance, spending performance, and coming reminders. Monthly totals, transactions, and wallets have compact icon shortcuts, and Quick chat stays in the header. Forms and pages use more horizontal space, flat rows, 3px corners, tighter spacing, iOS blur, and moving gradients that respect Reduce Motion.

The transaction form groups wallet and category, keeps Save visible above the bottom safe area, and puts optional tags, notes, and photos under More details. The description's information button explains that it names the transaction in records. Wallets have direct Transfer actions. Wallet removal confirms on the page so its PIN dialog can appear without competing native modals.

Performance exposes This month, This year, and All time directly, with other ranges under More dates. This month includes the whole calendar month, including future dates. Its Records view and searchable transaction link use matching dates. Budget left subtracts active expenses in base currency and responds to edits and reversals. Transfers, income, and savings allocations do not consume the expense budget. The Transactions tab includes all financial record types, including reversed history, with all-time, rolling 7/30/365-day, and custom ranges.

Currency selection includes named currencies, search, reusable custom codes, and manual wallet exchange rates. The ledger continues to use two decimal places for every currency. Main currency stays fixed after setup to preserve history.

Quick chat understands shorthand and common misspellings, including `transpo 25 today`, `tranpo 25 yesterdy`, `trasnpo25 tdy`, and `transpo 25 Nov5,2024`. It produces a review draft; saving still requires confirmation. The confirmation stays visible in the footer. Historical spending questions are answered locally. Online AI and provider-key entry have been removed; all interpretation is offline.

Spreadsheet templates and exports now include real `.xlsx` workbooks with numeric dates and amounts, frozen headings, and column filters. CSV remains available. The importer accepts exported column names and validates currency and record status. Imports add new records and skip exact duplicates; they do not overwrite existing transactions. JSON backups remain the complete restore format.

## Verification

- Strict TypeScript and all 148 automated tests passed, including SQLite budget, future-date, currency conversion, wallet-removal, PIN, chat, and spreadsheet regressions.
- Generated template and ledger workbooks were independently imported, inspected, and rendered with Artifact Tool. Native Microsoft Excel and Google Sheets were not launched.
- iOS JavaScript export passed with `--no-bytecode`. The normal production export reached Hermes compilation, where Windows denied execution of `hermesc.exe`; that production packaging check remains incomplete.
- Windows visual preview could not start because `android/app/build/outputs/apk/debug/app-debug.apk` is missing. Native UI, keyboard, animation, and device performance acceptance remain unverified.
- Native PIN acceleration requires a new iOS build. Swift compilation and measured device latency remain unverified. See [PIN performance](PIN_PERFORMANCE.md).
