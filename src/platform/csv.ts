import type { Snapshot } from '../core/types';

/** Prefix spreadsheet formulas even after control/space characters; preserve CSV quoting. */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) && typeof value !== 'number' && !/^-?\d+(?:\.\d+)?$/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function minorText(value: number): string {
  const negative = value < 0;
  const magnitude = Math.abs(value);
  return `${negative ? '-' : ''}${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, '0')}`;
}

export const TRANSACTION_EXPORT_HEADERS = ['ID', 'Date', 'Type', 'Description', 'Amount (wallet currency)', 'Signed balance effect (base currency)', 'Category', 'Notes', 'Status', 'Created at', 'Updated at', 'Wallet', 'Currency', 'Tags', 'Destination wallet', 'Destination amount'];

/** Shared ledger values keep CSV and Excel exports financially identical. */
export function transactionExportRows(snapshot: Snapshot): (string | number)[][] {
  const names = new Map(snapshot.categories.map(category => [category.id, category.name]));
  const rows: (string | number)[][] = snapshot.transactions.map(transaction => {
    const debit = ['expense', 'adjustment_debit', 'goal_contribution'].includes(transaction.kind);
    const effect = transaction.voidedAt || transaction.deletedAt || transaction.kind === 'transfer' ? 0 : (transaction.baseAmountMinor ?? transaction.amountMinor) * (debit ? -1 : 1);
    return [transaction.id, transaction.date, transaction.kind, transaction.title, minorText(transaction.amountMinor), minorText(effect),
      transaction.categoryId ? names.get(transaction.categoryId) ?? '' : '', transaction.notes,
      transaction.voidedAt ? 'voided' : transaction.deletedAt ? 'deleted' : 'active', transaction.createdAt, transaction.updatedAt,
      snapshot.accounts?.find(a => a.id === transaction.accountId)?.name ?? '', snapshot.accounts?.find(a => a.id === transaction.accountId)?.currency ?? 'PHP',
      (transaction.tagIds ?? []).map(id => snapshot.tags?.find(t => t.id === id)?.name ?? '').filter(Boolean).join(' | '),
      snapshot.accounts?.find(a => a.id === transaction.destinationAccountId)?.name ?? '', transaction.destinationAmountMinor == null ? '' : minorText(transaction.destinationAmountMinor)];
  });
  return rows;
}

/** Human-readable ledger export; backups separately contain goals, settings and full audit data. */
export function transactionsCsv(snapshot: Snapshot): string {
  // UTF-8 BOM keeps the peso sign and other Unicode text readable in spreadsheet apps.
  return '\uFEFF' + [TRANSACTION_EXPORT_HEADERS, ...transactionExportRows(snapshot)].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
