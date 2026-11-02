import type { FinanceRepository } from '../core/types';
/** Native builds already serialize protected operations on their single adapter. */
export function coordinateRepository(repository: FinanceRepository): FinanceRepository { return repository; }
