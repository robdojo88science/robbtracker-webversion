import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { readCsv, readXlsx, reviewImport, importBalanceWarnings, IMPORT_HEADERS } from '../src/core/import';
import { interpretChat } from '../src/core/chat';
import { transactionsCsv } from '../src/platform/csv';
import type { Snapshot } from '../src/core/types';

const snapshot = {
  profile: { baseCurrency: 'PHP', balanceLabel: 'My money' },
  accounts: [{ id: 'cash', name: 'Cash', type: 'asset', currency: 'PHP', exchangeRate: 1, includedInBalance: true, deletedAt: null }, { id: 'bdo', name: 'BDO', type: 'asset', currency: 'PHP', exchangeRate: 1, includedInBalance: true, deletedAt: null }, { id: 'usd', name: 'Dollars', type: 'asset', currency: 'USD', exchangeRate: 56, includedInBalance: false, deletedAt: null }],
  categories: [{ id: 'food', name: 'Food', deletedAt: null }], tags: [{ id: 'work', name: 'work', deletedAt: null }], transactions: [],
} as unknown as Snapshot;
const headers = IMPORT_HEADERS;
const row = ['2026-01-15', 'expense', 'Lunch', '125.50', 'Cash', 'Food', 'work', '', '', 'Team lunch'];

test('CSV reader retains Excel UTF-8, multiline notes, escaped quotes and last empty cells', () => {
  assert.deepEqual(readCsv('\uFEFFDate,Notes,Empty\r\n2026-01-15,"Lunch, with ""friends""\nand coffee",\r\n'), [['Date', 'Notes', 'Empty'], ['2026-01-15', 'Lunch, with "friends"\nand coffee', '']]);
  assert.throws(() => readCsv('a,"unclosed'), /not closed/);
  assert.throws(() => readCsv('a,"x"invalid'), /quoting/);
});
test('import review resolves wallet, tag and category and retains integer cents', () => {
  const result = reviewImport([headers, row], snapshot);
  assert.deepEqual(result.issues, []); assert.equal(result.inputs[0].amountMinor, 12550);
  assert.equal(result.inputs[0].categoryId, 'food'); assert.deepEqual(result.inputs[0].tagIds, ['work']);
  assert.equal(result.inputs[0].accountId, 'cash'); assert.equal(result.inputs[0].notes, 'Team lunch');
});
test('import review reports bad rows without ever silently creating missing wallets or accepting invalid dates', () => {
  const invalid = [...row]; invalid[0] = '2026-02-30';
  const missing = [...row]; missing[4] = 'Unknown';
  const precision = [...row]; precision[3] = '1.001';
  const result = reviewImport([headers, invalid, missing, precision], snapshot);
  assert.equal(result.inputs.length, 0); assert.deepEqual(result.issues.map(e => e.row), [2, 3, 4]);
  assert.match(result.issues[1].message, /Wallet/);
});
test('duplicate import detection skips exact repeated entries while preserving distinct tags and notes', () => {
  const another = [...row]; another[9] = 'Different purchase';
  const result = reviewImport([headers, row, row, another], snapshot);
  assert.equal(result.inputs.length, 2); assert.equal(result.duplicates, 1);
  const withHistory = { ...snapshot, transactions: result.inputs.map(tx => ({ ...tx, voidedAt: null, deletedAt: null })) } as Snapshot;
  assert.equal(reviewImport([headers, row], withHistory).duplicates, 1);
});
test('cross-currency import requires destination currency amount', () => {
  const transfer = ['2026-01-15', 'transfer', 'Exchange', '5600', 'Cash', '', '', 'Dollars', '', ''];
  assert.match(reviewImport([headers, transfer], snapshot).issues[0].message, /Destination Amount/);
  transfer[8] = '100'; assert.equal(reviewImport([headers, transfer], snapshot).inputs[0].destinationAmountMinor, 10000);
});
function workbook(sheet: string, shared = '') { return zipSync({ 'xl/worksheets/sheet1.xml': strToU8(sheet), ...(shared ? { 'xl/sharedStrings.xml': strToU8(shared) } : {}) }); }
test('XLSX reader handles shared and inline text, sparse cells, XML escapes and Excel dates', () => {
  const bytes = workbook('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Date</t></is></c><c r="B1" t="s"><v>0</v></c></row><row r="2"><c r="A2"><v>46037</v></c><c r="C2" t="inlineStr"><is><t>Tea &amp; toast</t></is></c></row></sheetData></worksheet>', '<sst><si><t>Title</t></si></sst>');
  assert.deepEqual(readXlsx(bytes), [['Date', 'Title'], ['2026-01-15', '', 'Tea & toast']]);
});
test('XLSX reader rejects formulas and XML declarations rather than evaluating user content', () => {
  assert.throws(() => readXlsx(workbook('<worksheet><sheetData><row><c r="A1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>')), /formula/);
  assert.throws(() => readXlsx(workbook('<!DOCTYPE test><worksheet/>')), /unsupported XML/);
});

test('XLSX resolves the first sheet relationship, arbitrary worksheet names and relative paths',()=>{
  const xml='<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Date</t></is></c></row><row r="2"><c r="A2"><v>46037</v></c></row></sheetData></worksheet>';
  for(const target of ['worksheets/Transactions.xml','/xl/worksheets/Transactions.xml','../xl/worksheets/Transactions.xml']){
    const bytes=zipSync({'xl/workbook.xml':strToU8('<workbook xmlns:r="urn:relationships"><sheets><sheet name="History" r:id="chosen"/></sheets></workbook>'),'xl/_rels/workbook.xml.rels':strToU8(`<Relationships><Relationship Id="chosen" Target="${target}"/></Relationships>`),'xl/worksheets/Transactions.xml':strToU8(xml)});
    assert.deepEqual(readXlsx(bytes),[['Date'],['2026-01-15']]);
  }
});

test('XLSX converts numeric dates by the Date header including reordered columns and early 1900 dates',()=>{
  const bytes=workbook('<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Amount</t></is></c><c r="B1" t="inlineStr"><is><t>Date</t></is></c></row><row><c r="A2"><v>46037</v></c><c r="B2"><v>1</v></c></row><row><c r="B3"><v>59</v></c></row><row><c r="B4" t="d"><v>2026-01-15T00:00:00Z</v></c></row></sheetData></worksheet>');
  assert.deepEqual(readXlsx(bytes),[['Amount','Date'],['46037','1900-01-01'],['','1900-02-28'],['','2026-01-15']]);
  assert.throws(()=>readXlsx(workbook('<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Date</t></is></c></row><row><c r="A2"><v>60</v></c></row></sheetData></worksheet>')),/does not exist/);
});

test('upload validation reports original row numbers across blank rows and catches long notes before confirmation',()=>{
  const invalid=[...row];invalid[9]='x'.repeat(2001);const result=reviewImport([headers,[],row,[],invalid],snapshot);assert.equal(result.inputs.length,1);assert.equal(result.issues[0].row,5);assert.match(result.issues[0].message,/2,000/);
});

test('import overdraft warnings follow file order, currency conversion and the asset versus debt distinction',()=>{
  const funded={...snapshot,transactions:[{kind:'income',amountMinor:10000,accountId:'cash'}],accounts:[...snapshot.accounts,{id:'card',name:'Card',type:'liability',currency:'PHP',exchangeRate:1,includedInBalance:true}]} as Snapshot;
  assert.deepEqual(importBalanceWarnings([{kind:'expense',title:'Lunch',date:'2026-01-15',amountMinor:2000,accountId:'card'}],funded),[]);
  assert.deepEqual(importBalanceWarnings([{kind:'transfer',title:'Move',date:'2026-01-15',amountMinor:5000,accountId:'cash',destinationAccountId:'bdo',destinationAmountMinor:5000},{kind:'expense',title:'Lunch',date:'2026-01-15',amountMinor:5000,accountId:'bdo'}],funded),[]);
  assert.deepEqual(importBalanceWarnings([{kind:'expense',title:'Lunch',date:'2026-01-15',amountMinor:5000,accountId:'bdo'},{kind:'transfer',title:'Move',date:'2026-01-15',amountMinor:5000,accountId:'cash',destinationAccountId:'bdo',destinationAmountMinor:5000}],funded),['BDO']);
  assert.throws(()=>importBalanceWarnings([{kind:'expense',title:'Lunch',date:'2026-01-15',amountMinor:100,accountId:'missing'}],funded),/no longer available/);
});
test('offline chat builds a review draft including date, wallet, tag, and exact amount', () => {
  const result = interpretChat('spent 250 on lunch from Cash yesterday #work', snapshot, new Date(2026, 0, 16, 12));
  assert.equal(result.type, 'draft'); if (result.type !== 'draft') return;
  assert.equal(result.input.amountMinor, 25000); assert.equal(result.input.accountId, 'cash'); assert.equal(result.input.date, '2026-01-15'); assert.deepEqual(result.input.tagIds, ['work']);
  assert.equal(snapshot.transactions.length, 0);
});
test('offline chat rejects ambiguous amounts, negative amounts, missing wallets and impossible dates', () => {
  for (const text of ['spent -250 from Cash', 'spent 250 and 100 from Cash', 'spent 250 from Unknown', 'spent 250 from Cash on 2026-02-30', 'spent .50 from Cash', 'spent 1k from Cash', 'spent 25% from Cash']) assert.throws(() => interpretChat(text, snapshot));
  assert.throws(() => interpretChat('transfer 500 from Cash to Dollars', snapshot), /both currency/);
  for(const text of ['spent .50 from Cash','spent 1k from Cash','spent 10% from Cash','spent 250 from Cash yesterday on 2026-01-15','spent 250 from Cash on 2026-01-15 to 2026-01-16'])assert.throws(()=>interpretChat(text,snapshot),text);
});
test('offline chat calculates read-only spending and balance replies from local records', () => {
  const data = { ...snapshot, transactions: [{ id: 'a', kind: 'income', amountMinor: 100000, baseAmountMinor: 100000, accountId: 'cash', date: '2026-01-15', title: 'Salary', tagIds: [] }, { id: 'b', kind: 'expense', amountMinor: 25000, baseAmountMinor: 25000, accountId: 'cash', date: '2026-01-16', title: 'Lunch', tagIds: ['work'], categoryId: 'food' }] } as Snapshot;
  assert.match(interpretChat('What is my balance?', data).message, /750\.00/);
  assert.match(interpretChat('How much did I spend on Food this month?', data, new Date(2026, 0, 16, 12)).message, /250\.00/);
});

test('chat reviews a detailed purchase and new hashtags without creating records before confirmation', () => {
  const data = { ...snapshot, categories: [{ ...snapshot.categories[0], name: 'Food & groceries' }] } as Snapshot;
  const before = JSON.stringify(data);
  const result = interpretChat('Jollibee Chicken Joy 128.56 food #wants #WANTS #work from cash', data, new Date(2026, 10, 1, 12));
  assert.equal(result.type, 'draft'); if (result.type !== 'draft') return;
  assert.equal(result.input.title, 'Jollibee Chicken Joy');
  assert.equal(result.input.amountMinor, 12856); assert.equal(result.input.categoryId, 'food');
  assert.deepEqual(result.input.tagIds, ['work']); assert.deepEqual(result.newTagNames, ['wants']);
  assert.match(result.message, /only when you confirm/); assert.equal(JSON.stringify(data), before);
});

test('chat recognizes income destinations and flexible transfer amount order', () => {
  for (const message of ['add money 500 to Cash today', 'received salary 500 into Cash today', 'cash in 500 to Cash today']) {
    const result = interpretChat(message, snapshot, new Date(2026, 10, 1, 12));
    assert.equal(result.type, 'draft'); if (result.type !== 'draft') continue;
    assert.equal(result.input.kind, 'income'); assert.equal(result.input.accountId, 'cash'); assert.equal(result.input.amountMinor, 50000);
  }
  for (const message of ['transfer 500 from Cash to BDO', 'transfer from Cash to BDO 500']) {
    const result = interpretChat(message, snapshot);
    assert.equal(result.type, 'draft'); if (result.type !== 'draft') continue;
    assert.equal(result.input.kind, 'transfer'); assert.equal(result.input.accountId, 'cash'); assert.equal(result.input.destinationAccountId, 'bdo'); assert.equal(result.input.destinationAmountMinor, 50000);
  }
});

test('chat keeps purchase descriptions and resolves longer wallet names without confusing their digits for money', () => {
  const data = { ...snapshot, accounts: [...snapshot.accounts, { ...snapshot.accounts[0], id: 'cash2', name: 'Cash 2' }] } as Snapshot;
  const result = interpretChat('paid 25 from Cash 2 for hot tea', data);
  assert.equal(result.type, 'draft'); if (result.type !== 'draft') return;
  assert.equal(result.input.accountId, 'cash2'); assert.equal(result.input.amountMinor, 2500); assert.equal(result.input.title, 'Hot tea');
  assert.throws(() => interpretChat('paid 25 from Cash Bank', snapshot), /not found/);
});

test('unknown hashtag spending questions return no matching history instead of all spending', () => {
  const data = { ...snapshot, transactions: [{ id: 'a', kind: 'expense', amountMinor: 99900, baseAmountMinor: 99900, accountId: 'cash', date: '2026-11-01', title: 'Lunch', tagIds: ['work'] }] } as Snapshot;
  const result = interpretChat('How much did I spend #wants this month?', data, new Date(2026, 10, 1, 12));
  assert.equal(result.type, 'answer'); assert.match(result.message, /No saved transactions use #wants/);
  assert.throws(() => interpretChat(`lunch 25 #${'a'.repeat(41)}`, snapshot), /40 characters/);
});

test('spelling assistance preserves custom hashtag and wallet names', () => {
  const data = { ...snapshot, accounts: [...snapshot.accounts, { ...snapshot.accounts[0], id: 'tranpo', name: 'Tranpo' }], tags: [...snapshot.tags, { ...snapshot.tags[0], id: 'transpo', name: 'transpo' }] } as Snapshot;
  const result = interpretChat('transpo 25 yesterdy #transpo from Tranpo', data, new Date(2026, 10, 1, 12));
  assert.equal(result.type, 'draft'); if (result.type !== 'draft') return;
  assert.equal(result.input.accountId, 'tranpo'); assert.deepEqual(result.input.tagIds, ['transpo']); assert.deepEqual(result.newTagNames, []);
  assert.equal(result.input.date, '2026-10-31');
});
test('CSV export labels native wallet currency and never counts transfers as income', () => {
  const data = { ...snapshot, transactions: [{ id: 't', kind: 'transfer', amountMinor: 560000, baseAmountMinor: 0, accountId: 'cash', destinationAccountId: 'usd', destinationAmountMinor: 10000, date: '2026-01-16', title: 'Exchange', tagIds: ['work'], notes: '' }] } as Snapshot;
  const csv = transactionsCsv(data); assert.match(csv, /wallet currency/); assert.match(csv, /"5600\.00","0\.00"/); assert.match(csv, /"Cash","PHP","work","Dollars","100\.00"/);
});
