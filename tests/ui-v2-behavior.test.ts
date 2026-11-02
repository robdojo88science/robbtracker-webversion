import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { dateRange } from '../src/core/dates';
import { interpretChat } from '../src/core/chat';
import { budgetForMonth, periodSummary } from '../src/core/analytics';
import { currencyChoices, isCurrencyCode, formatMoney } from '../src/core/money';
import { createRepository } from '../src/data/repository';
import { migrate } from '../src/data/migrations';
import { importTemplateCsv } from '../src/platform/importTemplate';
import { readCsv, reviewImport } from '../src/core/import';
import type { Database, SqlConnection, SqlValue } from '../src/core/database';

async function fixture(){
  const sql=new DatabaseSync(':memory:');
  const connection:SqlConnection={async exec(s){sql.exec(s);},async run(s,p:SqlValue[]=[]){return {changes:Number(sql.prepare(s).run(...p).changes)};},async all<T>(s:string,p:SqlValue[]=[]){return sql.prepare(s).all(...p) as T[];},async first<T>(s:string,p:SqlValue[]=[]){return sql.prepare(s).get(...p) as T??null;}};
  const db:Database={...connection,async transaction<T>(work:(t:SqlConnection)=>Promise<T>){sql.exec('BEGIN');try{const result=await work(connection);sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  await migrate(db);const repo=createRepository(db,{uuid:randomUUID,deviceId:randomUUID(),now:()=> '2026-11-05T04:00:00.000Z',digest:async s=>createHash('sha256').update(s).digest('hex')});
  await repo.setup({displayName:'Robb',openingBalanceMinor:1000000,monthlyBudgetMinor:100000});
  return {repo,close:()=>sql.close()};
}
test('calendar month and year include future dates; rolling and all-time periods use exact bounds',()=>{
  const now=new Date(2026,10,5,12);
  assert.deepEqual(dateRange('month',now),{start:'2026-11-01',end:'2026-11-30'});
  assert.deepEqual(dateRange('thisYear',now),{start:'2026-01-01',end:'2026-12-31'});
  assert.deepEqual(dateRange('last7',now),{start:'2026-10-30',end:'2026-11-05'});
  assert.deepEqual(dateRange('last30',now),{start:'2026-10-07',end:'2026-11-05'});
  assert.deepEqual(dateRange('last365',now),{start:'2025-11-06',end:'2026-11-05'});
  assert.deepEqual(dateRange('allTime',now,undefined,undefined,['2024-11-05','2027-01-01']),{start:'2024-11-05',end:'2027-01-01'});
});
test('budget left reacts to later monthly expenses, edits and voids without counting next month',async()=>{
  const f=await fixture();try{
    const {repo}=f,range=dateRange('month',new Date(2026,10,5));
    const left=async()=>{const s=await repo.getSnapshot();return budgetForMonth(s,'2026-11')-periodSummary(s,range.start,range.end).spentMinor;};
    const id=randomUUID();await repo.saveTransaction({id,kind:'expense',title:'Future groceries',date:'2026-11-20',amountMinor:25000});assert.equal(await left(),75000);
    await repo.saveTransaction({id,kind:'expense',title:'Future groceries',date:'2026-11-20',amountMinor:30000});assert.equal(await left(),70000);
    await repo.saveTransaction({kind:'expense',title:'Next month',date:'2026-12-01',amountMinor:10000});assert.equal(await left(),70000);
    await repo.voidTransaction(id);assert.equal(await left(),100000);
  }finally{f.close();}
});
test('custom currencies retain manual rates and survive JSON backup restore',async()=>{
  const f=await fixture(),second=await fixture();try{
    await f.repo.saveAccount({name:'Travel francs',type:'asset',currency:'XAF',exchangeRate:0.095,includedInBalance:true,openingBalanceMinor:100000});
    await second.repo.restoreBackup(await f.repo.createBackup(),true);
    assert.equal((await second.repo.getSnapshot()).accounts.find(a=>a.currency==='XAF')?.exchangeRate,0.095);
    assert.ok(currencyChoices(['XAF']).includes('XAF'));assert.equal(formatMoney(12345,'XAF'),'XAF 123.45');
    for(const code of ['','AB','abc','../USD','USD<script>'])assert.equal(isCurrencyCode(code),false);assert.ok(isCurrencyCode('USDT'));
  }finally{f.close();second.close();}
});
test('chat recognizes shorthand, spelling corrections and named dates, using Cash for review',async()=>{
  const f=await fixture();try{const s=await f.repo.getSnapshot();
    for(const [text,date] of [['transpo 25 today','2026-11-05'],['tranpo 25 yesterdy','2026-11-04'],['transpo 25 Nov5,2024','2024-11-05'],['coffee 80 nov 5 2024','2024-11-05'],['bus 25 2024-11-05','2024-11-05']]){
      const reply=interpretChat(text,s,new Date(2026,10,5,12));assert.equal(reply.type,'draft');if(reply.type==='draft'){assert.equal(reply.input.date,date);assert.equal(reply.input.accountId,s.accounts[0].id);assert.equal(reply.input.amountMinor,text.startsWith('coffee')?8000:2500);if(!text.startsWith('coffee'))assert.equal(s.categories.find(c=>c.id===reply.input.categoryId)?.name,'Transport');}
    }
    assert.equal((await f.repo.getSnapshot()).transactions.length,s.transactions.length);
  }finally{f.close();}
});
test('Excel and Google Sheets template round-trips quoted Unicode names and two-decimal amounts',async()=>{
  const f=await fixture();try{const snapshot=await f.repo.getSnapshot();snapshot.accounts[0].name='Cash, "Pang-araw-araw"';
    const csv=importTemplateCsv(snapshot,'2026-11-05');assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('\r\n'));
    const review=reviewImport(readCsv(csv),snapshot);assert.deepEqual(review.issues,[]);assert.equal(review.inputs.length,2);assert.equal(review.inputs[1].amountMinor,12550);assert.equal(review.inputs[1].date,'2026-11-05');assert.equal(review.inputs[1].accountId,snapshot.accounts[0].id);
  }finally{f.close();}
});
