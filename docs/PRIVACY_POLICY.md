# Robb Tracker privacy policy — publisher draft

Effective date: to be set by the publisher before release.

Robb Tracker 1.4 keeps financial records on your device. It does not require an online tracker account or transmit financial records to a Robb Tracker server. Quick chat interprets messages entirely on your device. This version does not include advertising, third-party analytics, or cloud synchronization.

## Information stored on your device

The app stores your chosen display name and optional profile photo, wallet/currency preferences, Home shortcut choices, transactions and transfers, text and photo notes, categories and tags, budgets, savings goals and optional goal images, reminders, and activity history locally. An action PIN protects edits, removals and important changes, while opening the app and recording new transactions do not require a PIN. A random installation identifier is stored in operating-system secure storage.

The four-digit action PIN and two personal recovery answers are independently salted and hashed before being saved in device secure storage. Failed-attempt counts and temporary lockout times are also stored there. Either correct saved answer can reset the PIN. Recovery answers ignore capitalization and extra spaces. Older six-digit PINs remain valid until changed or recovered. These credentials are not financial data and are excluded from JSON backups, exports and audit history. The action PIN does not encrypt the financial database or hide information on an unlocked phone.

## Offline chat processing

Basic chat interpretation and optional Apple on-device intelligence run locally. Apple intelligence requires an eligible device with its model already available. Simple entries use the fast local parser. In basic mode, all messages use only that parser. The app has no online AI provider, API-key entry, connectivity checks or message uploads.

Offline interpretation preferences are stored in device secure storage and excluded from financial backups and audit records. Obsolete provider credentials from older builds are removed locally during upgrade. This does not retract requests sent by an older version.

Photos you select stay in the local tracker and complete JSON backups; they are not uploaded to a server. Note photos retain their original resolution. The app tries lossless compression and can retain the original image when it is smaller. Selected images may contain private details or original image metadata. Reversing a transaction or removing a wallet keeps its history, including attached photos.

## Local notifications

Notification permission allows scheduled reminders, which display their titles, and daily spending summaries. Daily summaries are enabled in the app's preferences by default but require enabled phone alerts and operating-system permission. A summary can show that day's financial total, expense count, and a short spending-performance message on the lock screen. Hiding the balance inside the app does not redact notification content. You can disable daily summaries separately and control previews, sounds, and permission in iPhone Settings.

Daily summaries target 11:59:59 pm in the device's local time. Their contents are prepared from saved expense records for each calendar day and refreshed when the app opens, returns to the foreground, or records change. Up to 28 days of summaries share a maximum queue of 60 alerts with reminders. Reopen the app periodically to refresh later alerts; internet is not required. iOS controls delivery time, Focus, sound, and presentation. Disabling permission does not delete saved reminders or financial records.

## Backups and exports

You can export a CSV or save a complete JSON backup using your device's share sheet. These files contain unencrypted financial information. A JSON backup includes profile, goal and note photos as well as financial preferences; a transaction CSV does not include images. Action-PIN credentials, recovery answers, offline interpretation preferences and device notification authorization are not transferred through a financial backup. The destination you choose has its own privacy and retention practices. Files remain there until you remove them.

Device-level backups and operating-system services may also include application data according to your device and account settings. Robb Tracker does not control your operating-system backup service.

## Your controls

You can edit records, retain reversed history, hide balance amounts, manage reminders and photos, customize Home shortcuts, import spreadsheets, restore JSON backups, export information, and delete the local tracker. Removing a wallet can transfer its full positive balance to another wallet or exclude it from the main balance; both choices preserve transaction history. Quick-entry chat parses messages locally and saves transactions and proposed new tags only after confirmation. Deleting the tracker does not delete previously exported files or device-level backups.

The SQLite database is not separately encrypted by this app. Your device's sandbox and operating-system data protection protect local files. Keep device protection enabled and exported files private.

## Changes and contact

Any future synchronization, analytics or additional online providers require a revised disclosure before they are enabled. The publisher must provide a real support contact, legal entity or publisher name, a public privacy-policy URL, and applicable regional disclosures before distributing this app.

**Publisher and privacy contact: required before publication.** This file is a draft for review, not a deployed public policy.
