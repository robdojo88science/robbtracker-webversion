import type { Goal, GoalContribution, Snapshot, Transaction } from './types';
import { addDays, addMonthsClamped, assertDate, fromDate, inclusiveDays, localDate, monthKey, previousRange } from './dates';
import { safeAdd, convertMinor } from './money';

export const DEFAULT_THRESHOLDS = [0.25, 0.5, 0.75, 1, 1.25];
export const PERFORMANCE_LABELS = ['Sobrang Tipid', 'Tipid', 'Sakto Lang', 'Medyo Magastos Na', 'Magastos Na', 'Sobrang Gastos Na'];
/** The last configured monthly budget continues until explicitly changed. */
export function budgetForMonth(snapshot: Snapshot, month = monthKey()): number {
  return snapshot.budgets.filter(b=>!b.deletedAt&&b.month<=month).sort((a,b)=>b.month.localeCompare(a.month))[0]?.amountMinor??0;
}
/** Integer proration assigns leftover centavos to the earliest days of each month. */
export function budgetForRange(snapshot: Snapshot, start: string, end: string): number {
  assertDate(start);assertDate(end);if(start>end)throw new Error('Start date must be on or before end date.');
  let amount = 0;
  const configuredBudgets = snapshot.budgets.filter(budget => !budget.deletedAt).sort((a, b) => a.month.localeCompare(b.month));
  let nextBudget = 0, budget = 0;
  const first = new Date(`${start}T12:00:00Z`), last = new Date(`${end}T12:00:00Z`);
  const date = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1, 12));
  while (date <= last) {
    const month=date.toISOString().slice(0,7);
    while (nextBudget < configuredBudgets.length && configuredBudgets[nextBudget].month <= month) {
      const selected = configuredBudgets[nextBudget];
      budget = selected.amountMinor;
      // Preserve the first record's precedence if older data contains a duplicate month.
      do { nextBudget++; } while (nextBudget < configuredBudgets.length && configuredBudgets[nextBudget].month === selected.month);
    }
    const days=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
    const firstDay=month===start.slice(0,7)?first.getUTCDate():1,lastDay=month===end.slice(0,7)?last.getUTCDate():days;
    const remainderDays=Math.max(0,Math.min(lastDay,budget%days)-firstDay+1);
    amount=safeAdd(amount,(lastDay-firstDay+1)*Math.floor(budget/days)+remainderDays);
    date.setUTCMonth(date.getUTCMonth()+1);
  }
  return amount;
}
export function spending(transactions: Transaction[], start: string, end: string): number {
  return transactions.filter(t => t.kind === 'expense' && !t.voidedAt && !t.deletedAt && t.date >= start && t.date <= end).reduce((sum, t) => safeAdd(sum, t.baseAmountMinor??t.amountMinor), 0);
}
export function performanceLevel(spentMinor: number, budgetMinor: number, thresholds = DEFAULT_THRESHOLDS): {label: string; index: number; ratio: number} {
  const ratio = budgetMinor > 0 ? spentMinor / budgetMinor : 0;
  const index = thresholds.findIndex(t => ratio <= t);
  const level = index < 0 ? 5 : index;
  return { label: budgetMinor > 0 ? PERFORMANCE_LABELS[level] : 'Set a budget', index: level, ratio };
}
/** Shared by the dashboard, Performance, and scheduled summaries. */
export function spendingPerformance(spentMinor: number, budgetMinor: number, thresholds = DEFAULT_THRESHOLDS) {
  const level = performanceLevel(spentMinor, budgetMinor, thresholds);
  return { ...level, spentMinor, budgetMinor, remainingMinor: safeAdd(budgetMinor, -spentMinor), percent: Math.round(level.ratio * 1000) / 10 };
}
export function periodSummary(snapshot: Snapshot, start: string, end: string) {
  const previous = previousRange(start, end);
  let spentMinor = 0, previousMinor = 0, count = 0;
  for (const transaction of snapshot.transactions) {
    if (transaction.kind !== 'expense' || transaction.voidedAt || transaction.deletedAt) continue;
    if (transaction.date >= start && transaction.date <= end) { spentMinor = safeAdd(spentMinor, transaction.baseAmountMinor ?? transaction.amountMinor); count++; }
    else if (transaction.date >= previous.start && transaction.date <= previous.end) previousMinor = safeAdd(previousMinor, transaction.baseAmountMinor ?? transaction.amountMinor);
  }
  return { spentMinor, count, dailyAverageMinor: Math.round(spentMinor / Math.max(1, inclusiveDays(start, end))), previousMinor, changePercent: previousMinor > 0 ? (spentMinor - previousMinor) / previousMinor * 100 : null };
}
export function goalProgress(goal: Goal, contributions: GoalContribution[], transactions?: Transaction[], now = new Date()) {
  const activeTransactions = transactions ? new Set(transactions.filter(transaction => !transaction.voidedAt && !transaction.deletedAt).map(transaction => transaction.id)) : undefined;
  const savedMinor = contributions.filter(c => c.goalId === goal.id && !c.deletedAt && (!activeTransactions || activeTransactions.has(c.transactionId))).reduce((sum, c) => safeAdd(sum, c.amountMinor), 0);
  const remainingMinor = Math.max(0, goal.targetMinor - savedMinor);
  const monthlyMinor = Math.ceil(goal.targetMinor / goal.durationMonths);
  let nextDate = addMonthsClamped(`${monthKey(now)}-01`, 0, goal.paymentDay);
  if (nextDate < localDate(now)) nextDate = addMonthsClamped(nextDate, 1, goal.paymentDay);
  if (nextDate < goal.startDate) nextDate = addMonthsClamped(goal.startDate, fromDate(goal.startDate).getDate() > goal.paymentDay ? 1 : 0, goal.paymentDay);
  return { savedMinor, remainingMinor, percent: Math.min(100, savedMinor / goal.targetMinor * 100), monthlyMinor, estimatedDate: remainingMinor === 0 ? localDate(now) : addMonthsClamped(nextDate, Math.max(0, Math.ceil(remainingMinor / monthlyMinor) - 1), goal.paymentDay), nextDate };
}
export function categoryBreakdown(snapshot: Snapshot, start: string, end: string) {
  const totals = new Map<string, number>();
  for (const tx of snapshot.transactions) if (tx.kind === 'expense' && !tx.voidedAt && !tx.deletedAt && tx.date >= start && tx.date <= end) totals.set(tx.categoryId ?? '', safeAdd(totals.get(tx.categoryId ?? '') ?? 0, tx.baseAmountMinor??tx.amountMinor));
  const total = [...totals.values()].reduce((a,b)=>safeAdd(a,b),0);
  return [...totals.entries()].map(([categoryId, amountMinor]) => ({categoryId, name: snapshot.categories.find(c=>c.id===categoryId)?.name ?? 'Uncategorized', color: snapshot.categories.find(c=>c.id===categoryId)?.color ?? '#789187', amountMinor, percent: total ? amountMinor / total * 100 : 0})).sort((a,b)=>b.amountMinor-a.amountMinor);
}
/** Each tagged expense contributes its full amount to each tag; percentages are of total spending. */
export function tagBreakdown(snapshot:Snapshot,start:string,end:string){
  const totals=new Map<string,number>();const total=spending(snapshot.transactions,start,end);
  for(const tx of snapshot.transactions)if(tx.kind==='expense'&&!tx.voidedAt&&!tx.deletedAt&&tx.date>=start&&tx.date<=end)for(const tagId of tx.tagIds.length?tx.tagIds:[''])totals.set(tagId,safeAdd(totals.get(tagId)??0,tx.baseAmountMinor??tx.amountMinor));
  return [...totals].map(([tagId,amountMinor])=>({tagId,name:snapshot.tags.find(t=>t.id===tagId)?.name??'Untagged',color:snapshot.tags.find(t=>t.id===tagId)?.color??'#94A3B8',amountMinor,percent:total?amountMinor/total*100:0})).sort((a,b)=>b.amountMinor-a.amountMinor);
}
/** Native currency units. A negative liability balance means money owed. */
export function computeAccountBalances(transactions: readonly Transaction[], accountIds?: ReadonlySet<string>): Map<string, number> {
  const balances = new Map<string, number>();
  const add = (accountId: string, amount: number) => {
    if (!accountIds || accountIds.has(accountId)) balances.set(accountId, safeAdd(balances.get(accountId) ?? 0, amount));
  };
  for (const transaction of transactions) {
    if (transaction.voidedAt || transaction.deletedAt) continue;
    if (transaction.kind === 'transfer') {
      add(transaction.accountId, -transaction.amountMinor);
      if (transaction.destinationAccountId) add(transaction.destinationAccountId, transaction.destinationAmountMinor ?? 0);
    } else add(transaction.accountId, transaction.kind === 'income' || transaction.kind === 'adjustment_credit' ? transaction.amountMinor : -transaction.amountMinor);
  }
  return balances;
}
export function accountBalance(snapshot:Pick<Snapshot,'transactions'>,accountId:string):number{
  return snapshot.transactions.filter(t=>!t.voidedAt&&!t.deletedAt).reduce((sum,t)=>{
    if(t.kind==='transfer'){
      if(t.accountId===accountId)sum=safeAdd(sum,-t.amountMinor);
      if(t.destinationAccountId===accountId)sum=safeAdd(sum,t.destinationAmountMinor??0);
      return sum;
    }
    return t.accountId===accountId?safeAdd(sum,t.kind==='income'||t.kind==='adjustment_credit'?t.amountMinor:-t.amountMinor):sum;
  },0);
}
export function balanceSummary(snapshot:Pick<Snapshot,'transactions'|'accounts'>){
  const included = snapshot.accounts.filter(account => !account.deletedAt && account.includedInBalance);
  const balances = computeAccountBalances(snapshot.transactions, new Set(included.map(account => account.id)));
  let assetsMinor=0,liabilitiesMinor=0;
  for(const a of included){
    const amount=convertMinor(balances.get(a.id) ?? 0,a.exchangeRate);
    if(a.type==='asset')assetsMinor=safeAdd(assetsMinor,amount);else liabilitiesMinor=safeAdd(liabilitiesMinor,-amount);
  }
  return{assetsMinor,liabilitiesMinor,availableMinor:safeAdd(assetsMinor,-liabilitiesMinor)};
}
export function dailyTrend(transactions: Transaction[], start: string, end: string) {
  const days = inclusiveDays(start, end); if (days < 1 || days > 110_000) throw new Error('Choose a shorter date range.');
  const bucketSize = Math.max(1, Math.ceil(days / 31));
  const result: {date: string; amountMinor: number}[] = [];
  for (let i=0; i<days; i+=bucketSize) result.push({date:addDays(start,i), amountMinor:0});
  const firstDay = Date.parse(`${start}T00:00:00Z`);
  for (const transaction of transactions) {
    if (transaction.kind !== 'expense' || transaction.voidedAt || transaction.deletedAt || transaction.date < start || transaction.date > end) continue;
    const bucket = Math.floor((Date.parse(`${transaction.date}T00:00:00Z`) - firstDay) / 86_400_000 / bucketSize);
    result[bucket].amountMinor = safeAdd(result[bucket].amountMinor, transaction.baseAmountMinor ?? transaction.amountMinor);
  }
  return result;
}
