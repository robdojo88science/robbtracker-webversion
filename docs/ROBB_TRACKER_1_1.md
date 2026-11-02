# Robb Tracker 1.1

This update renames the installed app to Robb Tracker and keeps the existing bundle ID and database name so an in-place update can preserve your records.

## Install the update

1. In your currently installed tracker, save a JSON backup to Files before changing builds.
2. Push the updated project to your existing private GitHub repository. Open Actions → **Build Robb Tracker iPhone** → **Run workflow** and choose **main**, with free allowance remaining and paid usage blocked as described in FREE_INSTALL.md. Starting a fresh run selects current code; rerunning an old job keeps its old source commit.
3. Download the uniquely named `RobbTracker-1.1.0-<commit>-build<run>-<attempt>` artifact into a new folder and extract its ZIP. It includes the matching IPA and a build report. Confirm the run summary says **Robb Tracker 1.1.0**.
4. Use Sideloadly with the **same Apple ID and bundle identifier** as the existing installation. Install over the existing app. Do not delete the old app first.
5. Open Robb Tracker. Its icon should be a white R on blue. In More, check the version, build, and source commit. Existing records migrate into a Cash wallet. Check your balances, transaction history, and savings goals against your backup.

The old IPA will not contain these changes. A new native build is needed for the new audio, vibration, profile photo, gradient, and blur libraries. Free Apple-ID signing still has its normal seven-day renewal requirement.

The build script now uses a fresh native output directory and refuses to package an app with the wrong display name, version, bundle ID, build number, source commit, or missing offline JavaScript. Build downloads include their version and commit in the filename so an old extracted IPA is easier to distinguish. These checks run on the Mac build runner; this workspace cannot compile a native iPhone binary on Windows.

## Where to find things

| What you want | Where to go |
| --- | --- |
| Name your balance card | More → Preferences → Your balance card |
| Add Cash, BDO, Emergency Fund, or debt | More → Wallets & accounts |
| Exclude a wallet from the total | Edit wallet → turn off Include in my main balance |
| Use dollars alongside pesos | Add a USD wallet → enter how many main-currency units equal 1 USD |
| Move money between wallets | Home → Transfer |
| Edit categories or tags | More → Expense categories / Your tags |
| Select dates | Tap a date field → calendar; tap month/year to jump |
| See spending values and percentages | Performance → Categories or Tags |
| Read changes without JSON | More → Activity history → tap an activity |
| Add/edit profile photo | More → your profile |
| Restore JSON | More → Backup & restore → Choose backup from Files |
| Import many past entries | More → Import from Excel |
| Set reminder sound / test it | More → Preferences → Reminder alerts |
| Take the quick tour again | More → Show me around |

## Wallets, currency, and balances

The main balance is assets minus liabilities for included wallets. Excluding a wallet changes the main total without deleting its records. Liability wallets use negative balances for money owed. A transfer from Cash into a liability wallet repays debt; an expense on that liability increases it.

Each wallet keeps its own currency. Set exchange rates manually without internet. The main currency is chosen during initial setup. Historical charts use the conversion saved with each transaction; current wallet totals use the current manual rate. For cross-currency transfers, review the amount sent and received separately. Supported currency choices use two decimal places.

Recorded transactions on any valid date affect wallet balances immediately. Use reminders for planned payments. Transfers and savings allocations are excluded from spending charts. A tagged expense counts in every tag assigned to it, so tag percentages can add up to more than 100%; category percentages add up to 100%.

## Excel import

Download the CSV template to Files and open it in Excel or Numbers. Replace or delete the example rows. Keep the headings, fill in existing wallet/category/tag names, and save as CSV UTF-8 or .xlsx. The first worksheet is read; formulas must be pasted as values. Up to 2,000 rows and 5 MB are supported per upload. The template is CSV rather than an authored .xlsx workbook because the workbook-authoring runtime was unavailable in the development workspace.

Upload, review row errors and suspected duplicates, then confirm. Nothing is imported if any row is invalid or the database operation fails. Expenses exceeding funds ask for explicit confirmation. Exact duplicate rows are skipped; change the note or description when two otherwise identical rows are separate real purchases. The readable transaction CSV export has a different layout and is not the import template.

## Notifications, feedback, and offline chat

Reminders are local phone notifications. Allow notifications on the iPhone, select a sound in Preferences, and send a test alert. Choices are the iPhone default, two app-bundled sounds, or silent. Apple does not expose the full built-in ringtone catalog to this API. Phone silent/Focus/notification settings affect sound; alerts cannot override them. Opening the app maintains the next 60 scheduled events.

Transaction sounds occur after a successful save; tab changes have optional subtle vibration. Both can be disabled in Preferences.

Quick chat runs offline using a small rule-based parser. Examples: `spent 250 on lunch from Cash yesterday`, `received 1000 salary into Cash`, `transfer 500 from Cash to BDO`, `What is my balance?`, and `How much did I spend this month?`. Use exact wallet names and `#tag` names. Review and edit the proposed transaction before confirming. It is not a Python service or a general AI chatbot. Python server integration requires a separate decision about where it would run and how the phone would connect.

## Verification limits

Automated database, migration, backup, import, chat, notification-schedule, and money tests run locally. iOS Metro/Hermes export is also checked. The updated native app has not been compiled on macOS or tested on a physical iPhone in this workspace. No browser session or emulator was available for visual QA; the Windows native preview attempt also encountered generated-file access restrictions. Check small-screen layout, keyboard visibility, permissions, profile photos, sounds, haptics, offline relaunch, and notification delivery on the installed update.
