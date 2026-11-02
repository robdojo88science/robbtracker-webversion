# Wallet and PIN responsiveness

Wallet removal now confirms within the Wallets page. Its former native modal could prevent the separate action-PIN modal from appearing on iOS, leaving a pending operation with no usable PIN prompt. The confirmation remains visible after cancellation or failure so the user can retry.

Mutation authorization uses an indexed identity query instead of loading every transaction, audit entry and photo to decide whether a record is an edit. These checks remain serialized with the subsequent protected write; concurrent adds with the same ID still require a PIN for the second write. Transaction balance validation and wallet transfers load financial columns without image payloads or unrelated audit history. Transfers and removal remain one atomic SQLite transaction.

New iOS builds run PIN hashing through CommonCrypto on Expo's background native queue. The stored PBKDF2-SHA256 format, 210,000 iterations, independent random salts and persistent attempt lockouts are unchanged. Existing credentials work without resetting the PIN. Older installed native clients retain the JavaScript fallback. **Install a newly compiled iOS build to get native hashing acceleration; a JavaScript bundle export alone does not add this native method.** Entering the last digit submits once (four for new PINs, six for older credentials), with a synchronous guard preventing duplicate verification. There is no reusable authorization session.

The native implementation follows [Apple's CommonCrypto key-derivation declaration](https://raw.githubusercontent.com/apple-oss-distributions/CommonCrypto/main/include/CommonKeyDerivation.h) and [Expo's AsyncFunction threading contract](https://docs.expo.dev/modules/module-api/#asyncfunction). Windows TypeScript and repository tests cannot establish successful Swift compilation or measured iPhone latency.

Concurrent refresh requests now share a database read. A committed write invalidates an older in-flight read, and its save promise waits for a snapshot taken after the commit. Superseded results never publish. Current read failures still report a saved-but-refresh-failed outcome through the mutation handler; retrying refresh preserves the last good screen. Tests cover concurrent writes during both the original and replacement reads, failures, retry and disposal.

Notification work runs independently after a 200 ms background debounce. Profile photos, theme changes, transaction descriptions and expenses outside the months covered by scheduled summaries do not replan alerts. Relevant expense, budget, reminder, sound and calendar changes do. A 28-day summary plan now aggregates the ledger once instead of scanning it 56 times. PIN/system-sheet inactive events no longer trigger a redundant full refresh; returning from a real background visit still refreshes and rechecks notification permissions. Query-count tests verify that saving, editing and transferring/removing a wallet reuse their checked ledger rather than reading it again after each write. Savings mutations use the same lightweight financial data.

Obsolete online-AI credentials are deleted asynchronously during startup, with retries on later foreground visits. Cleanup does not block opening the tracker or participate in saves, and financial reset retains its explicit secure-settings cleanup behavior.

Verify on the newly built iPhone/iPad app:

- Remove a funded wallet, choose a destination, enter the PIN, and confirm one transfer appears and the source wallet disappears.
- Cancel the PIN, retry, and enter a wrong PIN; money and wallet membership must stay unchanged.
- Edit a wallet or transaction and confirm the PIN appears and six digits submit once.
- Confirm an existing PIN still works after upgrade, including recovery and the persistent five-failure lockout.
- Compare large ledgers with photo notes: editing and transfer must stay responsive and retained photos/history must remain intact.
