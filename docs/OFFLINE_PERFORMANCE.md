# Offline chat and responsiveness

The app has no online AI provider, API-key field, model selection for remote services, or connectivity polling. Short chat entries use the local parser before reading preferences or checking a native model. Auto mode may use Apple on-device intelligence for harder messages when its model is already available; basic mode never invokes that model. Both modes require review before saving financial data.

Native status checks and model generation have bounded deadlines and support cancellation. Preferences and availability are cached. An obsolete provider key from older installations is deleted without being read or displayed, independently of loading the ledger. No developer service, external account or API key is needed for installed chat features.

## Reduced work

- Concurrent refresh requests share a database read. Commits invalidate older in-flight results, so a save waits for a snapshot read after that commit.
- Returning from an inactive system/PIN sheet does not reread the ledger. A real background return refreshes records and local notifications.
- Notification inputs exclude unrelated profile, photo and audit data. Reconciliation runs after a short cancellable delay outside save completion, and daily summaries aggregate the ledger once.
- Wallet balances use one indexed pass across transactions. Trends group expenses in one pass, budgets sort once per calculation, and goal contributions use transaction-ID lookups.
- Screens memoize derived records and charts. Editing a form no longer generates new secure IDs, serializes photo attachments, or scans the ledger once for every wallet on each keystroke.
- Wallet and reminder actions avoid redundant full snapshots. Optional sound/haptic feedback does not delay transaction navigation.
- Glass effects retain native iOS blur on fixed controls and use translucent fills with reflective edges for repeated surfaces. Gradients use the native animation driver, share Reduce Motion state, and stop when their screen loses focus.

These are verified changes to computation, reads and routing, not measured iPhone latency claims. A signed native build and physical-device testing are still needed for scrolling smoothness, keyboard behavior, Apple model availability and PIN timing. The Windows preview APK is missing. JavaScript-only iOS export passes; the Hermes compiler was blocked by Windows in the earlier production packaging attempt. Native PIN acceleration from the preceding update also requires a newly compiled iOS build.
