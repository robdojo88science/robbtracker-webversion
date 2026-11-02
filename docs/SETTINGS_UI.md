# Settings UI

Settings now uses an iPhone-inspired hierarchy with a large title, search, profile header, colored icons, native switches, grouped rows and inset separators. Common preferences open directly from the Settings tab. The existing `/settings` route remains available for saved shortcuts and help links.

The design keeps the requested 3px surface corners, compact text and wide content area. A small gradient backdrop uses the native animation driver, stops when unfocused and honors Reduce Motion. Repeated rows use translucent fills; native blur is reserved for the profile header and existing action footer.

Appearance, sounds, shortcuts, balance display, monthly budget, spending levels and notification controls each have focused pages. Back stays visible while scrolling. Edited forms have a fixed Save action. Failed notification status checks show a retry action instead of an indefinite loading label.

Wallets, categories, tags, reminders, offline chat, audit history, imports, help and backup tools remain reachable. Budget, spending-level, restore and reset operations keep their existing security guards. No network service or AI provider was added.

Validation: TypeScript, all 148 automated tests and the iOS JavaScript export passed. The appearance and touch interactions still need verification in a compiled app on a device; no device preview or latency measurement is claimed.
