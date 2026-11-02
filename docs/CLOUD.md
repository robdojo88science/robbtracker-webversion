# Optional cloud module: implementation boundary

Cloud sync is intentionally unavailable in the local MVP. No Supabase SDK, project, account tokens, remote requests, or deployed policies are part of this build. Core functions must remain unchanged when a future module is added. This document is a design contract, not a claim of tested synchronization.

## Ownership and authorization

Each tracker belongs to one person. A linked local profile must be explicitly associated with the currently authenticated Supabase user; local-only records must never become visible to another account. Switching accounts must require a separate local database or explicit sign-out and migration handling. Do not repurpose a linked database for another owner.

Every remote profile, category, transaction, budget, goal, contribution, reminder, audit event, and conflict record requires `owner_id uuid NOT NULL REFERENCES auth.users(id)`. Use RLS for SELECT/INSERT/UPDATE/DELETE with `auth.uid() = owner_id`; INSERT and UPDATE need WITH CHECK to prevent ownership changes. No client service-role key or general administrator financial UI is permitted. Foreign keys should include owner identity so an owned row cannot reference another owner's goal/category/transaction.

Audit rows are append-only and accepted only through a transaction RPC that writes the associated entity revision. Account deletion must be an authenticated server-side flow that removes only the requested owner's cloud data and credentials, separately from local tracker deletion.

## Atomic operations and idempotency

A local financial transaction must atomically append its audit event and persist an outbox operation, only after the user has enabled cloud sync. A goal allocation bundles the goal contribution, ledger entry, audit, and required goal/reminder changes under one stable operation UUID.

The server accepts a whole operation in one PostgreSQL transaction through an authenticated RPC. A unique `(owner_id, operation_id)` receipt makes retry exactly-once at the application level. Per-record UUIDs are stable across devices. Duplicate operation delivery returns the existing receipt without repeating financial effects. Never upload linked ledger and contribution records as unrelated writes.

Uploads include base server revisions. The server uses compare-and-swap, incrementing an authoritative monotonic revision after acceptance. Download using a server-assigned per-owner change sequence, paged by cursor; timestamps and device clocks are not reliable sync cursors. Commit each downloaded operation, immutable audit events, and cursor advancement atomically in SQLite. Apply retries idempotently.

## Conflicts and tombstones

Do not use silent last-write-wins for financial values, transaction dates, goal allocations, goal target amounts, or budget changes. A stale base revision produces a durable conflict containing the base revision, local version, server version, operation ID, and affected records. Leave the local entry visible and preserve both candidate versions. Require explicit resolution; a resulting correction is a new audited operation. Linked goal transfers resolve as one financial operation.

Descriptive fields may use deterministic field-wise merge only when the two edits affect distinct fields relative to a common base. Otherwise preserve a conflict. Deletion is an explicit tombstone with revision. Do not drop tombstones until all devices' retention/cursor rules guarantee that old offline data cannot recreate deleted records. Voids are financial events, not permanent deletes.

## Lifecycle and user status

Display SQLite data immediately on launch. Refresh auth and run sync only in the background when enabled and connectivity exists. Store refresh/session secrets in SecureStore, outside financial tables and exports. Handle expired auth, airplane mode, server outages, and retry backoff without locking local features. Wi-Fi-only mode must use actual network type.

Use distinct user states: Saved on this device; Waiting to sync; Syncing; All changes synced; Sync problem — saved on this device. Record last successful sync only after both upload receipts and downloads have committed. A linked account's recovery must not overwrite a nonempty tracker without an explicit conflict-safe import flow.

Reminder definitions sync, but each device independently reconciles its notification queue. Neither notifications nor financial writes wait for cloud. Two completely offline devices cannot synchronize with each other.

## Required tests before enabling

- Two independent device databases and two Supabase owners, with RLS cross-owner read/write/link attempts rejected.
- Identical-operation retry, process crash after remote commit but before receipt, cursor resume, pagination, and duplicate-download tests.
- Conflicting offline edits and void-versus-edit operations preserve both versions and require resolution.
- Linked contribution writes roll back together on local or remote failure.
- Expired auth, server timeout, Wi-Fi-only, offline launch, reconnection, and account switching never expose another owner's data.
- Account deletion, backup recovery, tombstone retention, privacy disclosures, and physical iPhone/iPad sync acceptance.

Use the official [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Auth guidance](https://supabase.com/docs/guides/auth), and validate the deployed schema against a real staging project before shipping.
