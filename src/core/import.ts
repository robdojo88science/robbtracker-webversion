import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { assertDate } from './dates';
import { parseMoney, safeAdd, convertMinor } from './money';
import { accountBalance } from './analytics';
import type { Snapshot, TransactionInput } from './types';

export const IMPORT_HEADERS = ['Date', 'Type', 'Title', 'Amount', 'Account', 'Category', 'Tags', 'Destination Account', 'Destination Amount', 'Notes'];
export const MAX_IMPORT_ROWS = 2000;
export interface ImportIssue { row: number; message: string }
export interface ImportReview { inputs: TransactionInput[]; issues: ImportIssue[]; duplicates: number }

export function readCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '');
  const push = () => { row.push(cell); cell = ''; closed = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      push();
      if (c !== ',') { rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else if (c === '"' && cell === '' && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error('Invalid CSV quoting. Save the file as CSV UTF-8 in Excel and try again.'); cell += c; }
    if (rows.length > MAX_IMPORT_ROWS + 1) throw new Error(`Import up to ${MAX_IMPORT_ROWS} rows at a time.`);
  }
  if (quoted) throw new Error('A quoted CSV field is not closed.');
  if (cell || row.length || closed) { push(); rows.push(row); }
  return rows;
}

const list = <T,>(v: T | T[] | undefined): T[] => v === undefined ? [] : Array.isArray(v) ? v : [v];
const decode = (s: string) => s.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, value => {
  const key = value.slice(1, -1);
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  if (named[key]) return named[key];
  const n = key.startsWith('#x') ? parseInt(key.slice(2), 16) : Number(key.slice(1));
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
});
export function readXlsx(bytes: Uint8Array): string[][] {
  let expanded = 0;
  const files = unzipSync(bytes, { filter: entry => {
    if (!/^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(entry.name)) return false;
    expanded += entry.originalSize;
    if (entry.originalSize > 8_000_000 || expanded > 16_000_000) throw new Error('This workbook is too large. Use a smaller file.');
    return true;
  } });
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false, removeNSPrefix: true });
  const xml = (name: string) => {
    const bytes = files[name]; if (!bytes) return undefined;
    const text = strFromU8(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('This workbook contains unsupported XML declarations.');
    return parser.parse(text);
  };
  const wb = xml('xl/workbook.xml');
  if (wb?.workbook?.workbookPr?.['@_date1904'] === '1' || wb?.workbook?.workbookPr?.['@_date1904'] === 'true') throw new Error('Use the standard 1900 date system or enter dates as YYYY-MM-DD text.');
  const firstSheet = list<any>(wb?.workbook?.sheets?.sheet)[0];
  const relation = list<any>(xml('xl/_rels/workbook.xml.rels')?.Relationships?.Relationship).find(r => r['@_Id'] === firstSheet?.['@_id']);
  const target = relation?.['@_Target'];
  if(relation?.['@_TargetMode']==='External')throw new Error('The first worksheet must be stored inside the workbook.');
  const resolveTarget=(target:string)=>{
    const parts:string[]=[];
    for(const part of (target.startsWith('/')?target.slice(1):`xl/${target}`).split('/')){
      if(!part||part==='.')continue;
      if(part==='..'){if(!parts.length)throw new Error('The workbook has an invalid worksheet path.');parts.pop();}else parts.push(part);
    }
    return parts.join('/');
  };
  if(firstSheet&&!relation)throw new Error('The first worksheet relationship is missing. Save as a new .xlsx file and try again.');
  const sheetName = typeof target === 'string' ? resolveTarget(target) : 'xl/worksheets/sheet1.xml';
  if(!/^xl\/worksheets\/[^/]+\.xml$/.test(sheetName))throw new Error('The first sheet must be a regular worksheet.');
  const sheet = xml(sheetName);
  if (!sheet) throw new Error('No readable first worksheet. Save as .xlsx or CSV UTF-8.');
  const rich = (node: any): string => {
    if (typeof node === 'string') return decode(node);
    if (node?.t !== undefined) return decode(String(typeof node.t === 'object' ? node.t?.['#text'] ?? '' : node.t));
    return list<any>(node?.r).map(r => rich(r)).join('');
  };
  const shared = list<any>(xml('xl/sharedStrings.xml')?.sst?.si).map(rich);
  const rawRows = list<any>(sheet.worksheet?.sheetData?.row);
  if (rawRows.length > MAX_IMPORT_ROWS + 1) throw new Error(`Import up to ${MAX_IMPORT_ROWS} rows at a time.`);
  const cellTypes:string[][]=[];
  const result=rawRows.map((raw,rowIndex) => {
    const row: string[] = [];
    cellTypes[rowIndex]=[];
    for (const cell of list<any>(raw.c)) {
      if (cell.f !== undefined) throw new Error(`Row ${raw['@_r'] ?? '?'} contains a formula. Paste values only before importing.`);
      const letters = String(cell['@_r'] ?? '').match(/^[A-Z]+/)?.[0];
      const index = letters ? [...letters].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1 : row.length;
      if (index > 30) continue;
      const type = cell['@_t'];
      cellTypes[rowIndex][index]=type??'n';
      let value = type === 's' ? shared[Number(cell.v)] ?? '' : type === 'inlineStr' ? rich(cell.is) : decode(String(cell.v ?? ''));
      row[index] = value;
    }
    return Array.from({ length: row.length }, (_, i) => row[i] ?? '');
  });
  const headerIndex=result.findIndex(row=>row.some(cell=>cell.trim()));
  const dateIndex=result[headerIndex]?.findIndex(cell=>cell.trim().toLowerCase()==='date')??-1;
  if(dateIndex>=0)for(let i=headerIndex+1;i<result.length;i++){
    const value=result[i][dateIndex]??'',type=cellTypes[i][dateIndex];
    if(type==='d'&&/^\d{4}-\d{2}-\d{2}T/.test(value))result[i][dateIndex]=value.slice(0,10);
    if(type==='n'&&/^\d{1,7}(?:\.0+)?$/.test(value)){
      const serial=Number(value);
      if(serial===60)throw new Error(`Row ${i+1}: Excel's date 1900-02-29 does not exist. Choose a valid date.`);
      if(serial>0&&serial<=2958465)result[i][dateIndex]=new Date(Date.UTC(1899,11,serial<60?31:30)+serial*86400000).toISOString().slice(0,10);
    }
  }
  return result;
}

const norm = (s: string) => s.trim().toLocaleLowerCase();
const headerAliases: Record<string, string> = {
  description: 'title', wallet: 'account', 'amount (wallet currency)': 'amount', 'destination wallet': 'destination account',
};
export function reviewImport(rows: string[][], snapshot: Snapshot): ImportReview {
  const [header, ...body] = rows.map((row,index)=>({row,number:index+1})).filter(item => item.row.some(cell => cell.trim()));
  const headers=header?.row;
  if (!headers) throw new Error('The file is empty. Download and fill in the template first.');
  const names = headers.map(value => headerAliases[norm(value)] ?? norm(value));
  for (const required of ['date', 'type', 'title', 'amount', 'account']) if (!names.includes(required)) throw new Error(`Missing column: ${required}. Use the downloadable template.`);
  if (new Set(names).size !== names.length) throw new Error('Column names must be unique.');
  if (body.length > MAX_IMPORT_ROWS) throw new Error(`Import up to ${MAX_IMPORT_ROWS} rows at a time.`);
  const inputs: TransactionInput[] = [], issues: ImportIssue[] = [];
  let duplicates = 0;
  const key = (t: { date: string; kind: string; title: string; amountMinor: number; accountId?: string; destinationAccountId?: string | null; destinationAmountMinor?: number | null; categoryId?: string | null; tagIds?: string[]; notes?: string }) => JSON.stringify([t.date,t.kind,norm(t.title),t.amountMinor,t.accountId,t.destinationAccountId??null,t.destinationAmountMinor??null,t.categoryId??null,[...t.tagIds??[]].sort(),t.notes?.trim()??'']);
  const known = new Set(snapshot.transactions.filter(t => !t.voidedAt && !t.deletedAt).map(key));
  body.forEach(({row,number}) => {
    try {
      const get = (column: string) => (row[names.indexOf(column)] ?? '').trim();
      if (get('status') && norm(get('status')) !== 'active') throw new Error('Remove voided or deleted rows before importing. Import only adds new active transactions.');
      const date = get('date'); assertDate(date);
      const kind = norm(get('type'));
      if (!['income', 'expense', 'transfer'].includes(kind)) throw new Error('Type must be income, expense, or transfer.');
      const account = snapshot.accounts.find(a => !a.deletedAt && norm(a.name) === norm(get('account')));
      if (!account) throw new Error(`Wallet "${get('account')}" does not exist. Add it in My wallets first.`);
      if (get('currency') && get('currency').toUpperCase() !== account.currency) throw new Error(`Currency must match ${account.name}: ${account.currency}.`);
      const title = get('title'); if (!title || title.length > 120) throw new Error('Title must contain 1–120 characters.');
      const amountMinor = parseMoney(get('amount'));
      const category = get('category') ? snapshot.categories.find(c => !c.deletedAt && norm(c.name) === norm(get('category'))) : null;
      if (get('category') && !category) throw new Error(`Category "${get('category')}" does not exist. Add it in Categories first.`);
      const tagIds = [...new Set(get('tags').split('|').filter(Boolean).map(name => {
        const tag = snapshot.tags.find(t => !t.deletedAt && norm(t.name) === norm(name));
        if (!tag) throw new Error(`Tag "${name}" does not exist. Add it in Tags first.`);
        return tag.id;
      }))];
      if(tagIds.length>20)throw new Error('Choose up to 20 tags for each transaction.');
      if(get('notes').length>2000)throw new Error('Notes must be at most 2,000 characters.');
      const input: TransactionInput = { kind: kind as TransactionInput['kind'], title, date, amountMinor, accountId: account.id, categoryId: kind === 'expense' ? category?.id ?? null : null, tagIds, notes: get('notes') };
      if (kind === 'transfer') {
        const destination = snapshot.accounts.find(a => !a.deletedAt && norm(a.name) === norm(get('destination account')));
        if (!destination || destination.id === account.id) throw new Error('Choose a different existing destination wallet.');
        input.destinationAccountId = destination.id;
        input.destinationAmountMinor = get('destination amount') ? parseMoney(get('destination amount')) : destination.currency === account.currency ? amountMinor : undefined;
        if (!input.destinationAmountMinor) throw new Error('Enter Destination Amount in the destination currency for this transfer.');
      }
      if (known.has(key(input))) { duplicates++; return; }
      known.add(key(input)); inputs.push(input);
    } catch (error) { issues.push({ row: number, message: error instanceof Error ? error.message : 'Check this row.' }); }
  });
  return { inputs, issues, duplicates };
}

/** Match repository checks in upload order; liability balances may be negative by design. */
export function importBalanceWarnings(inputs:TransactionInput[],snapshot:Snapshot):string[]{
  const running=new Map(snapshot.accounts.map(a=>[a.id,accountBalance(snapshot,a.id)]));const over=new Set<string>();
  for(const tx of inputs){
    const wallet=snapshot.accounts.find(a=>a.id===tx.accountId&&!a.deletedAt);if(!wallet)throw new Error('A selected wallet is no longer available. Upload the file again.');
    const mainAvailable=snapshot.accounts.filter(a=>!a.deletedAt&&a.includedInBalance).reduce((sum,a)=>safeAdd(sum,convertMinor(running.get(a.id)??0,a.exchangeRate)),0);
    if(tx.kind==='expense'&&wallet.includedInBalance&&convertMinor(tx.amountMinor,wallet.exchangeRate)>mainAvailable)over.add(snapshot.profile?.balanceLabel??'Main available balance');
    const debit=['expense','transfer','adjustment_debit'].includes(tx.kind),next=safeAdd(running.get(wallet.id)??0,debit?-tx.amountMinor:tx.amountMinor);
    if(debit&&wallet.type==='asset'&&next<0)over.add(wallet.name);running.set(wallet.id,next);
    if(tx.destinationAccountId)running.set(tx.destinationAccountId,safeAdd(running.get(tx.destinationAccountId)??0,tx.destinationAmountMinor??0));
  }
  return[...over];
}
