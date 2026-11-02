import type { FinanceRepository } from './types';

export type AuthorizeAction = (reason: string) => Promise<void>;
export class CommittedResetError extends Error {
  readonly financialResetCommitted = true;
  constructor() { super('Your tracker records were reset, but secure settings could not be cleared. Your existing action PIN may still be required. Unlock your phone and try setting up your tracker again.'); this.name = 'CommittedResetError'; }
}
/** The UI receives only this repository: bulk imports and preallocated IDs follow the same guard. */
export function protectRepository(raw: FinanceRepository, authorize: AuthorizeAction, afterReset: () => Promise<void>): FinanceRepository {
  const existing = async (collection: 'transactions' | 'accounts' | 'categories' | 'tags' | 'goals' | 'reminders', id: string | undefined): Promise<boolean> => !!id && (raw.hasRecord ? await raw.hasRecord(collection, id) : (await raw.getSnapshot())[collection].some(item => item.id === id));
  const protectedRepo: FinanceRepository = {
    ...raw,
    async saveTransaction(input) { if (await existing('transactions', input.id)) await authorize('Edit this transaction'); await raw.saveTransaction(input); },
    async importTransactions(inputs, newTags) {
      let updatesExisting = false;
      if (raw.hasRecord && inputs.length <= 50) {
        for (const input of inputs) if (input.id && await raw.hasRecord('transactions', input.id)) { updatesExisting = true; break; }
      } else {
        const ids = new Set((await raw.getSnapshot()).transactions.map(item => item.id));
        updatesExisting = inputs.some(input => !!input.id && ids.has(input.id));
      }
      if (updatesExisting) await authorize('Update existing transactions from this import');
      await raw.importTransactions(inputs, newTags);
    },
    async voidTransaction(id) { await authorize('Void this transaction'); await raw.voidTransaction(id); },
    async saveAccount(input) { if (await existing('accounts', input.id)) await authorize('Edit this wallet or its exchange rate'); await raw.saveAccount(input); },
    async deleteAccount(id, options) { await authorize('Remove this wallet'); return raw.deleteAccount(id, options); },
    async saveCategory(input) { if (await existing('categories', input.id)) await authorize('Edit this expense category'); await raw.saveCategory(input); },
    async deleteCategory(id) { await authorize('Delete this expense category'); await raw.deleteCategory(id); },
    async saveTag(input) { if (await existing('tags', input.id)) await authorize('Edit this tag'); await raw.saveTag(input); },
    async deleteTag(id) { await authorize('Delete this tag'); await raw.deleteTag(id); },
    async saveGoal(input) { if (await existing('goals', input.id)) await authorize('Edit this savings goal'); await raw.saveGoal(input); },
    async setGoalStatus(id, status) { await authorize('Change this savings goal’s status'); await raw.setGoalStatus(id, status); },
    async saveReminder(input) { if (await existing('reminders', input.id)) await authorize('Edit this reminder'); await raw.saveReminder(input); },
    async actReminder(id, action, snooze) { if (action === 'dismiss') await authorize('Dismiss this reminder'); await raw.actReminder(id, action, snooze); },
    async setBudget(amount, month) { await authorize('Change your spending budget'); await raw.setBudget(amount, month); },
    async updateProfile(patch) {
      if (patch.baseCurrency !== undefined || patch.performanceThresholds !== undefined) await authorize('Change important spending settings');
      await raw.updateProfile(patch);
    },
    async restoreBackup(backup, replaceExisting) {
      if (replaceExisting && (await raw.getSnapshot()).profile) await authorize('Replace this tracker with a backup');
      await raw.restoreBackup(backup, replaceExisting);
    },
    async clearAllData() { await authorize('Reset this tracker and erase its records'); await raw.clearAllData(); try { await afterReset(); } catch { throw new CommittedResetError(); } },
  };
  // Keep existence checks and the following write together across concurrent calls.
  // Otherwise two "new" records with one ID could turn the second add into an unguarded edit.
  let pending: Promise<unknown> = Promise.resolve();
  for (const key of Object.keys(protectedRepo) as (keyof FinanceRepository)[]) {
    if (['getSnapshot','hasRecord','queryTransactions','createBackup'].includes(key)) continue;
    const operation = protectedRepo[key] as (...args: unknown[]) => Promise<unknown>;
    protectedRepo[key] = ((...args: unknown[]) => {
      const next = pending.then(() => operation(...args), () => operation(...args));
      pending = next.catch(() => undefined); return next;
    }) as never;
  }
  return protectedRepo;
}
