import { readCsv, readXlsx } from '../core/import';
import type { Snapshot } from '../core/types';
import { chooseBrowserFile, shareFile } from './files.web';
import { importTemplateXlsx } from './xlsx';

export async function shareImportTemplate(snapshot: Snapshot): Promise<void> {
  await shareFile(importTemplateXlsx(snapshot), 'import-template.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'org.openxmlformats.spreadsheetml.sheet');
}
export async function pickImportFile(): Promise<{ name: string; rows: string[][] } | null> {
  const file = await chooseBrowserFile('.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if (!file) return null;
  if (file.size > 5_000_000) throw new Error('Choose a file smaller than 5 MB. Import up to 2,000 rows at once.');
  const rows = /\.xlsx$/i.test(file.name)
    ? readXlsx(new Uint8Array(await file.arrayBuffer()))
    : /\.csv$/i.test(file.name) ? readCsv(await file.text())
    : (() => { throw new Error('Choose an .xlsx or .csv file. Save older .xls files as .xlsx first.'); })();
  return { name: file.name, rows };
}
