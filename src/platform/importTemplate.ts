import { IMPORT_HEADERS } from '../core/import';
import { localDate, addDays } from '../core/dates';
import type { Snapshot } from '../core/types';
import { csvCell } from './csv';

export function importTemplateRows(snapshot: Snapshot, today=localDate()): string[][] {
  const account=snapshot.accounts.find(a=>!a.deletedAt)?.name??'Cash';
  const category=snapshot.categories.find(c=>!c.deletedAt)?.name??'';
  return [IMPORT_HEADERS,[addDays(today,-1),'income','Salary','1000.00',account,'','','','','Replace or delete example'],[today,'expense','Groceries','125.50',account,category,'','','','Replace or delete example']];
}

/** Standard quoted UTF-8 CSV: opens in Excel and Google Sheets, with no app-specific formulas. */
export function importTemplateCsv(snapshot: Snapshot, today=localDate()): string {
  return '\uFEFF'+importTemplateRows(snapshot,today).map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
