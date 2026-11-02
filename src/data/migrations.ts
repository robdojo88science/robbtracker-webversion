import type { Database } from '../core/database';

const META = `id TEXT PRIMARY KEY NOT NULL,
ownerId TEXT, deviceId TEXT NOT NULL,
createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, deletedAt TEXT,
syncStatus TEXT NOT NULL DEFAULT 'synced' CHECK(syncStatus IN ('synced','pending_create','pending_update','pending_delete','sync_error')),
serverVersion INTEGER NOT NULL DEFAULT 0 CHECK(serverVersion >= 0)`;
export const AUDIT_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'Audit history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'Audit history is immutable'); END;`;
export const SCHEMA_MIGRATIONS = [
  `CREATE TABLE profiles (${META}, displayName TEXT NOT NULL, currency TEXT NOT NULL CHECK(currency = 'PHP'), appearance TEXT NOT NULL CHECK(appearance IN ('system','light','dark')), hideBalance INTEGER NOT NULL CHECK(hideBalance IN (0,1)), autoLockSeconds INTEGER NOT NULL CHECK(autoLockSeconds IN (0,30,60,300)), notificationsEnabled INTEGER NOT NULL CHECK(notificationsEnabled IN (0,1)), performanceThresholds TEXT NOT NULL);
CREATE UNIQUE INDEX one_local_profile ON profiles((1));
CREATE TABLE categories (${META}, name TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL);
CREATE TABLE goals (${META}, name TEXT NOT NULL, targetMinor INTEGER NOT NULL CHECK(targetMinor BETWEEN 1 AND 99999999999), durationMonths INTEGER NOT NULL CHECK(durationMonths BETWEEN 1 AND 600), startDate TEXT NOT NULL, paymentDay INTEGER NOT NULL CHECK(paymentDay BETWEEN 1 AND 31), status TEXT NOT NULL CHECK(status IN ('active','paused','completed','archived')));
CREATE TABLE transactions (${META}, kind TEXT NOT NULL CHECK(kind IN ('income','expense','adjustment_credit','adjustment_debit','goal_contribution')), amountMinor INTEGER NOT NULL CHECK(amountMinor BETWEEN 1 AND 99999999999), title TEXT NOT NULL, date TEXT NOT NULL, categoryId TEXT REFERENCES categories(id), notes TEXT NOT NULL DEFAULT '', goalId TEXT REFERENCES goals(id), voidedAt TEXT);
CREATE TABLE budgets (${META}, month TEXT NOT NULL UNIQUE, amountMinor INTEGER NOT NULL CHECK(amountMinor BETWEEN 0 AND 99999999999));
CREATE TABLE goal_contributions (${META}, goalId TEXT NOT NULL REFERENCES goals(id), transactionId TEXT NOT NULL UNIQUE REFERENCES transactions(id), amountMinor INTEGER NOT NULL CHECK(amountMinor BETWEEN 1 AND 99999999999), date TEXT NOT NULL);
CREATE TABLE reminders (${META}, title TEXT NOT NULL, dueAt TEXT NOT NULL, recurrence TEXT NOT NULL CHECK(recurrence IN ('none','daily','weekly','monthly')), goalId TEXT REFERENCES goals(id), status TEXT NOT NULL CHECK(status IN ('active','completed','dismissed')));
CREATE TABLE audit_logs (id TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL, \"group\" TEXT NOT NULL CHECK(\"group\" IN ('income','expense','goal','system')), recordId TEXT NOT NULL, timestamp TEXT NOT NULL, before TEXT, after TEXT, deviceId TEXT NOT NULL);
CREATE TABLE sync_queue (id TEXT PRIMARY KEY NOT NULL, recordTable TEXT NOT NULL, recordId TEXT NOT NULL, operation TEXT NOT NULL CHECK(operation IN ('create','update','delete')), payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lastError TEXT, createdAt TEXT NOT NULL, UNIQUE(recordTable,recordId));
CREATE TABLE sync_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
INSERT INTO sync_metadata(key,value) VALUES ('cloud_enabled','false');`,
  `CREATE INDEX transaction_date ON transactions(date DESC);
CREATE INDEX transaction_category ON transactions(categoryId,date);
CREATE INDEX transaction_kind ON transactions(kind,voidedAt,date);
CREATE INDEX audit_date ON audit_logs(timestamp DESC);
CREATE INDEX audit_group_date ON audit_logs(\"group\",timestamp DESC);
CREATE INDEX reminder_due ON reminders(status,dueAt);
CREATE UNIQUE INDEX goal_reminder ON reminders(goalId) WHERE goalId IS NOT NULL;
${AUDIT_TRIGGERS}`,
  `ALTER TABLE reminders ADD COLUMN monthlyDay INTEGER CHECK(monthlyDay IS NULL OR monthlyDay BETWEEN 1 AND 31);
UPDATE reminders SET monthlyDay = CAST(strftime('%d', dueAt, 'localtime') AS INTEGER) WHERE recurrence = 'monthly';`,
  `ALTER TABLE profiles ADD COLUMN baseCurrency TEXT NOT NULL DEFAULT 'PHP';
ALTER TABLE profiles ADD COLUMN balanceLabel TEXT NOT NULL DEFAULT 'My available balance';
ALTER TABLE profiles ADD COLUMN avatarUri TEXT;
ALTER TABLE profiles ADD COLUMN tutorialCompleted INTEGER NOT NULL DEFAULT 0 CHECK(tutorialCompleted IN (0,1));
ALTER TABLE profiles ADD COLUMN transactionSounds INTEGER NOT NULL DEFAULT 1 CHECK(transactionSounds IN (0,1));
ALTER TABLE profiles ADD COLUMN hapticsEnabled INTEGER NOT NULL DEFAULT 1 CHECK(hapticsEnabled IN (0,1));
ALTER TABLE profiles ADD COLUMN notificationSound TEXT NOT NULL DEFAULT 'default';
CREATE TABLE accounts (${META}, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('asset','liability')), currency TEXT NOT NULL, exchangeRate REAL NOT NULL CHECK(exchangeRate>0), includedInBalance INTEGER NOT NULL CHECK(includedInBalance IN(0,1)), icon TEXT NOT NULL, color TEXT NOT NULL);
CREATE TABLE tags (${META}, name TEXT NOT NULL, color TEXT NOT NULL);
INSERT INTO accounts(id,ownerId,deviceId,createdAt,updatedAt,deletedAt,syncStatus,serverVersion,name,type,currency,exchangeRate,includedInBalance,icon,color) SELECT id,ownerId,deviceId,createdAt,updatedAt,NULL,'synced',0,'Cash','asset','PHP',1,1,'wallet','#007DFE' FROM profiles;
CREATE TEMP TABLE saved_contributions AS SELECT * FROM goal_contributions;
DROP TABLE goal_contributions;
ALTER TABLE transactions RENAME TO legacy_transactions;
CREATE TABLE transactions (${META}, kind TEXT NOT NULL CHECK(kind IN ('income','expense','adjustment_credit','adjustment_debit','goal_contribution','transfer')), amountMinor INTEGER NOT NULL CHECK(amountMinor BETWEEN 1 AND 99999999999), title TEXT NOT NULL, date TEXT NOT NULL, categoryId TEXT REFERENCES categories(id), notes TEXT NOT NULL DEFAULT '', goalId TEXT REFERENCES goals(id), voidedAt TEXT, accountId TEXT NOT NULL REFERENCES accounts(id), destinationAccountId TEXT REFERENCES accounts(id), destinationAmountMinor INTEGER CHECK(destinationAmountMinor IS NULL OR destinationAmountMinor BETWEEN 1 AND 99999999999), baseAmountMinor INTEGER NOT NULL CHECK(baseAmountMinor>=0), tagIds TEXT NOT NULL DEFAULT '[]', CHECK((kind='transfer' AND destinationAccountId IS NOT NULL AND destinationAmountMinor IS NOT NULL AND destinationAccountId<>accountId) OR (kind<>'transfer' AND destinationAccountId IS NULL AND destinationAmountMinor IS NULL)));
INSERT INTO transactions SELECT legacy_transactions.*, (SELECT id FROM accounts LIMIT 1), NULL, NULL, amountMinor, '[]' FROM legacy_transactions;
DROP TABLE legacy_transactions;
CREATE TABLE goal_contributions (${META}, goalId TEXT NOT NULL REFERENCES goals(id), transactionId TEXT NOT NULL UNIQUE REFERENCES transactions(id), amountMinor INTEGER NOT NULL CHECK(amountMinor BETWEEN 1 AND 99999999999), date TEXT NOT NULL);
INSERT INTO goal_contributions SELECT * FROM saved_contributions;
DROP TABLE saved_contributions;
CREATE INDEX transaction_date ON transactions(date DESC);
CREATE INDEX transaction_category ON transactions(categoryId,date);
CREATE INDEX transaction_kind ON transactions(kind,voidedAt,date);
CREATE INDEX transaction_account ON transactions(accountId,date);`,
  `ALTER TABLE profiles ADD COLUMN dailySummaryEnabled INTEGER NOT NULL DEFAULT 1 CHECK(dailySummaryEnabled IN(0,1));
ALTER TABLE profiles ADD COLUMN homeShortcuts TEXT NOT NULL DEFAULT '["chat","month","last7","last30","wallets","notifications","help"]';
ALTER TABLE transactions ADD COLUMN notePhotos TEXT NOT NULL DEFAULT '[]';`,
  `ALTER TABLE goals ADD COLUMN imageUri TEXT;`,
];

/** Migrations advance only after the entire version has committed. Never recreate data. */
export async function migrate(db: Database): Promise<void> {
  await db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  await db.transaction(async tx => {
    const row = await tx.first<{user_version: number}>('PRAGMA user_version');
    const version = row?.user_version ?? 0;
    if (version > SCHEMA_MIGRATIONS.length) throw new Error('This data was created by a newer Robb Tracker version. Update the app before opening it.');
    for (let i = version; i < SCHEMA_MIGRATIONS.length; i++) {
      await tx.exec(SCHEMA_MIGRATIONS[i]);
      await tx.exec(`PRAGMA user_version = ${i + 1}`);
    }
  });
}
