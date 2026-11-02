import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Database, SqlConnection, SqlValue } from '../src/core/database';
import type { BackupEnvelope, Transaction } from '../src/core/types';
import { createRepository } from '../src/data/repository';
import { migrate, SCHEMA_MIGRATIONS } from '../src/data/migrations';
import { balance, formatMoney, parseMoney, MAX_MONEY_MINOR } from '../src/core/money';
import { addMonthsClamped, dateRange, inclusiveDays, nextRecurrence, previousRange } from '../src/core/dates';
import { accountBalance, balanceSummary, budgetForMonth, budgetForRange, categoryBreakdown, dailyTrend, goalProgress, performanceLevel, periodSummary, spending, tagBreakdown } from '../src/core/analytics';

const digest = async (value:string) => createHash('sha256').update(value).digest('hex');
const now = () => '2026-01-31T10:00:00.000Z';
const deps = { uuid:randomUUID, deviceId:randomUUID(), now, digest };
function removeFixture(directory: string) {
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('ftracker-core-')) throw new Error('Refusing to remove a path outside the temporary test fixture directory.');
  rmSync(target, { recursive: true, force: true });
}
function adapter(sqlite:DatabaseSync):Database {
  const connection:SqlConnection={
    async exec(sql){sqlite.exec(sql);},
    async run(sql,params:SqlValue[]=[]){const r=sqlite.prepare(sql).run(...params);return{changes:Number(r.changes)};},
    async all<T>(sql:string,params:SqlValue[]=[]){return sqlite.prepare(sql).all(...params) as T[];},
    async first<T>(sql:string,params:SqlValue[]=[]){return sqlite.prepare(sql).get(...params) as T??null;},
  };
  return{...connection,async transaction<T>(work:(tx:SqlConnection)=>Promise<T>){sqlite.exec('BEGIN IMMEDIATE');try{const result=await work(connection);sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
}
async function fixture(path=':memory:') {
  const sqlite=new DatabaseSync(path);const db=adapter(sqlite);await migrate(db);const repo=createRepository(db,deps);
  return {sqlite,db,repo,close:()=>sqlite.close()};
}
async function setup(repo:ReturnType<typeof createRepository>,openingBalanceMinor=100_000){await repo.setup({displayName:'Alex',openingBalanceMinor,monthlyBudgetMinor:50_000});}
function expense(overrides:Partial<Parameters<ReturnType<typeof createRepository>['saveTransaction']>[0]>={}) {return {id:randomUUID(),kind:'expense' as const,title:'Groceries',amountMinor:8_550,date:'2026-01-31',...overrides};}

test('goal images remain portable through edits and backups and invalid images never write partial data',async()=>{
  const source=await fixture(),target=await fixture();try{
    await setup(source.repo);
    const imageUri='data:image/jpeg;base64,YWJjZA==',goal={id:randomUUID(),name:'Travel camera',imageUri,targetMinor:25000,durationMonths:5,startDate:'2026-01-01',paymentDay:15};
    await source.repo.saveGoal(goal);await source.repo.saveGoal({...goal,name:'My travel camera',imageUri:undefined});
    let snapshot=await source.repo.getSnapshot();assert.equal(snapshot.goals[0].imageUri,imageUri);
    assert.equal(JSON.parse(snapshot.auditLogs.find(row=>row.type==='goal_created')!.after!).imageUri,`sha256:${await digest(imageUri)}`);
    assert.ok(snapshot.auditLogs.every(row=>!row.before?.includes(imageUri)&&!row.after?.includes(imageUri)));
    const before=await source.repo.getSnapshot();
    for(const invalid of ['https://example.com/camera.jpg','file:///phone/camera.jpg','data:image/svg+xml;base64,YWJj','data:image/png;base64,invalid','data:image/png;base64,'+'A'.repeat(4_000_100)])await assert.rejects(source.repo.saveGoal({...goal,imageUri:invalid}),/goal image/);
    assert.deepEqual(await source.repo.getSnapshot(),before);
    const backup=await source.repo.createBackup();assert.equal(backup.version,4);await target.repo.restoreBackup(backup);assert.deepEqual((await target.repo.getSnapshot()).goals,backup.data.goals);
    const invalidBackup=structuredClone(backup);invalidBackup.data.goals[0].imageUri='https://example.com/camera.jpg';invalidBackup.checksum=await digest(JSON.stringify({format:invalidBackup.format,version:invalidBackup.version,createdAt:invalidBackup.createdAt,data:invalidBackup.data}));const targetBefore=await target.repo.getSnapshot();await assert.rejects(target.repo.restoreBackup(invalidBackup,true),/goal image/);assert.deepEqual(await target.repo.getSnapshot(),targetBefore);
    await target.repo.saveGoal({...goal,imageUri:null});snapshot=await target.repo.getSnapshot();assert.equal(snapshot.goals[0].imageUri,null);assert.equal(JSON.parse(snapshot.auditLogs.find(row=>row.type==='goal_edited')!.after!).imageUri,null);
  }finally{source.close();target.close();}
});

test('installed schema 5 goals migrate with savings, reminders and immutable history preserved',async()=>{
  const source=await fixture(),sqlite=new DatabaseSync(':memory:'),db=adapter(sqlite);try{
    await setup(source.repo);const goal={id:randomUUID(),name:'Existing camera',targetMinor:25000,durationMonths:5,startDate:'2026-01-01',paymentDay:15};await source.repo.saveGoal(goal);await source.repo.contribute({goalId:goal.id,amountMinor:5000,date:'2026-01-31'});const data=structuredClone((await source.repo.createBackup()).data) as unknown as Record<string,any>;for(const row of data.goals)delete row.imageUri;
    for(const sql of SCHEMA_MIGRATIONS.slice(0,5))await db.exec(sql);await db.exec('PRAGMA user_version = 5');
    const tables:[string,object[]][]=[['profiles',[data.profile]],['accounts',data.accounts],['tags',data.tags],['categories',data.categories],['goals',data.goals],['transactions',data.transactions],['goal_contributions',data.contributions],['budgets',data.budgets],['reminders',data.reminders],['audit_logs',data.auditLogs]];
    for(const [table,records]of tables)for(const row of records){const keys=Object.keys(row);await db.run(`INSERT INTO ${table} (${keys.map(key=>`"${key}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,Object.values(row).map(value=>typeof value==='boolean'?Number(value):Array.isArray(value)?JSON.stringify(value):value) as SqlValue[]);}
    await migrate(db);const repo=createRepository(db,deps),snapshot=await repo.getSnapshot();assert.equal(snapshot.goals[0].imageUri,null);assert.deepEqual(snapshot.goals.map(({imageUri,...row})=>row),data.goals);assert.deepEqual(JSON.parse(JSON.stringify(snapshot.contributions)),data.contributions);assert.equal(snapshot.auditLogs.length,data.auditLogs.length);assert.equal(accountBalance(snapshot,snapshot.accounts[0].id),95000);assert.equal((await db.first<{user_version:number}>('PRAGMA user_version'))?.user_version,6);assert.deepEqual(await db.all('PRAGMA foreign_key_check'),[]);await migrate(db);assert.deepEqual(await repo.getSnapshot(),snapshot);await assert.rejects(db.exec('DELETE FROM audit_logs'),/immutable/);
    const imageUri='data:image/png;base64,YWJj';await repo.saveGoal({...goal,imageUri});assert.equal((await repo.getSnapshot()).goals[0].imageUri,imageUri);
  }finally{source.close();sqlite.close();}
});

test('backup versions 1 to 3 add goal image defaults only after strict original-checksum validation',async()=>{
  const source=await fixture();try{
    await setup(source.repo);const goal={id:randomUUID(),name:'Legacy goal',targetMinor:10000,durationMonths:2,startDate:'2026-01-01',paymentDay:15};await source.repo.saveGoal(goal);
    for(const version of [1,2,3]){
      const target=await fixture();try{
        const old=structuredClone(await source.repo.createBackup()) as unknown as Record<string,any>;old.version=version;for(const row of old.data.goals)delete row.imageUri;
        if(version<3){delete old.data.profile.dailySummaryEnabled;delete old.data.profile.homeShortcuts;for(const row of old.data.transactions)delete row.notePhotos;}
        if(version===1){delete old.data.accounts;delete old.data.tags;for(const key of ['baseCurrency','balanceLabel','avatarUri','tutorialCompleted','transactionSounds','hapticsEnabled','notificationSound'])delete old.data.profile[key];for(const row of old.data.transactions)for(const key of ['accountId','destinationAccountId','destinationAmountMinor','baseAmountMinor','tagIds'])delete row[key];}
        old.checksum=await digest(JSON.stringify({format:old.format,version:old.version,createdAt:old.createdAt,data:old.data}));const original=JSON.stringify(old),corrupt=structuredClone(old);corrupt.data.goals[0].name='Corrupted';await assert.rejects(target.repo.restoreBackup(corrupt),/checksum/);assert.equal((await target.repo.getSnapshot()).profile,null);
        const unsupported=structuredClone(old);unsupported.data.goals[0].unexpected=true;unsupported.checksum=await digest(JSON.stringify({format:unsupported.format,version:unsupported.version,createdAt:unsupported.createdAt,data:unsupported.data}));await assert.rejects(target.repo.restoreBackup(unsupported),/unsupported fields/);
        await target.repo.restoreBackup(old);assert.equal(JSON.stringify(old),original);const snapshot=await target.repo.getSnapshot();assert.equal(snapshot.goals[0].imageUri,null);assert.equal(snapshot.goals[0].name,goal.name);assert.equal(balanceSummary(snapshot).availableMinor,100000);
      }finally{target.close();}
    }
  }finally{source.close();}
});

test('money uses centavos and rejects precision loss, invalid grouping, zero and unsupported values',()=>{
  assert.equal(parseMoney('₱1,234.56'),123456);assert.equal(parseMoney('0.01'),1);assert.equal(parseMoney('0',true),0);assert.equal(parseMoney('999,999,999.99'),MAX_MONEY_MINOR);
  for(const value of ['1.001','NaN','Infinity','-1','0','1e6','1,2','1,0000','₱','1.2.3','1000000000'])assert.throws(()=>parseMoney(value),value);
  assert.match(formatMoney(1845000),/18,450\.00/);assert.throws(()=>formatMoney(1.5));
  assert.equal(formatMoney(Number.MAX_SAFE_INTEGER), '₱90,071,992,547,409.91');
  assert.equal(formatMoney(-Number.MAX_SAFE_INTEGER), '-₱90,071,992,547,409.91');
  assert.equal(formatMoney(1), '₱0.01');
});

test('calendar periods use local date boundaries, leap years and inclusive days',()=>{
  assert.deepEqual(dateRange('today',new Date(2026,0,1,1)),{start:'2026-01-01',end:'2026-01-01'});
  assert.deepEqual(dateRange('yesterday',new Date(2026,0,1,1)),{start:'2025-12-31',end:'2025-12-31'});
  assert.deepEqual(dateRange('lastMonth',new Date(2026,0,31)),{start:'2025-12-01',end:'2025-12-31'});
  assert.deepEqual(dateRange('lastYear',new Date(2026,0,1)),{start:'2025-01-01',end:'2025-12-31'});
  assert.deepEqual(dateRange('week',new Date(2026,0,4)),{start:'2025-12-29',end:'2026-01-04'});
  assert.equal(addMonthsClamped('2024-01-31',1),'2024-02-29');assert.equal(addMonthsClamped('2026-01-31',1),'2026-02-28');
  assert.equal(inclusiveDays('2024-02-28','2024-03-01'),3);assert.deepEqual(previousRange('2026-01-01','2026-01-31'),{start:'2025-12-01',end:'2025-12-31'});
  assert.throws(()=>dateRange('custom',new Date(),'2026-02-30','2026-03-02'));assert.throws(()=>dateRange('custom',new Date(),'2026-02-01','2026-01-01'));
});

test('setup, local income, adjustment, edit, void and audit survive offline database restart',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'ftracker-core-'));const path=join(directory,'finance.sqlite');let f=await fixture(path);
  try{
    await setup(f.repo);const e=expense();await f.repo.saveTransaction(e);await f.repo.saveTransaction({...expense(),kind:'income',amountMinor:20_000,title:'Salary'});await f.repo.saveTransaction({...expense(),kind:'adjustment_debit',amountMinor:1_000,title:'Cash reconciliation'});
    assert.equal(balance((await f.repo.getSnapshot()).transactions),110450);
    await f.repo.saveTransaction({...e,amountMinor:9_000});assert.equal(balance((await f.repo.getSnapshot()).transactions),110000);
    const before=await f.repo.getSnapshot();assert.equal(before.auditLogs.filter(a=>a.type==='expense_edited').length,1);
    f.close();f=await fixture(path);const restored=await f.repo.getSnapshot();assert.equal(balance(restored.transactions),110000);assert.equal(restored.transactions.find(t=>t.id===e.id)?.amountMinor,9000);
    await f.repo.voidTransaction(e.id);await f.repo.voidTransaction(e.id);const after=await f.repo.getSnapshot();assert.equal(balance(after.transactions),119000);assert.equal(after.auditLogs.filter(a=>a.type==='expense_voided').length,1);assert.equal(after.transactions.length,4);
    await assert.rejects(f.repo.saveTransaction({...e,amountMinor:1}),/cannot be edited/);
    assert.equal(after.profile?.displayName,'Alex');assert.equal(after.categories.length,7);
  }finally{f.close();removeFixture(directory);}
});

test('stable mutation IDs prevent duplicate income, expenses and audit events on retry',async()=>{
  const f=await fixture();try{await setup(f.repo);const input=expense();await f.repo.saveTransaction(input);await f.repo.saveTransaction(input);const snapshot=await f.repo.getSnapshot();assert.equal(snapshot.transactions.filter(t=>t.id===input.id).length,1);assert.equal(snapshot.auditLogs.filter(a=>a.recordId===input.id).length,1);}finally{f.close();}
});

test('expense SQL search/date/category filters are parameterized and literal wildcards stay literal',async()=>{
  const f=await fixture();try{await setup(f.repo);const s=await f.repo.getSnapshot();const categoryId=s.categories[0].id;
    const january=expense({title:'Lunch 10% discount',date:'2026-01-31',categoryId});await f.repo.saveTransaction(january);await f.repo.saveTransaction(expense({title:'Lunch',date:'2025-12-31'}));
    assert.equal((await f.repo.queryTransactions({kind:'expense',start:'2026-01-01',end:'2026-01-31',categoryId,search:'lunch'})).length,1);
    assert.equal((await f.repo.queryTransactions({kind:'expense',search:'10%'})).length,1);assert.equal((await f.repo.queryTransactions({search:"'; DELETE FROM transactions; --"})).length,0);
    await f.repo.voidTransaction(january.id!);assert.equal((await f.repo.queryTransactions({search:'10%'})).length,0);assert.equal((await f.repo.queryTransactions({search:'10%',includeVoided:true})).length,1);
  }finally{f.close();}
});

test('financial write and audit are atomic when the audit write fails',async()=>{
  const f=await fixture();try{await setup(f.repo);await f.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'injected disk failure'); END;");const before=await f.repo.getSnapshot();await assert.rejects(f.repo.saveTransaction(expense()),/injected disk failure/);assert.deepEqual(await f.repo.getSnapshot(),before);}finally{f.close();}
});

test('schema migrations preserve data and audit triggers prohibit ordinary update/deletion',async()=>{
  const f=await fixture();try{await setup(f.repo);await f.repo.saveTransaction(expense());const before=await f.repo.getSnapshot();await migrate(f.db);assert.deepEqual(await f.repo.getSnapshot(),before);
    await assert.rejects(f.db.exec("UPDATE audit_logs SET type='tampered'"),/immutable/);await assert.rejects(f.db.exec('DELETE FROM audit_logs'),/immutable/);
    await f.repo.clearAllData();assert.equal((await f.repo.getSnapshot()).profile,null);await setup(f.repo);await assert.rejects(f.db.exec('DELETE FROM audit_logs'),/immutable/);
  }finally{f.close();}
});

test('invalid financial data never changes the local ledger',async()=>{
  const f=await fixture();try{await setup(f.repo);const before=await f.repo.getSnapshot();for(const amountMinor of [0,-1,0.5,Infinity,NaN,MAX_MONEY_MINOR+1])await assert.rejects(f.repo.saveTransaction(expense({amountMinor})));
    await assert.rejects(f.repo.saveTransaction(expense({date:'2026-02-30'})));await assert.rejects(f.repo.saveTransaction(expense({title:'  '})));await assert.rejects(f.repo.saveTransaction(expense({categoryId:randomUUID()})));assert.deepEqual(await f.repo.getSnapshot(),before);
    await assert.rejects(f.repo.saveTransaction(expense({amountMinor:MAX_MONEY_MINOR})),/Confirm/);
    await f.repo.saveTransaction(expense({amountMinor:MAX_MONEY_MINOR,allowOverdraft:true}));assert.equal(balance((await f.repo.getSnapshot()).transactions),100000-MAX_MONEY_MINOR);
  }finally{f.close();}
});

test('goal allocations are atomic, idempotent, excluded from expense totals and reversible',async()=>{
  const f=await fixture();try{await setup(f.repo);const goalId=randomUUID();await f.repo.saveGoal({id:goalId,name:'Speaker',targetMinor:50000,durationMonths:5,startDate:'2026-01-01',paymentDay:31});const c={id:randomUUID(),goalId,amountMinor:20000,date:'2026-01-31'};await f.repo.contribute(c);await f.repo.contribute(c);let s=await f.repo.getSnapshot();assert.equal(balance(s.transactions),80000);assert.equal(spending(s.transactions,'2026-01-01','2026-01-31'),0);assert.equal(s.contributions.length,1);assert.equal(goalProgress(s.goals[0],s.contributions,s.transactions).savedMinor,20000);
    await f.repo.contribute({...c,id:randomUUID(),amountMinor:30000});s=await f.repo.getSnapshot();assert.equal(s.goals[0].status,'completed');assert.equal(s.reminders[0].status,'dismissed');assert.equal(balance(s.transactions),50000);
    const last=s.transactions.find(t=>t.kind==='goal_contribution'&&t.amountMinor===30000)!;await f.repo.voidTransaction(last.id);s=await f.repo.getSnapshot();assert.equal(balance(s.transactions),80000);assert.equal(s.goals[0].status,'active');assert.equal(s.reminders[0].status,'active');assert.equal(goalProgress(s.goals[0],s.contributions,s.transactions).savedMinor,20000);
    await f.repo.setGoalStatus(goalId,'paused');await assert.rejects(f.repo.contribute({...c,id:randomUUID(),amountMinor:1}),/Only active/);
    await f.repo.setGoalStatus(goalId,'active');await assert.rejects(f.repo.setGoalStatus(goalId,'completed'),/Reach the savings target/);await assert.rejects(f.repo.contribute({...c,id:randomUUID(),amountMinor:30001}),/remaining goal/);
    await assert.rejects(f.repo.contribute({...c,notes:'changed payload'}),/identifier has already been used/);
    await assert.rejects(f.repo.saveGoal({id:goalId,name:'Speaker',targetMinor:50000,durationMonths:5,startDate:'2026-02-01',paymentDay:31}),/start date cannot be later/);
  }finally{f.close();}
});

test('goal contributions cannot overdraw spendable funds, and edited goals update reminder schedule',async()=>{
  const f=await fixture();try{await setup(f.repo,1000);const goal={id:randomUUID(),name:'Laptop',targetMinor:100000,durationMonths:10,startDate:'2026-01-01',paymentDay:15};await f.repo.saveGoal(goal);await assert.rejects(f.repo.contribute({goalId:goal.id,amountMinor:1001,date:'2026-01-31'}),/balance is too low/);await f.repo.saveGoal({...goal,name:'Work laptop',paymentDay:20});const s=await f.repo.getSnapshot();assert.equal(s.reminders.length,1);assert.equal(s.reminders[0].title,'Work laptop contribution');assert.equal(new Date(s.reminders[0].dueAt).getDate(),20);assert.equal(new Date(s.reminders[0].dueAt).getMonth(),1);}finally{f.close();}
});

test('transactions allow any valid calendar date and contributions retain goal start boundaries',async()=>{
  const f=await fixture();try{await setup(f.repo);await f.repo.saveTransaction(expense({kind:'income',date:'2026-02-01'}));await f.repo.saveTransaction(expense({date:'2020-02-29'}));
    const goalId=randomUUID();await f.repo.saveGoal({id:goalId,name:'Future trip',targetMinor:50000,durationMonths:5,startDate:'2026-03-01',paymentDay:15});await f.repo.contribute({goalId,amountMinor:1000,date:'2026-03-01'});await assert.rejects(f.repo.contribute({goalId,amountMinor:1000,date:'2026-01-31'}),/goal start date/);
    const snapshot=await f.repo.getSnapshot();assert.equal(balance(snapshot.transactions),99000);assert.equal(new Date(snapshot.reminders[0].dueAt).getMonth(),2);
  }finally{f.close();}
});

test('duplicate goal reminders report a clear error and inactive goal reminders cannot be reactivated by editing',async()=>{
  const f=await fixture();try{await setup(f.repo);const goalId=randomUUID();await f.repo.saveGoal({id:goalId,name:'Camera',targetMinor:50000,durationMonths:5,startDate:'2026-01-01',paymentDay:15});await assert.rejects(f.repo.saveReminder({id:randomUUID(),title:'Duplicate',dueAt:'2026-02-01T09:00:00.000Z',recurrence:'monthly',goalId}),/already has a contribution reminder/);
    await f.repo.setGoalStatus(goalId,'paused');const reminder=(await f.repo.getSnapshot()).reminders[0];await f.repo.saveReminder({id:reminder.id,title:'Paused definition edited',dueAt:new Date(2026,1,15,17,45).toISOString(),recurrence:'monthly',goalId});assert.equal((await f.repo.getSnapshot()).reminders[0].status,'dismissed');await assert.rejects(f.repo.actReminder(reminder.id,'snooze','2026-03-01T10:00:00.000Z'),/Resume the goal/);
    await f.repo.setGoalStatus(goalId,'active');const resumed=(await f.repo.getSnapshot()).reminders[0];assert.equal(new Date(resumed.dueAt).getHours(),17);assert.equal(new Date(resumed.dueAt).getMinutes(),45);
  }finally{f.close();}
});

test('recurring reminders, snooze and completion are saved without network or implicit expense creation',async()=>{
  const f=await fixture();try{await setup(f.repo);const recordId=randomUUID();await f.repo.saveReminder({id:recordId,title:'Electricity',dueAt:'2026-01-15T09:00:00.000Z',recurrence:'monthly'});await f.repo.actReminder(recordId,'complete');let s=await f.repo.getSnapshot();assert.equal(new Date(s.reminders[0].dueAt).getUTCMonth(),1);assert.equal(s.reminders[0].status,'active');assert.equal(s.transactions.length,1);
    await f.repo.actReminder(recordId,'snooze','2026-02-17T12:00:00.000Z');s=await f.repo.getSnapshot();assert.equal(s.reminders[0].dueAt,'2026-02-17T12:00:00.000Z');await f.repo.actReminder(recordId,'dismiss');assert.equal((await f.repo.getSnapshot()).reminders[0].status,'dismissed');
    assert.equal(nextRecurrence('2026-01-31T09:00:00.000Z','monthly','2026-03-01T09:00:00.000Z'),'2026-03-31T09:00:00.000Z');
    assert.equal(nextRecurrence('2026-02-28T09:00:00.000Z','monthly','2026-02-28T09:00:00.000Z',31),'2026-03-31T09:00:00.000Z');
    assert.equal(nextRecurrence('2026-02-02T09:00:00.000Z','monthly','2026-02-03T09:00:00.000Z',31),'2026-02-28T09:00:00.000Z');
  }finally{f.close();}
});

test('local analytics cover category spending, zero budgets, previous periods and large currency amounts',async()=>{
  const f=await fixture();try{await setup(f.repo);let s=await f.repo.getSnapshot();const categoryId=s.categories[0].id;
    await f.repo.saveTransaction(expense({amountMinor:1000,date:'2025-12-31',categoryId}));await f.repo.saveTransaction(expense({amountMinor:3000,categoryId}));await f.repo.saveTransaction(expense({amountMinor:500,categoryId:null}));s=await f.repo.getSnapshot();const summary=periodSummary(s,'2026-01-01','2026-01-31');assert.equal(summary.spentMinor,3500);assert.equal(summary.previousMinor,1000);assert.equal(summary.changePercent,250);assert.equal(summary.count,2);assert.equal(summary.dailyAverageMinor,113);
    assert.equal(categoryBreakdown(s,'2026-01-01','2026-01-31')[0].amountMinor,3000);assert.equal(dailyTrend(s.transactions,'2026-01-01','2026-01-31').at(-1)?.amountMinor,3500);assert.equal(performanceLevel(9999,0).label,'Set a budget');assert.equal(performanceLevel(20000,10000).label,'Sobrang Gastos Na');assert.equal(performanceLevel(1,10000).label,'Sobrang Tipid');
    await f.repo.setBudget(25000,'2026-02');await f.repo.setBudget(25000,'2026-02');const budgets=await f.repo.getSnapshot();assert.equal(budgets.budgets.length,2);assert.equal(budgetForMonth(budgets,'2026-01'),50000);assert.equal(budgetForMonth(budgets,'2026-03'),25000);
  }finally{f.close();}
});

test('performance charts handle the full supported calendar range and its earliest comparison period',async()=>{
  const f=await fixture();try{await setup(f.repo);await f.repo.saveTransaction(expense({date:'1900-01-01',amountMinor:100}));await f.repo.saveTransaction(expense({date:'2200-12-31',amountMinor:200}));const s=await f.repo.getSnapshot();assert.equal(periodSummary(s,'1900-01-01','1900-01-01').previousMinor,0);assert.equal(periodSummary(s,'1900-01-01','2200-12-31').spentMinor,300);const buckets=dailyTrend(s.transactions,'1900-01-01','2200-12-31');assert.ok(buckets.length<=31);assert.equal(buckets.reduce((sum,b)=>sum+b.amountMinor,0),300);}finally{f.close();}
});

test('a full backup restores into a clean installation with balances, goals, reminders and immutable history',async()=>{
  const source=await fixture(),target=await fixture();try{await setup(source.repo);await source.repo.saveTransaction(expense());const goalId=randomUUID();await source.repo.saveGoal({id:goalId,name:'Headphones',targetMinor:50000,durationMonths:5,startDate:'2026-01-01',paymentDay:15});await source.repo.contribute({goalId,amountMinor:10000,date:'2026-01-31'});const backup=await source.repo.createBackup();await target.repo.restoreBackup(backup);const restored=await target.repo.getSnapshot();assert.equal(balance(restored.transactions),balance(backup.data.transactions));assert.deepEqual(restored.contributions,backup.data.contributions);assert.deepEqual(restored.goals,backup.data.goals);assert.deepEqual(restored.reminders,backup.data.reminders);assert.equal(restored.auditLogs.length,backup.data.auditLogs.length+1);await assert.rejects(target.db.exec('DELETE FROM audit_logs'),/immutable/);await assert.rejects(target.repo.restoreBackup(backup),/empty tracker/);
  }finally{source.close();target.close();}
});

test('prorated budgets conserve centavos across month/year boundaries and leap days',async()=>{
  const f=await fixture();try{await setup(f.repo);await f.repo.setBudget(3100,'2025-12');await f.repo.setBudget(3101,'2026-01');let s=await f.repo.getSnapshot();
    assert.equal(budgetForRange(s,'2025-12-31','2026-01-02'),301);assert.equal(budgetForRange(s,'2026-01-01','2026-01-31'),3101);assert.equal(budgetForRange(s,'2026-01-01','2026-01-01')+budgetForRange(s,'2026-01-02','2026-01-31'),3101);
    await f.repo.setBudget(2901,'2024-02');await f.repo.setBudget(3100,'2024-03');s=await f.repo.getSnapshot();assert.equal(budgetForRange(s,'2024-02-28','2024-03-01'),300);assert.equal(budgetForRange(s,'2024-02-01','2024-02-29'),2901);
  }finally{f.close();}
});

test('backup rejects corruption and maliciously recomputed malformed data atomically',async()=>{
  const source=await fixture(),target=await fixture();try{await setup(source.repo);await source.repo.saveTransaction(expense());const original=await source.repo.createBackup();
    const resign=async(value:BackupEnvelope)=>{value.checksum=await digest(JSON.stringify({format:value.format,version:value.version,createdAt:value.createdAt,data:value.data}));return value;};
    const damaged=structuredClone(original);damaged.data.transactions[0].amountMinor=123;await assert.rejects(target.repo.restoreBackup(damaged),/checksum/);
    const invalid=structuredClone(original);invalid.data.transactions[0].amountMinor=-1;await assert.rejects(target.repo.restoreBackup(await resign(invalid)));
    const broken=structuredClone(original);broken.data.transactions[0].categoryId=randomUUID();await assert.rejects(target.repo.restoreBackup(await resign(broken)),/broken transaction references/);
    const extra=structuredClone(original);(extra.data.profile as unknown as Record<string,unknown>).accessToken='never import secrets';await assert.rejects(target.repo.restoreBackup(await resign(extra)),/unsupported fields/);
    const duplicate=structuredClone(original);duplicate.data.transactions.push(duplicate.data.transactions[0]);await assert.rejects(target.repo.restoreBackup(await resign(duplicate)),/duplicate identifiers/);
    assert.equal((await target.repo.getSnapshot()).profile,null);assert.equal((await target.repo.getSnapshot()).transactions.length,0);
  }finally{source.close();target.close();}
});

test('custom categories and tags preserve history when renamed or deleted and tags are searchable',async()=>{
  const f=await fixture();try{await setup(f.repo);const categoryId=randomUUID(),tagId=randomUUID();await f.repo.saveCategory({id:categoryId,name:'Coffee',color:'#007DFE'});await f.repo.saveTag({id:tagId,name:'Office',color:'#3355FF'});await f.repo.saveTransaction(expense({categoryId,tagIds:[tagId]}));
    assert.equal((await f.repo.queryTransactions({tagId,search:'office'})).length,1);
    await f.repo.saveCategory({id:categoryId,name:'Cafés',color:'#007DFE'});await f.repo.saveTag({id:tagId,name:'Work',color:'#3355FF'});let s=await f.repo.getSnapshot();assert.equal(categoryBreakdown(s,'2026-01-01','2026-01-31')[0].name,'Cafés');assert.equal(tagBreakdown(s,'2026-01-01','2026-01-31')[0].name,'Work');
    await f.repo.deleteCategory(categoryId);await f.repo.deleteTag(tagId);s=await f.repo.getSnapshot();assert.ok(s.categories.find(c=>c.id===categoryId)?.deletedAt);assert.equal(s.transactions.find(t=>t.kind==='expense')?.categoryId,categoryId);assert.equal(spending(s.transactions,'2026-01-01','2026-01-31'),8550);await assert.rejects(f.repo.saveTransaction(expense({categoryId})),/existing category/);await f.repo.saveTransaction({...s.transactions.find(t=>t.kind==='expense')!,kind:'expense',notes:'Edited after archive'});assert.equal((await f.repo.getSnapshot()).transactions.find(t=>t.kind==='expense')?.notes,'Edited after archive');
  }finally{f.close();}
});

test('transfers move funds once, preserve spending totals, support foreign currencies and reverse atomically',async()=>{
  const f=await fixture();try{await setup(f.repo);let s=await f.repo.getSnapshot();const cash=s.accounts[0],usd=randomUUID();await f.repo.saveAccount({id:usd,name:'Dollar savings',type:'asset',currency:'USD',exchangeRate:50,includedInBalance:true});const transferId=randomUUID();await f.repo.saveTransaction({id:transferId,kind:'transfer',accountId:cash.id,destinationAccountId:usd,amountMinor:50000,title:'Save dollars',date:'2026-01-31'});
    s=await f.repo.getSnapshot();assert.equal(accountBalance(s,cash.id),50000);assert.equal(accountBalance(s,usd),1000);assert.equal(balanceSummary(s).availableMinor,100000);assert.equal(balance(s.transactions),100000);assert.equal(spending(s.transactions,'2026-01-01','2026-01-31'),0);
    await f.repo.saveTransaction(expense({accountId:usd,amountMinor:100}));s=await f.repo.getSnapshot();assert.equal(spending(s.transactions,'2026-01-01','2026-01-31'),5000);assert.equal(accountBalance(s,usd),900);assert.equal(balanceSummary(s).availableMinor,95000);
    await f.repo.saveAccount({...s.accounts.find(a=>a.id===usd)!,exchangeRate:60,includedInBalance:false});s=await f.repo.getSnapshot();assert.equal(balanceSummary(s).availableMinor,50000);assert.equal(spending(s.transactions,'2026-01-01','2026-01-31'),5000);await f.repo.saveTransaction({...s.transactions.find(t=>t.kind==='expense')!,kind:'expense',notes:'Keep original exchange rate'});s=await f.repo.getSnapshot();assert.equal(spending(s.transactions,'2026-01-01','2026-01-31'),5000);
    await f.repo.voidTransaction(transferId);s=await f.repo.getSnapshot();assert.equal(accountBalance(s,cash.id),100000);assert.equal(accountBalance(s,usd),-100);await assert.rejects(f.repo.deleteAccount(usd),/zero/);
    const sourceBefore=await f.repo.getSnapshot();await assert.rejects(f.repo.saveTransaction({kind:'transfer',accountId:cash.id,destinationAccountId:cash.id,amountMinor:1,title:'Invalid',date:'2026-01-31'}),/different destination/);assert.deepEqual(await f.repo.getSnapshot(),sourceBefore);
  }finally{f.close();}
});

test('liability accounts show debt separately and transfer repayments reduce debt without recording spending',async()=>{
  const f=await fixture();try{await setup(f.repo);const debtId=randomUUID();await f.repo.saveAccount({id:debtId,name:'Credit card',type:'liability',currency:'PHP',exchangeRate:1,includedInBalance:true,openingBalanceMinor:20000});let s=await f.repo.getSnapshot();assert.equal(accountBalance(s,debtId),-20000);assert.deepEqual(balanceSummary(s),{assetsMinor:100000,liabilitiesMinor:20000,availableMinor:80000});await assert.rejects(f.repo.saveTransaction(expense({amountMinor:90000,accountId:s.accounts.find(a=>a.type==='asset')!.id})),/Confirm/);await f.repo.saveTransaction({kind:'transfer',title:'Card payment',amountMinor:5000,date:'2026-01-31',accountId:s.accounts.find(a=>a.type==='asset')!.id,destinationAccountId:debtId});s=await f.repo.getSnapshot();assert.deepEqual(balanceSummary(s),{assetsMinor:95000,liabilitiesMinor:15000,availableMinor:80000});assert.equal(spending(s.transactions,'2026-01-01','2026-01-31'),0);}finally{f.close();}
});

test('bulk imports roll back all rows on invalid data or missing overdraft confirmation',async()=>{
  const f=await fixture();try{await setup(f.repo);const before=await f.repo.getSnapshot();await assert.rejects(f.repo.importTransactions([expense(),expense({date:'2026-02-30'})]),/Row 3/);assert.deepEqual(await f.repo.getSnapshot(),before);await assert.rejects(f.repo.importTransactions([expense({amountMinor:100001})]),/Confirm/);await f.repo.importTransactions([expense({date:'2020-01-01'}),expense({kind:'income',date:'2030-01-01'})]);assert.equal((await f.repo.getSnapshot()).transactions.length,3);}finally{f.close();}
});

test('v1 backups upgrade to a default account and replacement restores validate before deleting data',async()=>{
  const source=await fixture(),target=await fixture();try{await setup(source.repo);await source.repo.saveTransaction(expense());const original=await source.repo.createBackup();const legacy=structuredClone(original) as unknown as Record<string,any>;legacy.version=1;delete legacy.data.accounts;delete legacy.data.tags;for(const key of ['baseCurrency','balanceLabel','avatarUri','tutorialCompleted','transactionSounds','hapticsEnabled','notificationSound','dailySummaryEnabled','homeShortcuts'])delete legacy.data.profile[key];for(const transaction of legacy.data.transactions)for(const key of ['accountId','destinationAccountId','destinationAmountMinor','baseAmountMinor','tagIds','notePhotos'])delete transaction[key];legacy.checksum=await digest(JSON.stringify({format:legacy.format,version:legacy.version,createdAt:legacy.createdAt,data:legacy.data}));await target.repo.restoreBackup(legacy);let s=await target.repo.getSnapshot();assert.equal(s.accounts[0].name,'Cash');assert.equal(accountBalance(s,s.accounts[0].id),91450);
    const before=await target.repo.getSnapshot();const damaged=structuredClone(original);damaged.data.transactions[0].amountMinor=123;await assert.rejects(target.repo.restoreBackup(damaged,true),/checksum/);assert.deepEqual(await target.repo.getSnapshot(),before);
    await target.db.exec("CREATE TRIGGER fail_restore BEFORE INSERT ON profiles BEGIN SELECT RAISE(ABORT,'restore write failed'); END;");await assert.rejects(target.repo.restoreBackup(original,true),/restore write failed/);assert.deepEqual(await target.repo.getSnapshot(),before);await assert.rejects(target.db.exec('DELETE FROM audit_logs'),/immutable/);await target.db.exec('DROP TRIGGER fail_restore');
    await target.repo.restoreBackup(original,true);s=await target.repo.getSnapshot();assert.deepEqual(s.accounts,original.data.accounts);assert.equal(balanceSummary(s).availableMinor,91450);await assert.rejects(target.db.exec('DELETE FROM audit_logs'),/immutable/);
  }finally{source.close();target.close();}
});

test('editing a transaction validates the replacement account balance and never double counts its old amount',async()=>{
  const f=await fixture();try{await setup(f.repo,10000);const cash=(await f.repo.getSnapshot()).accounts[0];const bankId=randomUUID();await f.repo.saveAccount({id:bankId,name:'BDO',type:'asset',currency:'PHP',exchangeRate:1,includedInBalance:true,openingBalanceMinor:1000});const input=expense({amountMinor:8000,accountId:cash.id});await f.repo.saveTransaction(input);await f.repo.saveTransaction({...input,amountMinor:9000});assert.equal(accountBalance(await f.repo.getSnapshot(),cash.id),1000);
    const before=await f.repo.getSnapshot();await assert.rejects(f.repo.saveTransaction({...input,amountMinor:9000,accountId:bankId}),/Confirm/);assert.deepEqual(await f.repo.getSnapshot(),before);await f.repo.saveTransaction({...input,amountMinor:9000,accountId:bankId,allowOverdraft:true});const s=await f.repo.getSnapshot();assert.equal(accountBalance(s,cash.id),10000);assert.equal(accountBalance(s,bankId),-8000);assert.equal(spending(s.transactions,'2026-01-01','2026-01-31'),9000);
  }finally{f.close();}
});

test('profile images accept portable local data and reject remote URLs in preferences and backup restore',async()=>{
  const source=await fixture(),target=await fixture();try{await setup(source.repo);await source.repo.updateProfile({avatarUri:'data:image/jpeg;base64,YWJjZA=='});await source.repo.updateProfile({avatarUri:'file:///var/mobile/profile.jpg'});for(const avatarUri of ['https://example.com/profile.jpg','http://example.com/image.png','file://server/image.jpg','data:image/svg+xml;base64,YWJjZA==','data:image/png;base64,invalid'])await assert.rejects(source.repo.updateProfile({avatarUri}),/local JPEG/);
    const backup=await source.repo.createBackup();backup.data.profile!.avatarUri='https://example.com/tracking-image.jpg';backup.checksum=await digest(JSON.stringify({format:backup.format,version:backup.version,createdAt:backup.createdAt,data:backup.data}));await assert.rejects(target.repo.restoreBackup(backup),/Remote image links/);assert.equal((await target.repo.getSnapshot()).profile,null);
  }finally{source.close();target.close();}
});

test('upgrading the actual v3 database preserves ledger, linked savings and history on the installed app',async()=>{
  const source=await fixture();const legacySqlite=new DatabaseSync(':memory:'),legacyDb=adapter(legacySqlite);
  try{
    await setup(source.repo);await source.repo.saveTransaction(expense());const goalId=randomUUID();await source.repo.saveGoal({id:goalId,name:'Old savings',targetMinor:20000,durationMonths:2,startDate:'2026-01-01',paymentDay:15});await source.repo.contribute({goalId,amountMinor:5000,date:'2026-01-31'});const old=structuredClone((await source.repo.createBackup()).data) as unknown as Record<string,any>;
    for(const sql of SCHEMA_MIGRATIONS.slice(0,3))await legacyDb.exec(sql);await legacyDb.exec('PRAGMA user_version = 3');
    for(const row of old.goals)delete row.imageUri;for(const key of ['baseCurrency','balanceLabel','avatarUri','tutorialCompleted','transactionSounds','hapticsEnabled','notificationSound','dailySummaryEnabled','homeShortcuts'])delete old.profile[key];for(const row of old.transactions)for(const key of ['accountId','destinationAccountId','destinationAmountMinor','baseAmountMinor','tagIds','notePhotos'])delete row[key];
    const tables:[string,object[]][]=[['profiles',[old.profile]],['categories',old.categories],['goals',old.goals],['transactions',old.transactions],['goal_contributions',old.contributions],['budgets',old.budgets],['reminders',old.reminders],['audit_logs',old.auditLogs]];
    for(const [table,records]of tables)for(const row of records){const keys=Object.keys(row);await legacyDb.run(`INSERT INTO ${table} (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,Object.values(row).map(v=>typeof v==='boolean'?Number(v):Array.isArray(v)?JSON.stringify(v):v) as SqlValue[]);}
    await migrate(legacyDb);const repo=createRepository(legacyDb,deps),s=await repo.getSnapshot();assert.equal(s.transactions.length,old.transactions.length);assert.equal(accountBalance(s,s.accounts[0].id),86450);assert.deepEqual(JSON.parse(JSON.stringify(s.contributions)),old.contributions);assert.equal(s.auditLogs.length,old.auditLogs.length);assert.equal((await legacyDb.all('PRAGMA foreign_key_check')).length,0);await migrate(legacyDb);assert.deepEqual(await repo.getSnapshot(),s);await assert.rejects(legacyDb.exec('DELETE FROM audit_logs'),/immutable/);
  }finally{source.close();legacySqlite.close();}
});

test('upgrading installed v1.2 schema preserves every ledger row and adds photo and Home defaults',async()=>{
  const source=await fixture(),sqlite=new DatabaseSync(':memory:'),db=adapter(sqlite);
  try{
    await setup(source.repo);await source.repo.saveTransaction(expense());const data=structuredClone((await source.repo.createBackup()).data) as unknown as Record<string,any>;
    delete data.profile.dailySummaryEnabled;delete data.profile.homeShortcuts;for(const row of data.transactions)delete row.notePhotos;
    for(const sql of SCHEMA_MIGRATIONS.slice(0,4))await db.exec(sql);await db.exec('PRAGMA user_version = 4');
    const tables:[string,object[]][]=[['profiles',[data.profile]],['accounts',data.accounts],['tags',data.tags],['categories',data.categories],['goals',data.goals],['transactions',data.transactions],['goal_contributions',data.contributions],['budgets',data.budgets],['reminders',data.reminders],['audit_logs',data.auditLogs]];
    for(const [table,records]of tables)for(const row of records){const keys=Object.keys(row);await db.run(`INSERT INTO ${table} (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,Object.values(row).map(v=>typeof v==='boolean'?Number(v):Array.isArray(v)?JSON.stringify(v):v) as SqlValue[]);}
    await migrate(db);const repo=createRepository(db,deps),s=await repo.getSnapshot();assert.equal(s.profile?.dailySummaryEnabled,true);assert.deepEqual(s.profile?.homeShortcuts,['chat','month','last7','last30','wallets','notifications','help']);assert.ok(s.transactions.every(t=>t.notePhotos.length===0));assert.equal(s.transactions.length,data.transactions.length);assert.equal(balanceSummary(s).availableMinor,91450);assert.deepEqual(JSON.parse(JSON.stringify(s.auditLogs)).sort((a:any,b:any)=>a.id.localeCompare(b.id)),data.auditLogs.sort((a:any,b:any)=>a.id.localeCompare(b.id)));assert.deepEqual(await db.all('PRAGMA foreign_key_check'),[]);await migrate(db);assert.deepEqual(await repo.getSnapshot(),s);
  }finally{source.close();sqlite.close();}
});

test('v2 backup checksum is checked before defaults are added and the original file object stays untouched',async()=>{
  const source=await fixture(),target=await fixture();try{
    await setup(source.repo);await source.repo.saveTransaction(expense());const old=structuredClone(await source.repo.createBackup()) as unknown as Record<string,any>;old.version=2;delete old.data.profile.homeShortcuts;delete old.data.profile.dailySummaryEnabled;for(const tx of old.data.transactions)delete tx.notePhotos;old.checksum=await digest(JSON.stringify({format:old.format,version:old.version,createdAt:old.createdAt,data:old.data}));const before=JSON.stringify(old);
    const corrupt=structuredClone(old);corrupt.data.profile.displayName='Changed';await assert.rejects(target.repo.restoreBackup(corrupt),/checksum/);assert.equal((await target.repo.getSnapshot()).profile,null);
    await target.repo.restoreBackup(old);assert.equal(JSON.stringify(old),before);const s=await target.repo.getSnapshot();assert.equal(s.profile?.dailySummaryEnabled,true);assert.equal(s.profile?.homeShortcuts[0],'chat');assert.ok(s.transactions.every(t=>t.notePhotos.length===0));assert.equal(balanceSummary(s).availableMinor,91450);
  }finally{source.close();target.close();}
});

test('note photos survive edits and JSON backup without remote links, oversized images or partial writes',async()=>{
  const source=await fixture(),target=await fixture();try{
    await setup(source.repo);const photos=['data:image/jpeg;base64,YWJjZA==','data:image/png;base64,YWJj'];const input=expense({notePhotos:photos});await source.repo.saveTransaction(input);await source.repo.saveTransaction({...input,notePhotos:undefined,notes:'Receipt kept'});let s=await source.repo.getSnapshot();assert.deepEqual(s.transactions.find(t=>t.id===input.id)?.notePhotos,photos);const photoAudit=s.auditLogs.find(a=>a.recordId===input.id)!;assert.deepEqual(JSON.parse(photoAudit.after!).notePhotos,await Promise.all(photos.map(async photo=>`sha256:${await digest(photo)}`)));assert.ok(s.auditLogs.every(a=>!a.before?.includes(photos[0])&&!a.after?.includes(photos[0])));
    const before=await source.repo.getSnapshot();for(const notePhotos of [['https://example.com/receipt.jpg'],['file:///phone/receipt.jpg'],['data:image/svg+xml;base64,YWJj'],['data:image/png;base64,invalid'],[...photos,...photos],['data:image/jpeg;base64,'+'A'.repeat(8_000_000)],Array(3).fill('data:image/png;base64,'+'A'.repeat(4_100_000))])await assert.rejects(source.repo.saveTransaction({...input,notePhotos}));assert.deepEqual(await source.repo.getSnapshot(),before);
    const backup=await source.repo.createBackup();assert.equal(backup.version,4);await target.repo.restoreBackup(backup);assert.deepEqual((await target.repo.getSnapshot()).transactions.find(t=>t.id===input.id)?.notePhotos,photos);
    const damaged=structuredClone(backup);damaged.data.transactions[0].notePhotos=['https://example.com/receipt.jpg'];damaged.checksum=await digest(JSON.stringify({format:damaged.format,version:damaged.version,createdAt:damaged.createdAt,data:damaged.data}));const targetBefore=await target.repo.getSnapshot();await assert.rejects(target.repo.restoreBackup(damaged,true),/local JPEG/);assert.deepEqual(await target.repo.getSnapshot(),targetBefore);
    await source.repo.saveTransaction({...input,notePhotos:[]});s=await source.repo.getSnapshot();assert.deepEqual(s.transactions.find(t=>t.id===input.id)?.notePhotos,[]);
  }finally{source.close();target.close();}
});

test('custom Home shortcuts and daily summaries persist, reject unsupported values and round trip in backups',async()=>{
  const source=await fixture(),target=await fixture();try{
    await setup(source.repo);await source.repo.updateProfile({homeShortcuts:['help','transactions','last7'],dailySummaryEnabled:false});const before=await source.repo.getSnapshot();assert.deepEqual(before.profile?.homeShortcuts,['help','transactions','last7']);for(const patch of [{homeShortcuts:['chat','chat']},{homeShortcuts:['unknown']},{dailySummaryEnabled:'yes'}])await assert.rejects(source.repo.updateProfile(patch as any));assert.deepEqual(await source.repo.getSnapshot(),before);await target.repo.restoreBackup(await source.repo.createBackup());const restored=await target.repo.getSnapshot();assert.deepEqual(restored.profile?.homeShortcuts,['help','transactions','last7']);assert.equal(restored.profile?.dailySummaryEnabled,false);
  }finally{source.close();target.close();}
});

test('removing a funded wallet or liability excludes its balance and preserves all original history',async()=>{
  const f=await fixture();try{
    await setup(f.repo);const bank=randomUUID(),debt=randomUUID();await f.repo.saveAccount({id:bank,name:'BDO',type:'asset',currency:'PHP',exchangeRate:1,includedInBalance:true,openingBalanceMinor:5000});await f.repo.saveTransaction(expense({accountId:bank,amountMinor:1200}));await f.repo.saveAccount({id:debt,name:'Card',type:'liability',currency:'PHP',exchangeRate:1,includedInBalance:true,openingBalanceMinor:2000});const before=await f.repo.getSnapshot();assert.equal(balanceSummary(before).availableMinor,101800);
    await f.repo.deleteAccount(bank,{mode:'exclude'});await f.repo.deleteAccount(debt,{mode:'exclude'});const s=await f.repo.getSnapshot();assert.equal(balanceSummary(s).availableMinor,100000);assert.equal(accountBalance(s,bank),3800);assert.equal(accountBalance(s,debt),-2000);assert.deepEqual(s.transactions,before.transactions);assert.ok(s.accounts.find(a=>a.id===bank)?.deletedAt);assert.equal(s.accounts.find(a=>a.id===debt)?.includedInBalance,false);const cash=s.accounts.find(a=>!a.deletedAt)!.id;await assert.rejects(f.repo.deleteAccount(cash,{mode:'exclude'}),/at least one asset/);assert.deepEqual(await f.repo.queryTransactions({accountId:bank}),before.transactions.filter(t=>t.accountId===bank));
  }finally{f.close();}
});

test('transfer-and-remove moves the entire foreign wallet using manual rates in one atomic ledger operation',async()=>{
  const f=await fixture();try{
    await setup(f.repo);const cash=(await f.repo.getSnapshot()).accounts[0],usd=randomUUID();await f.repo.saveAccount({id:usd,name:'Dollars',type:'asset',currency:'USD',exchangeRate:56.25,includedInBalance:true,openingBalanceMinor:1001});const before=await f.repo.getSnapshot();assert.equal(balanceSummary(before).availableMinor,156306);
    await f.db.exec(`CREATE TRIGGER fail_archive BEFORE UPDATE ON accounts WHEN NEW.id='${usd}' AND NEW.deletedAt IS NOT NULL BEGIN SELECT RAISE(ABORT,'archive failed'); END;`);await assert.rejects(f.repo.deleteAccount(usd,{mode:'transfer',destinationAccountId:cash.id}),/archive failed/);assert.deepEqual(await f.repo.getSnapshot(),before);await f.db.exec('DROP TRIGGER fail_archive');
    const transferId=await f.repo.deleteAccount(usd,{mode:'transfer',destinationAccountId:cash.id});const s=await f.repo.getSnapshot();assert.equal(accountBalance(s,usd),0);assert.equal(accountBalance(s,cash.id),156306);assert.equal(balanceSummary(s).availableMinor,156306);assert.ok(s.accounts.find(a=>a.id===usd)?.deletedAt);const transfer=s.transactions.find(t=>t.id===transferId)!;assert.equal(transfer.kind,'transfer');assert.equal(transfer.amountMinor,1001);assert.equal(transfer.destinationAmountMinor,56306);assert.equal(spending(s.transactions,'2026-01-01','2026-01-31'),0);assert.equal(s.transactions.length,before.transactions.length+1);assert.equal((await f.db.all('PRAGMA foreign_key_check')).length,0);
  }finally{f.close();}
});

test('transfer-and-remove rejects debt, empty wallets, self destinations and unavailable destinations without changes',async()=>{
  const f=await fixture();try{
    await setup(f.repo);const cash=(await f.repo.getSnapshot()).accounts[0].id,bank=randomUUID(),debt=randomUUID();await f.repo.saveAccount({id:bank,name:'Empty bank',type:'asset',currency:'PHP',exchangeRate:1,includedInBalance:true});await f.repo.saveAccount({id:debt,name:'Debt',type:'liability',currency:'PHP',exchangeRate:1,includedInBalance:true,openingBalanceMinor:1000});const before=await f.repo.getSnapshot();for(const [source,destination]of [[bank,cash],[debt,cash],[cash,cash],[cash,debt],[cash,randomUUID()]])await assert.rejects(f.repo.deleteAccount(source,{mode:'transfer',destinationAccountId:destination}));assert.deepEqual(await f.repo.getSnapshot(),before);
  }finally{f.close();}
});

test('complete persists a one-time reminder and advances a future recurring occurrence with an audit record',async()=>{
  const f=await fixture();try{
    await setup(f.repo);const once=randomUUID(),recurring=randomUUID();await f.repo.saveReminder({id:once,title:'One-time bill',dueAt:'2026-02-15T09:00:00.000Z',recurrence:'none'});await f.repo.saveReminder({id:recurring,title:'Monthly bill',dueAt:'2026-02-15T09:00:00.000Z',recurrence:'monthly'});await f.repo.actReminder(once,'complete');await f.repo.actReminder(recurring,'complete');const s=await f.repo.getSnapshot();assert.equal(s.reminders.find(r=>r.id===once)?.status,'completed');assert.equal(s.reminders.find(r=>r.id===recurring)?.dueAt,'2026-03-15T09:00:00.000Z');assert.equal(s.reminders.find(r=>r.id===recurring)?.status,'active');assert.equal(s.auditLogs.filter(a=>a.type==='reminder_complete').length,2);assert.equal(s.transactions.length,1);
  }finally{f.close();}
});

test('goal completion requires recorded savings and contribution returns the actual transaction for navigation',async()=>{
  const f=await fixture();try{
    await setup(f.repo);const goalId=randomUUID();await f.repo.saveGoal({id:goalId,name:'Trip',targetMinor:5000,durationMonths:1,startDate:'2026-01-01',paymentDay:15});const before=await f.repo.getSnapshot();await assert.rejects(f.repo.setGoalStatus(goalId,'completed'),/Reach the savings target/);assert.deepEqual(await f.repo.getSnapshot(),before);const input={id:randomUUID(),goalId,amountMinor:5000,date:'2026-01-31',notePhotos:['data:image/png;base64,YWJj']},transactionId=await f.repo.contribute(input);assert.equal(await f.repo.contribute(input),transactionId);assert.equal(await f.repo.contribute({...input,notePhotos:undefined}),transactionId);await assert.rejects(f.repo.contribute({...input,notePhotos:[]}),/identifier has already/);const s=await f.repo.getSnapshot();assert.equal(s.goals[0].status,'completed');assert.equal(s.reminders[0].status,'dismissed');assert.equal(s.transactions.find(t=>t.id===transactionId)?.kind,'goal_contribution');assert.deepEqual(s.transactions.find(t=>t.id===transactionId)?.notePhotos,input.notePhotos);assert.equal(s.contributions.length,1);assert.equal(goalProgress(s.goals[0],s.contributions,s.transactions).savedMinor,5000);assert.equal(s.auditLogs.filter(a=>a.type==='goal_completed').length,1);const contributionAudit=s.auditLogs.find(a=>a.type==='goal_contribution')!;assert.ok(!contributionAudit.after!.includes(input.notePhotos[0]));assert.match(JSON.parse(contributionAudit.after!).transaction.notePhotos[0],/^sha256:[0-9a-f]{64}$/);
  }finally{f.close();}
});

test('goal contributions use active included balances after a debt wallet is removed',async()=>{
  const f=await fixture();try{
    await setup(f.repo);const debt=randomUUID(),goalId=randomUUID();await f.repo.saveAccount({id:debt,name:'Old debt',type:'liability',currency:'PHP',exchangeRate:1,includedInBalance:true,openingBalanceMinor:200000});await f.repo.saveGoal({id:goalId,name:'Emergency savings',targetMinor:10000,durationMonths:2,startDate:'2026-01-01',paymentDay:15});const contribution={id:randomUUID(),goalId,amountMinor:5000,date:'2026-01-31'};await assert.rejects(f.repo.contribute(contribution),/spendable balance is too low/);await f.repo.deleteAccount(debt,{mode:'exclude'});await f.repo.contribute(contribution);const s=await f.repo.getSnapshot();assert.equal(goalProgress(s.goals[0],s.contributions,s.transactions).savedMinor,5000);assert.equal(balanceSummary(s).availableMinor,95000);assert.equal(accountBalance(s,debt),-200000);
  }finally{f.close();}
});

test('archived funds cannot finance savings while a hidden active wallet uses only its own real balance',async()=>{
  const f=await fixture();try{
    await setup(f.repo,1000);const cash=(await f.repo.getSnapshot()).accounts[0].id,bank=randomUUID(),hidden=randomUUID(),goalId=randomUUID();await f.repo.saveAccount({id:bank,name:'Old bank',type:'asset',currency:'PHP',exchangeRate:1,includedInBalance:true,openingBalanceMinor:9000});await f.repo.deleteAccount(bank,{mode:'exclude'});await f.repo.saveGoal({id:goalId,name:'Savings',targetMinor:10000,durationMonths:2,startDate:'2026-01-01',paymentDay:15});const before=await f.repo.getSnapshot();await assert.rejects(f.repo.contribute({goalId,amountMinor:5000,date:'2026-01-31',accountId:cash}),/account balance is too low/);await assert.rejects(f.repo.contribute({goalId,amountMinor:5000,date:'2026-01-31',accountId:bank}),/Choose an asset account/);assert.deepEqual(await f.repo.getSnapshot(),before);
    await f.repo.saveAccount({id:hidden,name:'Hidden savings',type:'asset',currency:'PHP',exchangeRate:1,includedInBalance:false,openingBalanceMinor:5000});await f.repo.contribute({goalId,amountMinor:4000,date:'2026-01-31',accountId:hidden});const s=await f.repo.getSnapshot();assert.equal(accountBalance(s,hidden),1000);assert.equal(balanceSummary(s).availableMinor,1000);assert.equal(goalProgress(s.goals[0],s.contributions,s.transactions).savedMinor,4000);assert.equal(accountBalance(s,bank),9000);
  }finally{f.close();}
});
