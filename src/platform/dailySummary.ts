import { addDays, dateRange, fromDate, localDate } from '../core/dates';
import { budgetForMonth, spendingPerformance } from '../core/analytics';
import { formatMoney, safeAdd } from '../core/money';
import type { Snapshot } from '../core/types';

export interface DailySummary {identifier:string;date:Date;title:string;body:string;day:string;totalMinor:number;count:number;level:number;monthSpentMinor:number;budgetMinor:number;ratio:number;percent:number;performanceLabel:string}
export const SUMMARY_DAYS=28;
function expenseTotals(snapshot:Snapshot,start:string,end:string){
  const totals=new Map<string,{totalMinor:number;count:number}>();
  const months=new Map<string,number>();
  for(const transaction of snapshot.transactions){
    if(transaction.kind!=='expense'||transaction.voidedAt||transaction.deletedAt||transaction.date<start||transaction.date>end)continue;
    const previous=totals.get(transaction.date)??{totalMinor:0,count:0};
    totals.set(transaction.date,{totalMinor:safeAdd(previous.totalMinor,transaction.baseAmountMinor??transaction.amountMinor),count:previous.count+1});
    const month=transaction.date.slice(0,7);months.set(month,safeAdd(months.get(month)??0,transaction.baseAmountMinor??transaction.amountMinor));
  }
  return {days:totals,months};
}
function summaryContent(snapshot:Snapshot,day:string,{totalMinor,count}:{totalMinor:number;count:number},monthSpentMinor:number){
  const budget=budgetForMonth(snapshot,day.slice(0,7)),performance=spendingPerformance(monthSpentMinor,budget,snapshot.profile?.performanceThresholds);
  const currency=snapshot.profile?.baseCurrency;
  const month=fromDate(day).toLocaleDateString(undefined,{month:'short'});
  const monthly=budget>0?`${month}: ${performance.label} · ${performance.percent}% of ${formatMoney(budget,currency)} budget used (${formatMoney(monthSpentMinor,currency)} spent).`:`${month}: ${formatMoney(monthSpentMinor,currency)} spent. No monthly budget set.`;
  const body=`Today: ${formatMoney(totalMinor,currency)} · ${count} expense${count===1?'':'s'}. ${monthly}`;
  return {totalMinor,count,level:performance.index,body,monthSpentMinor,budgetMinor:budget,ratio:performance.ratio,percent:performance.percent,performanceLabel:performance.label};
}
export function summaryForDay(snapshot:Snapshot,day:string){
  const range=dateRange('month',fromDate(day)),totals=expenseTotals(snapshot,range.start,range.end);
  return summaryContent(snapshot,day,totals.days.get(day)??{totalMinor:0,count:0},totals.months.get(day.slice(0,7))??0);
}
function fingerprint(text:string):string {let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);return(hash>>>0).toString(16);}
/** Precomputed from local records, and refreshed after every financial write. */
export function planDailySummaries(snapshot:Snapshot,now=new Date(),limit=SUMMARY_DAYS):DailySummary[]{
  if(!snapshot.profile?.dailySummaryEnabled)return[];
  if(limit<=0)return[];
  const today=localDate(now),end=dateRange('month',fromDate(addDays(today,limit))).end,totals=expenseTotals(snapshot,`${today.slice(0,7)}-01`,end);
  const result:DailySummary[]=[];
  for(let offset=0;result.length<limit&&offset<limit+1;offset++){
    const day=addDays(today,offset),date=fromDate(day);date.setHours(23,59,59,0);
    if(date.getTime()<=now.getTime()+1000)continue;
    const summary=summaryContent(snapshot,day,totals.days.get(day)??{totalMinor:0,count:0},totals.months.get(day.slice(0,7))??0),stamp=fingerprint(`${summary.body}|${snapshot.profile.notificationSound}|${date.getTime()}`);
    result.push({identifier:`ftracker:summary:${day}:${stamp}`,date,day,title:'Your daily spending summary',...summary});
  }
  return result;
}
