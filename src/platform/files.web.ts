import type { BackupEnvelope, Snapshot } from '../core/types';
import { transactionsCsv } from './csv';
import { transactionsXlsx } from './xlsx';

const MAX_BACKUP_BYTES = 128 * 1024 * 1024;
let pickerOpen = false;

/** Open from a user gesture. Cancel settles the promise and releases the input. */
export function chooseBrowserFile(accept: string): Promise<File | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  if (pickerOpen) return Promise.reject(new Error('A file chooser is already open.'));
  pickerOpen = true;
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
    let settled = false, focusTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (file: File | null, error?: Error) => {
      if (settled) return;
      settled = true; pickerOpen = false;
      if (focusTimer) clearTimeout(focusTimer);
      window.removeEventListener('focus', focusReturned);
      input.remove();
      if (error) reject(error); else resolve(file);
    };
    const focusReturned = () => {
      focusTimer = setTimeout(() => finish(input.files?.[0] ?? null), 400);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    window.addEventListener('focus', focusReturned);
    document.body.appendChild(input);
    try { input.click(); }
    catch { finish(null, new Error('The file chooser could not open. Try again from the file button.')); }
  });
}

export function shareText(text: string, extension: string, mimeType: string, UTI: string): Promise<void> {
  return shareFile(text, extension, mimeType, UTI);
}

/** Download locally; use file sharing when the browser supports it in this gesture. */
export async function shareFile(contents: string | Uint8Array, extension: string, mimeType: string, _UTI: string): Promise<void> {
  if (typeof document === 'undefined') throw new Error('Open the browser app to save a file.');
  const payload: BlobPart = typeof contents === 'string' ? contents : new Uint8Array(contents).buffer;
  const name = 'Robb-Tracker-' + new Date().toISOString().slice(0, 10) + '.' + extension.replace(/[^a-z0-9.-]/gi, '');
  const file = new File([payload], name, { type: mimeType });
  if (navigator.userActivation?.isActive && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Save your Robb Tracker file' }); return; }
    catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Saving was cancelled.');
      // File download remains available when the platform share sheet rejects a file type.
    }
  }
  const url = URL.createObjectURL(file), link = document.createElement('a');
  link.href = url; link.download = name; link.rel = 'noopener';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function shareBackup(backup: BackupEnvelope): Promise<void> {
  return shareText(JSON.stringify(backup), 'ftracker.json', 'application/json', 'public.json');
}
export function shareCsv(snapshot: Snapshot): Promise<void> {
  return shareText(transactionsCsv(snapshot), 'csv', 'text/csv', 'public.comma-separated-values-text');
}
export function shareWorkbook(snapshot: Snapshot): Promise<void> {
  return shareFile(transactionsXlsx(snapshot), 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'org.openxmlformats.spreadsheetml.sheet');
}
export async function pickBackup(): Promise<unknown | null> {
  const file = await chooseBrowserFile('.json,.ftracker.json,application/json,text/plain');
  if (!file) return null;
  if (file.size > MAX_BACKUP_BYTES) throw new Error('Choose a backup smaller than 128 MB.');
  let parsed: unknown;
  try { parsed = JSON.parse(await file.text()); }
  catch { throw new Error('Choose a valid Robb Tracker JSON backup.'); }
  if (parsed === null) throw new Error('This file is not a tracker backup.');
  return parsed;
}
