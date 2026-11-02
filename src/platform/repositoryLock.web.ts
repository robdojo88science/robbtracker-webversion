import type { FinanceRepository } from '../core/types';
import { withBrowserLock } from './browserStore';

export type RepositoryActionLock = <T>(work: () => Promise<T>) => Promise<T>;
/** Wrap the protected facade, so its existence check, PIN decision and write share a cross-tab lock. */
export function coordinateRepository(repository: FinanceRepository, lock: RepositoryActionLock = work => withBrowserLock('finance-actions', work)): FinanceRepository {
  const coordinated = { ...repository };
  for (const key of Object.keys(repository) as (keyof FinanceRepository)[]) {
    if (['getSnapshot', 'hasRecord', 'queryTransactions', 'createBackup'].includes(key)) continue;
    const operation = repository[key] as (...args: unknown[]) => Promise<unknown>;
    // This lock is distinct from SQLite's finance lock and the PIN service's action-pin lock.
    // Reads stay available while the user reviews a PIN dialog; failure/cancel releases the lock.
    coordinated[key] = ((...args: unknown[]) => lock(() => operation(...args))) as never;
  }
  return coordinated;
}
