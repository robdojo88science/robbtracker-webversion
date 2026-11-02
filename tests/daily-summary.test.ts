import test from 'node:test';
import assert from 'node:assert/strict';
import { planDailySummaries, summaryForDay } from '../src/platform/dailySummary';
import type { Snapshot } from '../src/core/types';

const snapshot={profile:{baseCurrency:'PHP',dailySummaryEnabled:true,notificationSound:'default',performanceThresholds:[0.25,0.5,0.75,1,1.25]},budgets:[{month:'2026-11',amountMinor:300000,deletedAt:null}],transactions:[
  {kind:'expense',date:'2026-11-01',amountMinor:2500,baseAmountMinor:2500,voidedAt:null,deletedAt:null},
  {kind:'expense',date:'2026-11-02',amountMinor:9000,baseAmountMinor:9000,voidedAt:null,deletedAt:null},
  {kind:'expense',date:'2026-11-01',amountMinor:5000,baseAmountMinor:5000,voidedAt:'2026-11-01T10:00:00Z',deletedAt:null},
  {kind:'transfer',date:'2026-11-01',amountMinor:8000,baseAmountMinor:8000,voidedAt:null,deletedAt:null},
]} as unknown as Snapshot;
test('daily summary includes only active expenses for that local calendar day',()=>{
  const summary=summaryForDay(snapshot,'2026-11-01');assert.equal(summary.totalMinor,2500);assert.equal(summary.count,1);assert.match(summary.body,/25\.00/);assert.equal(summary.monthSpentMinor,11500);assert.match(summary.body,/115\.00/);
});
test('daily local alerts are scheduled at 23:59:59 with a bounded rolling window',()=>{
  const plan=planDailySummaries(snapshot,new Date(2026,10,1,12));assert.equal(plan.length,28);assert.equal(plan[0].day,'2026-11-01');assert.equal(plan[0].date.getHours(),23);assert.equal(plan[0].date.getMinutes(),59);assert.equal(plan[0].date.getSeconds(),59);assert.equal(new Set(plan.map(n=>n.identifier)).size,28);
  const next=planDailySummaries(snapshot,new Date(2026,10,1,23,59,59));assert.equal(next[0].day,'2026-11-02');
});
test('summary schedules refresh amounts after edits but retain stable identifiers for unchanged data',()=>{
  const now=new Date(2026,10,1,12),a=planDailySummaries(snapshot,now),b=planDailySummaries(snapshot,now);assert.deepEqual(a,b);
  const updated={...snapshot,transactions:snapshot.transactions.map((t,i)=>i===0?{...t,amountMinor:3000,baseAmountMinor:3000}:t)};
  const changed=planDailySummaries(updated,now);assert.notEqual(changed[0].identifier,a[0].identifier);assert.notEqual(changed[1].identifier,a[1].identifier);assert.equal(changed[1].totalMinor,a[1].totalMinor);assert.equal(changed[1].monthSpentMinor,a[1].monthSpentMinor+500);
});

test('summary identifiers change after moving to a different local time zone',()=>{
  const previous=process.env.TZ;
  try{
    process.env.TZ='Asia/Manila';const manila=planDailySummaries(snapshot,new Date(2026,10,1,12));
    process.env.TZ='America/New_York';const newYork=planDailySummaries(snapshot,new Date(2026,10,1,12));
    assert.equal(manila[0].day,newYork[0].day);assert.equal(manila[0].body,newYork[0].body);
    assert.notEqual(manila[0].date.getTime(),newYork[0].date.getTime());assert.notEqual(manila[0].identifier,newYork[0].identifier);
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
test('daily summaries respect disabling and do not invent spending for empty days',()=>{
  assert.deepEqual(planDailySummaries({...snapshot,profile:{...snapshot.profile!,dailySummaryEnabled:false}}),[]);
  const empty=summaryForDay(snapshot,'2026-11-03');assert.equal(empty.totalMinor,0);assert.equal(empty.count,0);assert.match(empty.body,/0\.00/);
});
