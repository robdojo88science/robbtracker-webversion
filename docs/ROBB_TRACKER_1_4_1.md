# Robb Tracker 1.4.1 source update

The first-name placeholder is now **First Name**. Amount inputs group thousands while typing, including `1,000` and `1,000,000.50`, without rounding away decimal digits. Manual exchange rates keep their six-decimal input behavior.

New action PINs have four digits. Existing six-digit credentials still work and become four-digit credentials when changed or recovered. Either correct saved recovery answer can reset the PIN. PIN and recovery fields have show/hide controls; the app hides them again during secure work. The dialog displays progress before hashing begins and a longer-wait message if needed. The native hashing path and persistent failed-attempt lockouts remain intact; the password-derivation iteration count has not been reduced.

Quick chat stays fully offline. It accepts up to twenty complete transactions separated by commas or semicolons, such as `transpo 25; lunch 80 today`. Grouped amounts and named-date commas, such as `salary 1,000 Nov5,2024`, stay within their entry. Dates and wallets are not inherited from neighboring clauses. Review, edit, or remove entries before confirming. The whole batch, including proposed new tags, commits in one SQLite transaction or rolls back together.

Each wallet has an Add money action that selects that account. The income form also has a destination-wallet switch. Removing a wallet offers two direct actions: move its full positive balance to another asset wallet and remove it, or remove it without a transfer. Removal excludes that wallet's balance and preserves its financial and audit history. At least one asset wallet must remain.

Performance uses clearer Budget and Remaining/Over budget labels. Home, the monthly Performance view, scheduled daily summaries, and the in-app notification preview use the same monthly spending ratio and thresholds. A daily summary shows today's expense amount separately from the monthly rating. All recorded dates within that month, including future entries, count toward its ratio.

Reminders use Upcoming, Done, and Dismissed lists with concise actions. Done finishes a one-time reminder; Done & next advances a repeating reminder; Tomorrow keeps its clock time on the next day. The form groups date and time, offers custom minute selection, keeps Save visible, and puts optional goal linking behind a control. Completing a reminder still does not create a financial transaction.

Automatic welcome tips are offered only once, on the tracker creation day. Their offered state is saved before opening the tour, so dismissing or restarting does not repeat it. The tour remains available when explicitly opened from Help or More.

Transaction icons consistently use green up arrows for money added, red down arrows for expenses, and two-way arrows for transfers.

## Launch branding and validation

The existing icon and splash assets were visually inspected and contain the R mark. Startup now holds the native R splash until local data, the icon font, and the first app layout are ready. Version 1.4.1 also gets a new versioned native launch resource name to avoid reuse of an older launch snapshot. Development launcher controls are reduced. Expo warns that development clients cannot fully reproduce release splash behavior; a standalone native build is needed to verify the initial flash. See [Expo's splash-screen guidance](https://docs.expo.dev/versions/latest/sdk/splash-screen/).

Strict TypeScript and all 148 automated tests passed, including real SQLite batch rollback, monthly summary agreement, recovery, and legacy PIN compatibility. The iOS JavaScript-only export and Expo configuration introspection pass. No newly compiled/signed iOS app or physical-device startup/latency result is claimed. Native launch configuration and hashing acceleration need a fresh native build; the earlier Windows Hermes compiler restriction and missing preview APK remain verification limits.
