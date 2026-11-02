import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { interpretChat } from '../src/core/chat';
import { isQuickMessage } from '../src/core/ai';
import { readCsv, readXlsx, reviewImport } from '../src/core/import';
import { transactionsCsv } from '../src/platform/csv';
import { importTemplateXlsx, transactionsXlsx } from '../src/platform/xlsx';
import type { Snapshot } from '../src/core/types';

const snapshot = {
  profile: { baseCurrency: 'PHP' },
  accounts: [{ id: 'cash', name: 'Cash, "Daily"', type: 'asset', currency: 'PHP', exchangeRate: 1, includedInBalance: true, deletedAt: null }],
  categories: [{ id: 'transport', name: 'Transport', deletedAt: null }, { id: 'food', name: 'Food & groceries', deletedAt: null }],
  tags: [], transactions: [],
} as unknown as Snapshot;
const now = new Date(2026, 10, 5, 12);

test('quick chat corrects compact shorthand and misspelled dates without saving', () => {
  const before = JSON.stringify(snapshot);
  for (const [message, date] of [['trasnpo25 tdy', '2026-11-05'], ['tranpso 25 yday', '2026-11-04'], ['transpo 25 Novemebr5,2024', '2024-11-05'], ['transpo 25 day before yesterday', '2026-11-03']]) {
    assert.equal(isQuickMessage(message, snapshot), true);
    const result = interpretChat(message, snapshot, now);
    assert.equal(result.type, 'draft'); if (result.type !== 'draft') continue;
    assert.equal(result.input.date, date); assert.equal(result.input.amountMinor, 2500);
    assert.equal(result.input.categoryId, 'transport'); assert.equal(result.input.title, 'Transport');
  }
  assert.equal(JSON.stringify(snapshot), before);
});

test('historical date queries stay on the fast local path and use the requested date', () => {
  const message = 'How much did I spend on Transport Nov5,2024?';
  assert.equal(isQuickMessage(message, snapshot), true);
  const records = { ...snapshot, transactions: [{ kind: 'expense', amountMinor: 2500, baseAmountMinor: 2500, date: '2024-11-05', accountId: 'cash', categoryId: 'transport', tagIds: [] }] } as unknown as Snapshot;
  const result = interpretChat(message, records, now);
  assert.equal(result.type, 'answer'); assert.match(result.message, /25\.00/); assert.match(result.message, /2024-11-05 to 2024-11-05/);
  assert.equal(isQuickMessage('How much did I spend today yesterday?', snapshot), false);
});

test('Excel template contains editable numeric money and dates, frozen headers and standard workbook parts', () => {
  const bytes = importTemplateXlsx(snapshot, '2026-11-05');
  const archive = unzipSync(bytes);
  assert.ok(archive['[Content_Types].xml']); assert.ok(archive['_rels/.rels']); assert.ok(archive['xl/styles.xml']);
  const sheet = strFromU8(archive['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /state="frozen"/); assert.match(sheet, /<autoFilter ref="A1:J3"/);
  assert.match(sheet, /<c r="A3" s="3"><v>\d+<\/v>/); assert.match(sheet, /<c r="D3" s="2"><v>125\.5<\/v>/);
  assert.doesNotMatch(sheet, /<f[ >]/);
  const rows = readXlsx(bytes), review = reviewImport(rows, snapshot);
  assert.deepEqual(review.issues, []); assert.equal(review.inputs.length, 2);
  assert.equal(review.inputs[1].date, '2026-11-05'); assert.equal(review.inputs[1].amountMinor, 12550);
  assert.equal(review.inputs[1].accountId, 'cash');
});

test('Excel and CSV ledger exports retain Unicode, literal formula-like text and compatible import headings', () => {
  const data = { ...snapshot, transactions: [{ id: 't', kind: 'expense', title: '=Lunch & café', notes: 'Tea, "rice"\n第二行', date: '2024-11-05', amountMinor: 12550, baseAmountMinor: 12550, accountId: 'cash', categoryId: 'food', tagIds: [], createdAt: '2024-11-05T00:00:00.000Z', updatedAt: '2024-11-05T00:00:00.000Z' }] } as unknown as Snapshot;
  const bytes = transactionsXlsx(data), rows = readXlsx(bytes);
  assert.equal(rows[1][1], '2024-11-05'); assert.equal(rows[1][3], '=Lunch & café'); assert.equal(rows[1][4], '125.5'); assert.equal(rows[1][5], '-125.5');
  assert.equal(rows[1][7], 'Tea, "rice"\n第二行'); assert.equal(rows[1][11], 'Cash, "Daily"');
  assert.deepEqual(reviewImport(rows, snapshot).issues, []);
  assert.deepEqual(reviewImport(readCsv(transactionsCsv(data)), snapshot).issues, []);
  const archived = rows.map(row => [...row]); archived[1][8] = 'voided';
  assert.match(reviewImport(archived, snapshot).issues[0].message, /voided/);
  const changedCurrency = rows.map(row => [...row]); changedCurrency[1][12] = 'USD';
  assert.match(reviewImport(changedCurrency, snapshot).issues[0].message, /Currency must match/);
});
