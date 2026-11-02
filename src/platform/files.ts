import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import type { BackupEnvelope, Snapshot } from '../core/types';
import { transactionsCsv } from './csv';
import { transactionsXlsx } from './xlsx';

const MAX_BACKUP_BYTES = 128 * 1024 * 1024;
const TEMP_PREFIX = 'ftracker-export-';

export async function shareText(text: string, extension: string, mimeType: string, UTI: string): Promise<void> {
  return shareFile(text, extension, mimeType, UTI);
}

export async function shareFile(contents: string | Uint8Array, extension: string, mimeType: string, UTI: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable on this device.');
  const file = new File(Paths.cache, `${TEMP_PREFIX}${Crypto.randomUUID()}.${extension}`);
  try {
    file.create({ overwrite: false });
    await file.write(contents);
    await Sharing.shareAsync(file.uri, { mimeType, UTI, dialogTitle: 'Save your Robb Tracker file' });
  } finally {
    // Native shareAsync settles when the share sheet closes; remove its temporary copy.
    if (file.exists) file.delete();
  }
}

/** Unencrypted portable backup. UI must explain that it contains private financial data. */
export function shareBackup(backup: BackupEnvelope): Promise<void> {
  return shareText(JSON.stringify(backup), 'ftracker.json', 'application/json', 'public.json');
}

export function shareCsv(snapshot: Snapshot): Promise<void> {
  return shareText(transactionsCsv(snapshot), 'csv', 'text/csv', 'public.comma-separated-values-text');
}

export function shareWorkbook(snapshot: Snapshot): Promise<void> {
  return shareFile(transactionsXlsx(snapshot), 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'org.openxmlformats.spreadsheetml.sheet');
}

/** Returns untrusted parsed input; repository.restoreBackup performs schema/checksum/integrity validation. */
export async function pickBackup(): Promise<unknown | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain'], copyToCacheDirectory: true, multiple: false });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const file = new File(asset.uri);
  try {
    if ((asset.size ?? file.size) > MAX_BACKUP_BYTES) throw new Error('This backup is too large. The supported maximum is 128 MB.');
    const raw = await file.text();
    if (raw.length > MAX_BACKUP_BYTES) throw new Error('This backup is too large. The supported maximum is 128 MB.');
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null) throw new Error('Null is not a backup.');
      return parsed;
    } catch { throw new Error('This file is not a valid F-Tracker JSON backup.'); }
  } finally {
    // DocumentPicker was asked for a cache copy. Only remove files inside that cache.
    if (file.uri.startsWith(Paths.cache.uri) && file.exists) file.delete();
  }
}
