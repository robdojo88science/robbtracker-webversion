import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { readCsv, readXlsx } from '../core/import';
import type { Snapshot } from '../core/types';
import { shareFile } from './files';
import { importTemplateXlsx } from './xlsx';

export async function shareImportTemplate(snapshot: Snapshot): Promise<void> {
  await shareFile(importTemplateXlsx(snapshot), 'import-template.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'org.openxmlformats.spreadsheetml.sheet');
}
export async function pickImportFile(): Promise<{ name: string; rows: string[][] } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'public.comma-separated-values-text'], copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0], file = new File(asset.uri);
  try {
    if ((asset.size ?? file.size) > 5_000_000) throw new Error('Choose a file smaller than 5 MB. Import up to 2,000 rows at once.');
    const rows = /\.xlsx$/i.test(asset.name) ? readXlsx(await file.bytes()) : /\.csv$/i.test(asset.name) ? readCsv(await file.text()) : (() => { throw new Error('Choose an .xlsx or .csv file. Older .xls files need to be saved as .xlsx first.'); })();
    return { name: asset.name, rows };
  } finally { if (file.uri.startsWith(Paths.cache.uri) && file.exists) file.delete(); }
}
