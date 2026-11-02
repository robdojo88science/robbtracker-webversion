import { addDays, assertDate, dateRange, localDate, type Period } from './dates';
import { formatMoney, parseMoney } from './money';
import { accountBalance, balanceSummary, spending } from './analytics';
import type { Account, Category, Snapshot, TransactionInput } from './types';

export type ChatDraft = { type: 'draft'; input: TransactionInput; message: string; newTagNames?: string[] };
export type SingleChatResult = { type: 'answer'; message: string } | ChatDraft;
export type ChatBatch = { type: 'batch'; drafts: ChatDraft[]; message: string };
export type ChatResult = SingleChatResult | ChatBatch;
export const MAX_CHAT_BATCH = 20;

const corrections: Record<string, string> = {
  tody: 'today', todai: 'today', todya: 'today', todqy: 'today', tday: 'today', tdy: 'today', ngayon: 'today',
  yesterdy: 'yesterday', yesterda: 'yesterday', yesteray: 'yesterday', yesturday: 'yesterday', yesterdey: 'yesterday', kahapon: 'yesterday',
  yday: 'yesterday', ystrday: 'yesterday', yestaday: 'yesterday',
  tommorow: 'tomorrow', tomorow: 'tomorrow', bukas: 'tomorrow',
  expence: 'expense', expnse: 'expense', spnt: 'spent', recieved: 'received', recived: 'received', receved: 'received',
  tranfer: 'transfer', trasnfer: 'transfer', transferr: 'transfer',
  transpo: 'transport', tranpo: 'transport', trasnpo: 'transport', tranpso: 'transport', trnsport: 'transport', trasport: 'transport', transpot: 'transport', trasnport: 'transport', transporation: 'transport',
  grocries: 'groceries', grocerys: 'groceries', grocerries: 'groceries', coffe: 'coffee', cofffee: 'coffee', brekfast: 'breakfast', dinenr: 'dinner',
  jollibe: 'Jollibee', chiken: 'chicken', salry: 'salary', sallary: 'salary', depost: 'deposit',
  novemebr: 'november', novemeber: 'november', febuary: 'february', feburary: 'february', sept: 'sep',
};
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthPattern = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasPhrase = (text: string, phrase: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(phrase)}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(text);
export function normalizeChatMessage(text: string, snapshot?: Snapshot): string {
  const walletWords = new Set(snapshot?.accounts.flatMap(account => account.name.toLowerCase().match(/[a-z]+/g) ?? []) ?? []);
  // Letter runs also handle "transpo25" and "Novemebr5,2024". Preserve actual
  // wallet names and hashtags rather than correcting user-created labels.
  return clean(text.normalize('NFKC').replace(/#[\p{L}\p{N}_-]+|[a-z]+/giu, (word, offset, source: string) => {
    if (word.startsWith('#') || walletWords.has(word.toLowerCase())) return word;
    const correction = corrections[word.toLowerCase()];
    return correction ? correction + (/^\d/.test(source.slice(offset + word.length)) ? ' ' : '') : word;
  }));
}

/** Date expressions are removed before amounts, so Nov5,2024 never becomes money. */
export function parseChatMessageDate(text: string, now = new Date()): { date: string; rest: string; explicit: boolean } {
  const dates: string[] = [];
  const save = (year: number, month: number, day: number) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    assertDate(date); dates.push(date); return ' ';
  };
  let rest = text.replace(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g, (_, year, month, day) => save(Number(year), Number(month), Number(day)));
  rest = rest.replace(new RegExp(`\\b(${monthPattern})\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b`, 'gi'), (_, month, day, year) => save(Number(year ?? now.getFullYear()), months.indexOf(month.slice(0, 3).toLowerCase()) + 1, Number(day)));
  rest = rest.replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(${monthPattern})\\.?(?:\\s*,?\\s*(\\d{4}))?\\b`, 'gi'), (_, day, month, year) => save(Number(year ?? now.getFullYear()), months.indexOf(month.slice(0, 3).toLowerCase()) + 1, Number(day)));
  rest = rest.replace(/\bday before yesterday\b/gi, () => { dates.push(addDays(localDate(now), -2)); return ' '; });
  rest = rest.replace(/\b(today|yesterday|tomorrow)\b/gi, expression => {
    dates.push(addDays(localDate(now), expression.toLowerCase() === 'yesterday' ? -1 : expression.toLowerCase() === 'tomorrow' ? 1 : 0)); return ' ';
  });
  if (dates.length > 1) throw new Error('Choose one date: today, yesterday, or a date such as Nov5,2024.');
  if (/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(rest)) throw new Error('Write that date as Nov5,2024 or 2024-11-05 so the month is clear.');
  return { date: dates[0] ?? localDate(now), rest: clean(rest), explicit: dates.length > 0 };
}

const categoryGroups = [
  { category: /transport|travel|commut|fare/i, words: /\b(transport|transportation|taxi|grab|jeep|jeepney|bus|fare|train|mrt|lrt|angkas|gas|fuel|parking)\b/i },
  { category: /food|grocer|meal|dining|drink/i, words: /\b(food|groceries|grocery|lunch|breakfast|dinner|meal|coffee|snack|restaurant|rice|bread|water|tea|jollibee|mcdonalds|chowking|chickenjoy)\b/i },
  { category: /bill|utilit/i, words: /\b(bill|electricity|electric|meralco|internet|wifi|rent|utility|utilities|load)\b/i },
  { category: /health|medical/i, words: /\b(doctor|medicine|medication|hospital|pharmacy|health|medical|checkup)\b/i },
  { category: /entertain|leisure/i, words: /\b(movie|cinema|netflix|game|concert|spotify|entertainment)\b/i },
  { category: /shop|cloth/i, words: /\b(shopping|clothes|shirt|shoes|lazada|shopee)\b/i },
];
function inferCategory(text: string, categories: Category[]): Category | undefined {
  const active = categories.filter(category => !category.deletedAt);
  const exact = active.find(category => hasPhrase(text, category.name));
  if (exact) return exact;
  for (const group of categoryGroups) if (group.words.test(text)) {
    const category = active.find(item => group.category.test(item.name));
    if (category) return category;
  }
  return undefined;
}
function readTags(text: string, snapshot: Snapshot): { rest: string; tagIds: string[]; newTagNames: string[] } {
  const tagIds: string[] = [];
  const newTagNames: string[] = [];
  const rest = text.replace(/#([\p{L}\p{N}_-]+)/gu, (_, name: string) => {
    if (name.length > 40) throw new Error('Keep each tag name to 40 characters or fewer.');
    const tag = snapshot.tags.find(item => !item.deletedAt && item.name.toLowerCase() === name.toLowerCase());
    if (tag) tagIds.push(tag.id);
    else if (!newTagNames.some(item => item.toLowerCase() === name.toLowerCase())) newTagNames.push(name);
    return ' ';
  });
  return { rest: clean(rest), tagIds: [...new Set(tagIds)], newTagNames };
}

/** Match the actual wallet name, leaving descriptions and amounts on either side intact. */
function walletBinding(text: string, accounts: Account[], prepositions: string): { account?: Account; rest: string; phrase?: string } {
  for (const account of [...accounts].sort((a, b) => b.name.length - a.name.length)) {
    const expression = new RegExp(`\\b(?:${prepositions})\\s+${escapeRegex(account.name)}(?=$|\\s+(?:\\d|for\\b|on\\b|at\\b|to\\b|into\\b)|[^\\p{L}\\p{N}_\\s])`, 'iu');
    const match = text.match(expression);
    if (match) return { account, rest: clean(text.replace(expression, ' ')), phrase: match[0] };
  }
  return { rest: text };
}
function defaultAccount(accounts: Account[], currency: string): Account | undefined {
  const matching = accounts.filter(account => account.type === 'asset' && account.currency === currency);
  return matching.find(account => account.name.toLowerCase() === 'cash') ?? matching.find(account => account.includedInBalance) ?? matching[0] ?? accounts.find(account => account.type === 'asset') ?? accounts[0];
}

/** Offline interpretation only: never writes to storage or evaluates code. */
export function interpretChat(text: string, snapshot: Snapshot, now = new Date()): SingleChatResult {
  const value = normalizeChatMessage(text, snapshot);
  if (!value) throw new Error('Try “transpo 25 today” or ask about your balance.');
  if (value.length > 2000) throw new Error('Keep the message under 2,000 characters.');
  const accounts = snapshot.accounts.filter(account => !account.deletedAt);
  const currency = snapshot.profile?.baseCurrency ?? 'PHP';
  if (/\b(balance|assets|liabilities|how much.*(?:left|have))\b/i.test(value) && !/\b(spent|paid|received|transfer|add)\b/i.test(value)) {
    const summary = balanceSummary(snapshot), account = accounts.find(account => hasPhrase(value, account.name));
    return { type: 'answer', message: account ? `${account.name}: ${formatMoney(accountBalance(snapshot, account.id), account.currency)}` : `${snapshot.profile?.balanceLabel ?? 'Available balance'}: ${formatMoney(summary.availableMinor, currency)}\nAssets: ${formatMoney(summary.assetsMinor, currency)} · Liabilities: ${formatMoney(summary.liabilitiesMinor, currency)}` };
  }
  const dated = parseChatMessageDate(value, now);
  if (/\b(?:how much|total|show)\b.*\b(?:spend|spent|spending|expenses)\b/i.test(value)) {
    const period: Period = /\ball time\b/i.test(value) ? 'allTime' : /\b(?:this year|annual|yearly)\b/i.test(value) ? 'thisYear' : /\blast year\b/i.test(value) ? 'lastYear' : /\blast month\b/i.test(value) ? 'lastMonth' : /\blast 365 days\b/i.test(value) ? 'last365' : /\blast 30 days\b/i.test(value) ? 'last30' : /\blast 7 days\b/i.test(value) ? 'last7' : /\bthis week\b/i.test(value) ? 'week' : 'month';
    const range = dated.explicit ? { start: dated.date, end: dated.date } : dateRange(period, now, undefined, undefined, snapshot.transactions.filter(item => !item.deletedAt).map(item => item.date));
    const category = inferCategory(value, snapshot.categories), tagged = readTags(value, snapshot), tags = tagged.tagIds;
    if (tagged.newTagNames.length) return { type: 'answer', message: `No saved transactions use ${tagged.newTagNames.map(name => `#${name}`).join(', ')} yet.` };
    const account = accounts.find(account => hasPhrase(value, account.name));
    const transactions = snapshot.transactions.filter(item => (!category || item.categoryId === category.id) && (!tags.length || tags.every(id => item.tagIds.includes(id))) && (!account || item.accountId === account.id));
    return { type: 'answer', message: `${formatMoney(spending(transactions, range.start, range.end), currency)} spent${category ? ` · ${category.name}` : ''}${account ? ` · ${account.name}` : ''}\n${range.start} to ${range.end}` };
  }
  if (/^(?:delete|remove|void|reset|drop|import|update|edit|execute|eval|function|const|let|var)\b/i.test(value)) throw new Error('Describe money in, an expense, or a transfer. You can edit existing records from Transactions.');
  const explicitKind = /^(?:transfer|move)\b/i.test(value) ? 'transfer' : /^(?:add|received?|income|earned|deposit|cash\s*in)\b/i.test(value) ? 'income' : /^(?:spent|spend|paid|pay|expense|bought)\b/i.test(value) ? 'expense' : null;
  const kind = explicitKind ?? (/\b(?:salary|payroll|sahod|sweldo|refund|reimbursement|income)\b/i.test(value) ? 'income' : 'expense');
  const tagged = readTags(dated.rest, snapshot);
  const source = walletBinding(tagged.rest, accounts, kind === 'income' ? 'into|in|to|from' : kind === 'transfer' ? 'from' : 'from|using|via|in');
  const target = kind === 'transfer' ? walletBinding(source.rest, accounts, 'to|into') : { rest: source.rest, account: undefined };
  const amountText = target.rest;
  const unknownWallet = amountText.replace(/^cash\s*in\b/i, '').match(/\b(?:from|into|using|via|in|to)\s+(.+?)(?=\s+\b(?:from|into|to)\b|$)/i);
  if (unknownWallet) throw new Error(`Wallet “${unknownWallet[1].trim()}” was not found. Use a name from My wallets.`);
  if (/[-−]\s*(?:[₱$€£]\s*)?\d|\(\s*\d[\d,.]*\s*\)/.test(amountText)) throw new Error('Use a positive amount. Income or expense determines its direction.');
  if (/(?:^|[^\d])\.\d|\d\s*(?:[kmb]|thousand|million|billion)\b|\d\s*%/i.test(amountText)) throw new Error('Write the full amount, such as 0.50 or 1000.');
  const amounts = amountText.match(/(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g) ?? [];
  if (amounts.length !== 1) throw new Error('Use one amount per message, for example “transpo 25 today”.');
  const amountMinor = parseMoney(amounts[0]);
  const currencyCodes = [...new Set(accounts.map(account => account.currency))];
  const codeHint = currencyCodes.find(code => hasPhrase(amountText, code));
  const currencyHint = /₱/.test(amountText) ? 'PHP' : /\$/.test(amountText) ? 'USD' : /€/.test(amountText) ? 'EUR' : /£/.test(amountText) ? 'GBP' : codeHint;
  const account = source.account ?? defaultAccount(accounts, currencyHint ?? currency);
  if (!account) throw new Error('Add a wallet before recording a transaction.');
  if (currencyHint && account.currency !== currencyHint) throw new Error(`Choose a ${currencyHint} wallet, or remove the currency symbol. ${account.name} uses ${account.currency}.`);
  let title = amountText.replace(/^(?:add(?:\s+money)?|received?|income|earned|deposit|cash\s*in|spent|spend|paid|pay|expense|bought|transfer|move)\s*/i, '').replace(amounts[0], '').replace(/[₱$€£]/g, '');
  for (const code of currencyCodes) title = title.replace(new RegExp(`\\b${escapeRegex(code)}\\b`, 'gi'), '');
  title = clean(title).replace(/^(?:on|for|at)\s+|\s+(?:on|for|at)$/gi, '').replace(/^[\s,:-]+|[\s,:-]+$/g, '');
  const category = kind === 'expense' ? inferCategory(value, snapshot.categories) : undefined;
  if (category) {
    // A trailing category hint can label a purchase without becoming its description.
    const lastWord = title.match(/\s+(\S+)$/)?.[1];
    if (lastWord && /^(?:food|groceries|transport|transportation|bills|utilities|health|entertainment|shopping)$/i.test(lastWord)) title = title.slice(0, -lastWord.length).trim();
  }
  if (!title && !explicitKind) throw new Error('Add a short description, such as “transpo 25”.');
  if (title.length > 120) throw new Error('Keep the transaction description to 120 characters or fewer.');
  title = kind === 'transfer' ? 'Wallet transfer' : title ? title.charAt(0).toUpperCase() + title.slice(1) : kind === 'income' ? 'Money added' : 'Expense';
  const input: TransactionInput = { kind, title, date: dated.date, amountMinor, accountId: account.id, tagIds: tagged.tagIds, categoryId: category?.id ?? null };
  if (kind === 'transfer') {
    const destination = target.account;
    if (!destination || destination.id === account.id) throw new Error('Choose a different destination, for example “transfer 500 from Cash to BDO”.');
    if (destination.currency !== account.currency) throw new Error('Use the Transfer form to review both currency amounts for this transfer.');
    input.destinationAccountId = destination.id; input.destinationAmountMinor = amountMinor;
  }
  return { type: 'draft', input, newTagNames: tagged.newTagNames, message: `${kind === 'income' ? 'Money in' : kind === 'transfer' ? 'Transfer' : 'Expense'} · ${account.name}. Review the details before saving.${tagged.newTagNames.length ? ` New tags will be created only when you confirm.` : ''}` };
}

/** Find punctuation outside amounts, named dates, real labels and quoted descriptions. */
function batchSeparators(text: string, snapshot: Snapshot): { commas: number[]; semicolons: number[] } {
  const protectedAt = new Uint8Array(text.length);
  const protect = (expression: RegExp) => {
    for (const match of text.matchAll(expression)) protectedAt.fill(1, match.index!, match.index! + match[0].length);
  };
  protect(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g);
  const month = `(?:${monthPattern}|novemebr|novemeber|febuary|feburary|sept)`;
  protect(new RegExp(`\\b${month}\\.?\\s*\\d{1,2}(?:st|nd|rd|th)?\\s*,\\s*\\d{4}\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s*${month}\\.?\\s*,\\s*\\d{4}\\b`, 'gi'));
  for (const item of [...snapshot.accounts, ...snapshot.categories].filter(item => !item.deletedAt)) {
    if (!/[,;]/.test(item.name)) continue;
    const label=new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegex(item.name)})(?=$|[^\\p{L}\\p{N}])`, 'giu');
    for(const match of text.matchAll(label)){const start=match.index!+match[1].length;protectedAt.fill(1,start,start+match[2].length);}
  }
  const commas: number[] = [], semicolons: number[] = [];
  let quote = '', depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (protectedAt[i]) continue;
    if (quote) { if (char === quote && text[i - 1] !== '\\') quote = ''; continue; }
    if (char === '"' || char === '“') { quote = char === '“' ? '”' : '"'; continue; }
    if (char === '(' || char === '[') { depth++; continue; }
    if (char === ')' || char === ']') { depth = Math.max(0, depth - 1); continue; }
    if (depth) continue;
    if (char === ',') commas.push(i);
    if (char === ';') semicolons.push(i);
  }
  return { commas, semicolons };
}

/** Commas are boundaries only when every clause forms one unambiguous transaction. */
function splitCommaEntries(text: string, snapshot: Snapshot, now: Date): string[] {
  const { commas } = batchSeparators(text, snapshot);
  if (!commas.length) return [text];
  if (commas.length > MAX_CHAT_BATCH * 3) throw new Error('Use semicolons between entries and keep each message to 20 transactions.');
  const starts = [0, ...commas.map(index => index + 1)];
  const ends = [...commas, text.length];
  const memo = new Map<number, string[][]>();
  const parsed = new Map<string, SingleChatResult | null>();
  const parse = (value: string): SingleChatResult | null => {
    if (!parsed.has(value)) {
      try { parsed.set(value, interpretChat(value, snapshot, now)); } catch { parsed.set(value, null); }
    }
    return parsed.get(value)!;
  };
  const partitions = (start: number): string[][] => {
    if (start === starts.length) return [[]];
    if (memo.has(start)) return memo.get(start)!;
    const results: string[][] = [];
    for (let end = start; end < ends.length; end++) {
      const entry = text.slice(starts[start], ends[end]).trim();
      if (!entry || parse(entry)?.type !== 'draft') continue;
      for (const rest of partitions(end + 1)) {
        results.push([entry, ...rest]);
        if (results.length === 2) { memo.set(start, results); return results; }
      }
    }
    memo.set(start, results); return results;
  };
  const choices = partitions(0);
  if (choices.length > 1) throw new Error('That comma could belong to a description. Use semicolons between transactions.');
  if (choices.length === 1) return choices[0];
  const pieces = starts.map((start, index) => text.slice(start, ends[index]).trim()).filter(Boolean);
  const kinds = pieces.map(piece => parse(piece)?.type);
  if (kinds.includes('answer') && kinds.includes('draft')) throw new Error('Ask balance or spending questions separately from transaction batches.');
  const withAmounts = pieces.filter(piece => {
    let value = normalizeChatMessage(piece, snapshot);
    try { value = parseChatMessageDate(value, now).rest; } catch { /* An invalid dated entry still needs correction. */ }
    return /\d/.test(value);
  });
  if (withAmounts.length > 1) throw new Error('Check each comma-separated entry, or use semicolons between transactions. Every entry needs a description and a valid amount.');
  return [text];
}

/** No date, wallet or tag is inherited from another clause. This function never writes. */
export function splitChatBatch(text: string, snapshot: Snapshot, now = new Date()): string[] {
  const value = text.normalize('NFKC').trim();
  if (!value) throw new Error('Describe a transaction, such as “transpo 25 today”.');
  if (value.length > 2000) throw new Error('Keep the message under 2,000 characters.');
  const { semicolons } = batchSeparators(value, snapshot);
  const explicit = [0, ...semicolons.map(index => index + 1)].map((start, index) => value.slice(start, semicolons[index] ?? value.length).trim());
  if (semicolons.length && explicit.at(-1) === '') explicit.pop();
  if (explicit.some(entry => !entry)) throw new Error('An entry is empty. Add a description and amount between semicolons.');
  const entries = explicit.flatMap(entry => splitCommaEntries(entry, snapshot, now));
  if (entries.length > MAX_CHAT_BATCH) throw new Error('Review up to 20 transactions per message.');
  return entries;
}

export function interpretChatBatch(text: string, snapshot: Snapshot, now = new Date()): ChatResult {
  const entries = splitChatBatch(text, snapshot, now);
  if (entries.length === 1) return interpretChat(entries[0], snapshot, now);
  const drafts = entries.map((entry, index): ChatDraft => {
    try {
      const result = interpretChat(entry, snapshot, now);
      if (result.type !== 'draft') throw new Error('Ask questions separately from transaction batches.');
      return result;
    } catch (reason) { throw new Error(`Entry ${index + 1}: ${reason instanceof Error ? reason.message : 'Check the description, amount and date.'}`); }
  });
  return { type: 'batch', drafts, message: `${drafts.length} transactions ready to review. Nothing is saved until you confirm.` };
}
