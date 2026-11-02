import { zipSync, strToU8 } from 'fflate';
import { assertDate, localDate } from '../core/dates';
import type { Snapshot } from '../core/types';
import { transactionExportRows, TRANSACTION_EXPORT_HEADERS } from './csv';
import { importTemplateRows } from './importTemplate';

type Cell = string | number;
const xml = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const column = (index: number): string => {
  let label = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
  return label;
};
function dateSerial(value: string): number {
  assertDate(value);
  const [year, month, day] = value.split('-').map(Number);
  const serial = (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 31)) / 86400000;
  return serial >= 60 ? serial + 1 : serial;
}

/** Small, standards-based OOXML writer for the offline native app; no macros or formulas. */
function workbook(headers: string[], rows: Cell[][], options: { name: string; dateColumn: number; amountColumns: number[] }): Uint8Array {
  const last = `${column(headers.length - 1)}${rows.length + 1}`;
  const cell = (value: Cell, row: number, col: number): string => {
    const ref = `${column(col)}${row + 1}`;
    if (row > 0 && col === options.dateColumn && value !== '') return `<c r="${ref}" s="3"><v>${dateSerial(String(value))}</v></c>`;
    if (row > 0 && options.amountColumns.includes(col) && value !== '') {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) throw new Error('A spreadsheet amount is invalid.');
      return `<c r="${ref}" s="2"><v>${numeric}</v></c>`;
    }
    // Explicit inline strings preserve literal =,+,-,@ text without formula execution.
    return `<c r="${ref}" t="inlineStr" s="${row === 0 ? 1 : 0}"><is><t xml:space="preserve">${xml(String(value))}</t></is></c>`;
  };
  const widths = headers.map((header, index) => {
    const content = rows.reduce((length, row) => Math.max(length, String(row[index] ?? '').split('\n')[0].length), header.length + 2);
    const width = Math.min(46, Math.max(index === options.dateColumn ? 14 : 16, content + 3));
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="19"/><cols>${widths}</cols><sheetData>${[headers, ...rows].map((values, row) => `<row r="${row + 1}"${row === 0 ? ' ht="32" customHeight="1"' : ''}>${values.map((value, col) => cell(value, row, col)).join('')}</row>`).join('')}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><color rgb="FF142B50"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0057E7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files: Record<string, string> = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(options.name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': styles,
    'xl/worksheets/sheet1.xml': sheet,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])), { level: 6 });
}

export function transactionsXlsx(snapshot: Snapshot): Uint8Array {
  return workbook(TRANSACTION_EXPORT_HEADERS, transactionExportRows(snapshot), { name: 'Transactions', dateColumn: 1, amountColumns: [4, 5, 15] });
}

export function importTemplateXlsx(snapshot: Snapshot, today = localDate()): Uint8Array {
  const [headers, ...rows] = importTemplateRows(snapshot, today);
  return workbook(headers, rows, { name: 'Transactions', dateColumn: 0, amountColumns: [3, 8] });
}
