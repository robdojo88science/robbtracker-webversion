import type { Database, RepositoryDependencies, SqlConnection, SqlValue } from '../core/database';
import type { Account, AuditLog, BackupEnvelope, Budget, Category, FinanceRepository, Goal, GoalContribution, Profile, RecordMeta, Reminder, Snapshot, Tag, Transaction, TransactionInput } from '../core/types';
import { assertMoney, balance, safeAdd, convertMinor, isCurrencyCode } from '../core/money';
import { assertDate, assertTimestamp, localDate, monthKey, nextRecurrence } from '../core/dates';
import { DEFAULT_THRESHOLDS, goalProgress, accountBalance, balanceSummary } from '../core/analytics';
import { AUDIT_TRIGGERS } from './migrations';

const TABLES = { profiles: ['displayName','currency','appearance','hideBalance','autoLockSeconds','notificationsEnabled','performanceThresholds','baseCurrency','balanceLabel','avatarUri','tutorialCompleted','transactionSounds','hapticsEnabled','notificationSound','dailySummaryEnabled','homeShortcuts'], categories: ['name','icon','color'], accounts: ['name','type','currency','exchangeRate','includedInBalance','icon','color'], tags: ['name','color'], budgets: ['month','amountMinor'], goals: ['name','targetMinor','durationMonths','startDate','paymentDay','status','imageUri'], transactions: ['kind','amountMinor','title','date','categoryId','notes','goalId','voidedAt','accountId','destinationAccountId','destinationAmountMinor','baseAmountMinor','tagIds','notePhotos'], goal_contributions: ['goalId','transactionId','amountMinor','date'], reminders: ['title','dueAt','recurrence','monthlyDay','goalId','status'] } as const;

export const DEFAULT_HOME_SHORTCUTS = ['chat','month','last7','last30','wallets','notifications','help'];
const HOME_SHORTCUTS = new Set([...DEFAULT_HOME_SHORTCUTS,'transactions','performance','goals','audit','import']);
type Table = keyof typeof TABLES;
const META_KEYS = ['id','ownerId','deviceId','createdAt','updatedAt','deletedAt','syncStatus','serverVersion'];
const AUDIT_KEYS = ['id','type','group','recordId','timestamp','before','after','deviceId'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEED_CATEGORIES = [ ['Food & groceries','basket','#0B7A5A'], ['Transport','car','#4F7CAC'], ['Bills & utilities','flash','#D49B36'], ['Shopping','bag','#9A6A98'], ['Health','heart','#C66D73'], ['Entertainment','play','#7D81BC'], ['Other','ellipsis-horizontal','#789187'] ];
const encode = (value: unknown): SqlValue => typeof value === 'boolean' ? Number(value) : Array.isArray(value) ? JSON.stringify(value) : value as SqlValue;
function decode<T>(table: Table, row: Record<string, unknown>): T {
  if (table === 'profiles') { row.hideBalance = !!row.hideBalance; row.notificationsEnabled = !!row.notificationsEnabled; row.performanceThresholds = JSON.parse(row.performanceThresholds as string); }
  if(table==='profiles'){for(const key of ['tutorialCompleted','transactionSounds','hapticsEnabled','dailySummaryEnabled'])row[key]=!!row[key];row.homeShortcuts=JSON.parse(row.homeShortcuts as string);}
  if(table==='accounts')row.includedInBalance=!!row.includedInBalance;
  if(table==='transactions'){row.tagIds=JSON.parse(row.tagIds as string);row.notePhotos=JSON.parse(row.notePhotos as string);}
  return row as T;
}
async function rows<T>(db: SqlConnection, table: Table): Promise<T[]> { return (await db.all<Record<string, unknown>>(`SELECT * FROM ${table}`)).map(row => decode<T>(table, row)); }
async function find<T>(db: SqlConnection, table: Table, id: string): Promise<T | null> {
  const row = await db.first<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, [id]); return row ? decode<T>(table,row) : null;
}
async function insert(db: SqlConnection, table: Table | 'audit_logs', record: object): Promise<void> {
  const keys = table === 'audit_logs' ? AUDIT_KEYS : [...META_KEYS,...TABLES[table]];
  const data = record as Record<string,unknown>;
  await db.run(`INSERT INTO ${table} (${keys.map(k=>`\"${k}\"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`, keys.map(k=>encode(data[k])));
}
async function update(db: SqlConnection, table: Table, record: RecordMeta): Promise<void> {
  const keys = [...META_KEYS,...TABLES[table]].filter(k=>k!=='id'); const data=record as unknown as Record<string,unknown>;
  await db.run(`UPDATE ${table} SET ${keys.map(k=>`\"${k}\" = ?`).join(',')} WHERE id = ?`, [...keys.map(k=>encode(data[k])),record.id]);
}
function text(value: unknown, label: string, max = 120, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max) throw new Error(`${label} must ${empty ? '' : 'not be blank and '}be at most ${max} characters.`);
  return value.trim();
}
function id(value: string): void { if (!UUID.test(value)) throw new Error('Invalid record identifier.'); }
function same(a: object, b: object, keys: readonly string[]): boolean { return keys.every(k=>JSON.stringify((a as Record<string,unknown>)[k])===JSON.stringify((b as Record<string,unknown>)[k])); }
function thresholds(value: unknown): asserts value is number[] { if (!Array.isArray(value) || value.length !== 5 || value.some((n,i)=>typeof n!=='number'||!Number.isFinite(n)||n<=0||n>10||(i>0&&n<=value[i-1]))) throw new Error('Set five increasing spending thresholds between 1% and 1000%.'); }
function assertMonth(value: string): void { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('Choose a valid budget month.'); assertDate(`${value}-01`); }
function currency(value:string):void{if(!isCurrencyCode(value))throw new Error('Use a currency code with 3–8 uppercase letters or digits, starting with a letter.');}
function color(value:string):void{if(!/^#[0-9a-f]{6}$/i.test(value))throw new Error('Choose a valid color.');}
function profileAvatar(value:unknown):void{
  if(value===null)return;text(value,'Profile image',8_000_000);
  if(typeof value==='string'&&/^file:\/\/\/[^\r\n]+$/.test(value))return;
  const data=typeof value==='string'?value.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/):null;
  if(!data||data[1].length%4!==0)throw new Error('Choose a local JPEG, PNG or WebP profile image. Remote image links are not supported.');
}

function goalImage(value:unknown):void{
  if(value===null)return;
  if(typeof value!=='string'||value.length>4_000_100)throw new Error('Choose a compressed goal image under 3 MB.');
  const data=value.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!data||data[1].length%4!==0)throw new Error('Choose a local JPEG, PNG or WebP goal image.');
}

function homeShortcuts(value:unknown):asserts value is string[]{
  if(!Array.isArray(value)||value.length>HOME_SHORTCUTS.size||new Set(value).size!==value.length||value.some(key=>typeof key!=='string'||!HOME_SHORTCUTS.has(key)))throw new Error('Choose each available Home shortcut at most once.');
}
function notePhotos(value:unknown):asserts value is string[]{
  if(!Array.isArray(value)||value.length>3)throw new Error('Add up to 3 note photos.');
  let total=0;
  for(const photo of value){
    if(typeof photo!=='string'||photo.length>8_000_000)throw new Error('Each note photo must be a compressed local image under 8 MB.');
    const data=photo.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if(!data||data[1].length%4!==0)throw new Error('Choose a local JPEG, PNG or WebP note photo.');
    total+=photo.length;
  }
  if(total>12_000_000)throw new Error('Note photos together must be under 12 MB.');
}

export function createRepository(db: Database, deps: RepositoryDependencies): FinanceRepository {
  const meta = (recordId = deps.uuid()): RecordMeta => { id(recordId); const now=deps.now(); return {id:recordId,ownerId:null,deviceId:deps.deviceId,createdAt:now,updatedAt:now,deletedAt:null,syncStatus:'synced',serverVersion:0}; };
  const touch = <T extends RecordMeta>(record: T): T => ({...record,updatedAt:deps.now(),deviceId:deps.deviceId,serverVersion:record.serverVersion+1});
  const postedDate = assertDate;
  async function auditJson(value:unknown):Promise<string|null>{
    if(value==null)return null;
    const serialized=JSON.stringify(value);
    if(!serialized.includes('"notePhotos":')&&!serialized.includes('"imageUri":'))return serialized;
    // Keep photos portable in the ledger, while audit entries retain only change fingerprints.
    const copy=JSON.parse(serialized) as unknown;
    const redact=async(node:unknown):Promise<void>=>{
      if(!node||typeof node!=='object')return;
      for(const [key,entry]of Object.entries(node)){
        if(key==='notePhotos'&&Array.isArray(entry)) (node as Record<string,unknown>)[key]=await Promise.all(entry.map(async photo=>typeof photo==='string'&&photo.startsWith('data:image/')?`sha256:${await deps.digest(photo)}`:photo));
        else if(key==='imageUri'&&typeof entry==='string'&&entry.startsWith('data:image/')) (node as Record<string,unknown>)[key]=`sha256:${await deps.digest(entry)}`;
        else await redact(entry);
      }
    };
    await redact(copy);return JSON.stringify(copy);
  }
  async function audit(tx: SqlConnection, type: string, group: AuditLog['group'], recordId: string, before: unknown, after: unknown): Promise<void> {
    const [beforeJson,afterJson]=await Promise.all([auditJson(before),auditJson(after)]);
    await insert(tx,'audit_logs',{id:deps.uuid(),type,group,recordId,timestamp:deps.now(),before:beforeJson,after:afterJson,deviceId:deps.deviceId});
  }
  async function requireProfile(tx: SqlConnection): Promise<Profile> { const profile=(await rows<Profile>(tx,'profiles'))[0]; if (!profile) throw new Error('Create or restore your tracker first.'); return profile; }
  async function snapshot(tx: SqlConnection): Promise<Snapshot> {
    // Sequential reads keep a single transaction/connection portable across native and tests.
    const profile=(await rows<Profile>(tx,'profiles'))[0]??null;
    const transactions=await rows<Transaction>(tx,'transactions'); transactions.sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
    const categories=await rows<Category>(tx,'categories'), budgets=await rows<Budget>(tx,'budgets'), goals=await rows<Goal>(tx,'goals'), contributions=await rows<GoalContribution>(tx,'goal_contributions'), reminders=await rows<Reminder>(tx,'reminders');
    const auditLogs=await tx.all<AuditLog>('SELECT * FROM audit_logs ORDER BY timestamp DESC, rowid DESC');
    const accounts=await rows<Account>(tx,'accounts'),tags=await rows<Tag>(tx,'tags');
    return {profile,transactions,categories,budgets,goals,contributions,reminders,auditLogs,accounts,tags};
  }
  async function ledgerAmounts(tx: SqlConnection): Promise<Transaction[]> {
    // Balance checks never need descriptions or image payloads. Keep those off the native bridge.
    const columns=[...META_KEYS,...TABLES.transactions].map(key=>['notePhotos','tagIds'].includes(key)?`'[]' AS "${key}"`:['notes','title'].includes(key)?`'' AS "${key}"`:`"${key}"`).join(',');
    return (await tx.all<Record<string, unknown>>(`SELECT ${columns} FROM transactions`)).map(row=>decode<Transaction>('transactions',row));
  }
  async function financialState(tx: SqlConnection): Promise<Pick<Snapshot,'accounts'|'transactions'>> {
    return { accounts: await rows<Account>(tx,'accounts'), transactions: await ledgerAmounts(tx) };
  }
  function validateLedger(ledger: Transaction[]): void { balance(ledger);ledger.filter(t=>!t.voidedAt&&!t.deletedAt).reduce((sum,t)=>safeAdd(sum,t.amountMinor),0); }
  async function checkLedger(tx: SqlConnection): Promise<void> { validateLedger(await ledgerAmounts(tx)); }
  async function clearRecords(tx:SqlConnection):Promise<void>{
    await tx.exec('DROP TRIGGER IF EXISTS audit_no_delete;');
    for(const table of ['sync_queue','goal_contributions','reminders','transactions','goals','categories','tags','accounts','budgets','profiles','audit_logs'])await tx.exec(`DELETE FROM ${table}`);
    await tx.exec("DELETE FROM sync_metadata; INSERT INTO sync_metadata(key,value) VALUES('cloud_enabled','false');");await tx.exec(AUDIT_TRIGGERS);
  }
  async function goalReminder(tx: SqlConnection, goal: Goal): Promise<void> {
    const old=(await rows<Reminder>(tx,'reminders')).find(r=>r.goalId===goal.id);
    const progress=goalProgress(goal,await rows<GoalContribution>(tx,'goal_contributions'),await ledgerAmounts(tx),new Date(deps.now()));
    const [year,month,day]=progress.nextDate.split('-').map(Number);
    const preferredTime=old?new Date(old.dueAt):null;
    const dueAt=new Date(year,month-1,day,preferredTime?.getHours()??9,preferredTime?.getMinutes()??0).toISOString();
    const fields={title:`${goal.name} contribution`,dueAt,recurrence:'monthly' as const,monthlyDay:goal.paymentDay,goalId:goal.id,status:goal.status==='active'?'active' as const:'dismissed' as const};
    if (old) { const next={...touch(old),...fields}; if (!same(old,next,TABLES.reminders)) {await update(tx,'reminders',next);await audit(tx,'reminder_updated','system',next.id,old,next);} }
    else { const next:Reminder={...meta(),...fields};await insert(tx,'reminders',next);await audit(tx,'reminder_created','system',next.id,null,next); }
  }
  async function writeTransaction(tx:SqlConnection,input:TransactionInput):Promise<void>{
    assertMoney(input.amountMinor);postedDate(input.date);const title=text(input.title,'Description'),notes=text(input.notes??'','Notes',2000,true);
    if(!['income','expense','adjustment_credit','adjustment_debit','transfer'].includes(input.kind))throw new Error('Choose a valid transaction type.');
    if(input.id)id(input.id);await requireProfile(tx);
    const old=input.id?await find<Transaction>(tx,'transactions',input.id):null;
    if(old&&(old.voidedAt||old.deletedAt||old.kind==='goal_contribution'))throw new Error('This transaction cannot be edited.');
    const photos=input.notePhotos===undefined?old?.notePhotos??[]:input.notePhotos;notePhotos(photos);
    const accounts=await rows<Account>(tx,'accounts');const accountId=input.accountId??old?.accountId??accounts.find(a=>!a.deletedAt&&a.type==='asset')?.id;
    const account=accounts.find(a=>a.id===accountId&&(!a.deletedAt||a.id===old?.accountId));if(!account)throw new Error('Choose an existing account.');
    if(account.deletedAt&&(input.amountMinor!==old?.amountMinor||input.kind!==old?.kind||(input.destinationAccountId??null)!==old?.destinationAccountId||(input.destinationAmountMinor??null)!==old?.destinationAmountMinor))throw new Error('Choose an active account before changing the amount or transaction type.');
    const categoryId=input.kind==='expense'?(input.categoryId??null):null;
    if(categoryId){const category=await find<Category>(tx,'categories',categoryId);if(!category||(category.deletedAt&&categoryId!==old?.categoryId))throw new Error('Choose an existing category.');}
    const tagIds=[...new Set(input.tagIds??old?.tagIds??[])].sort();if(tagIds.length>20)throw new Error('Choose up to 20 tags.');
    for(const tagId of tagIds){id(tagId);const tag=await find<Tag>(tx,'tags',tagId);if(!tag||(tag.deletedAt&&!old?.tagIds.includes(tagId)))throw new Error('Choose an existing tag.');}
    let destinationAccountId:string|null=null,destinationAmountMinor:number|null=null;
    if(input.kind==='transfer'){
      destinationAccountId=input.destinationAccountId??null;const destination=accounts.find(a=>a.id===destinationAccountId&&(!a.deletedAt||a.id===old?.destinationAccountId));
      if(!destination||destination.id===account.id)throw new Error('Choose a different destination account.');
      const sourceRate=BigInt(Math.round(account.exchangeRate*1_000_000)),targetRate=BigInt(Math.round(destination.exchangeRate*1_000_000));
      destinationAmountMinor=input.destinationAmountMinor??(old?.accountId===account.id&&old?.destinationAccountId===destination.id&&old?.amountMinor===input.amountMinor?old.destinationAmountMinor:null)??(account.currency===destination.currency?input.amountMinor:Number((BigInt(input.amountMinor)*sourceRate+targetRate/2n)/targetRate));
      assertMoney(destinationAmountMinor);
      if(destination.deletedAt&&(input.amountMinor!==old?.amountMinor||input.kind!==old?.kind||account.id!==old?.accountId||destinationAmountMinor!==old?.destinationAmountMinor))throw new Error('Choose an active destination before changing this transfer.');
    }
    const baseAmountMinor=old?.accountId===account.id&&old.amountMinor===input.amountMinor?old.baseAmountMinor:convertMinor(input.amountMinor,account.exchangeRate);
    if(baseAmountMinor<1)throw new Error('The converted amount must be at least 0.01 in the main currency.');
    const next:Transaction={...(old?touch(old):meta(input.id)),kind:input.kind,amountMinor:input.amountMinor,title,date:input.date,categoryId,notes,notePhotos:[...photos],goalId:null,voidedAt:null,accountId:account.id,destinationAccountId,destinationAmountMinor,baseAmountMinor,tagIds};
    if(old&&same(old,next,TABLES.transactions))return;
    const existing={accounts,transactions:(await ledgerAmounts(tx)).filter(t=>t.id!==old?.id)};
    const exceedsAccount=account.type==='asset'&&['expense','adjustment_debit','transfer'].includes(input.kind)&&input.amountMinor>accountBalance(existing,account.id);
    const exceedsMain=input.kind==='expense'&&account.includedInBalance&&baseAmountMinor>balanceSummary(existing).availableMinor;
    if((exceedsAccount||exceedsMain)&&input.allowOverdraft!==true)throw new Error('This amount is greater than your available balance. Confirm the expense or transfer to continue.');
    if(old)await update(tx,'transactions',next);else await insert(tx,'transactions',next);
    validateLedger([...existing.transactions,next]);
    const group=next.kind==='transfer'?'system':next.kind==='expense'?'expense':'income';
    const activity=next.kind.startsWith('adjustment')?'balance_adjusted':`${next.kind}_${old?'edited':'added'}`;
    await audit(tx,activity,group,next.id,old,next);
  }

  const repository: FinanceRepository = {
    getSnapshot: () => db.transaction(snapshot),
    async hasRecord(collection, recordId) {
      id(recordId);
      if (!['transactions','accounts','categories','tags','goals','reminders'].includes(collection)) throw new Error('Unknown record collection.');
      return !!await db.first<{ id: string }>(`SELECT id FROM ${collection} WHERE id = ?`, [recordId]);
    },
    async queryTransactions(query) {
      if(query.start)assertDate(query.start);if(query.end)assertDate(query.end);if(query.start&&query.end&&query.start>query.end)throw new Error('Start date must be on or before end date.');
      const conditions=['deletedAt IS NULL'];const params:SqlValue[]=[];
      if(!query.includeVoided)conditions.push('voidedAt IS NULL');
      if(query.start){conditions.push('date >= ?');params.push(query.start);}if(query.end){conditions.push('date <= ?');params.push(query.end);}
      if(query.categoryId){id(query.categoryId);conditions.push('categoryId = ?');params.push(query.categoryId);}
      if(query.kind){if(!['income','expense','adjustment_credit','adjustment_debit','goal_contribution','transfer'].includes(query.kind))throw new Error('Invalid transaction type.');conditions.push('kind = ?');params.push(query.kind);}
      if(query.accountId){id(query.accountId);conditions.push('(accountId = ? OR destinationAccountId = ?)');params.push(query.accountId,query.accountId);}
      if(query.tagId){id(query.tagId);conditions.push('EXISTS (SELECT 1 FROM json_each(transactions.tagIds) WHERE value = ?)');params.push(query.tagId);}
      if(query.search?.trim()){const needle=text(query.search,'Search',200).replace(/[\\%_]/g,'\\$&');conditions.push("(title LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM tags JOIN json_each(transactions.tagIds) ON tags.id=value WHERE tags.name LIKE ? ESCAPE '\\'))");params.push(`%${needle}%`,`%${needle}%`,`%${needle}%`);}
      return (await db.all<Record<string,unknown>>(`SELECT * FROM transactions WHERE ${conditions.join(' AND ')} ORDER BY date DESC, createdAt DESC`,params)).map(r=>decode<Transaction>('transactions',r));
    },
    async setup(input) {
      const displayName=text(input.displayName,'Name',60);assertMoney(input.openingBalanceMinor,true);assertMoney(input.monthlyBudgetMinor,true);
      await db.transaction(async tx=> {
        if ((await rows<Profile>(tx,'profiles')).length) throw new Error('A tracker already exists on this device.');
        const baseCurrency=input.currency??'PHP';currency(baseCurrency);
        const profile:Profile={...meta(),displayName,currency:'PHP',appearance:'system',hideBalance:false,autoLockSeconds:0,notificationsEnabled:false,dailySummaryEnabled:true,homeShortcuts:[...DEFAULT_HOME_SHORTCUTS],performanceThresholds:[...DEFAULT_THRESHOLDS],baseCurrency,balanceLabel:text(input.balanceLabel??'My available balance','Balance name',60),avatarUri:null,tutorialCompleted:false,transactionSounds:true,hapticsEnabled:true,notificationSound:'default'};
        await insert(tx,'profiles',profile);
        const account:Account={...meta(),name:text(input.accountName??'Cash','Account name',60),type:'asset',currency:baseCurrency,exchangeRate:1,includedInBalance:true,icon:'wallet',color:'#007DFE'};await insert(tx,'accounts',account);
        for (const [name,icon,color] of SEED_CATEGORIES) await insert(tx,'categories',{...meta(),name,icon,color});
        await insert(tx,'budgets',{...meta(),month:monthKey(new Date(deps.now())),amountMinor:input.monthlyBudgetMinor});
        await audit(tx,'tracker_created','system',profile.id,null,{displayName,currency:baseCurrency});
        if (input.openingBalanceMinor>0) { const opening:Transaction={...meta(),kind:'adjustment_credit',amountMinor:input.openingBalanceMinor,title:'Opening balance',date:localDate(new Date(deps.now())),categoryId:null,notes:'Balance recorded during local setup.',notePhotos:[],goalId:null,voidedAt:null,accountId:account.id,destinationAccountId:null,destinationAmountMinor:null,baseAmountMinor:input.openingBalanceMinor,tagIds:[]};await insert(tx,'transactions',opening);await audit(tx,'balance_added','income',opening.id,null,opening); }
      });
    },
    async saveTransaction(input) {
      await db.transaction(tx=>writeTransaction(tx,input));
    },
    async importTransactions(inputs,newTags=[]){
      if(!Array.isArray(inputs)||inputs.length<1||inputs.length>5000)throw new Error('Import between 1 and 5,000 transactions at a time.');
      const ids=new Set<string>();for(const input of inputs)if(input.id){if(ids.has(input.id))throw new Error('The import contains duplicate transaction identifiers.');ids.add(input.id);}
      if(!Array.isArray(newTags)||newTags.length>400)throw new Error('Use up to 400 new tags in a batch.');
      await db.transaction(async tx=>{
        await requireProfile(tx);
        const remap=new Map<string,string>();
        if(newTags.length){
          const all=await rows<Tag>(tx,'tags');
          for(const proposed of newTags){
            id(proposed.id??'');const name=text(proposed.name,'Tag name',40),tint=proposed.color??'#007DFE';color(tint);
            const byId=all.find(tag=>tag.id===proposed.id);
            if(byId&&(byId.deletedAt||byId.name.toLowerCase()!==name.toLowerCase()))throw new Error('A proposed tag conflicts with an existing tag.');
            const existing=byId??all.find(tag=>!tag.deletedAt&&tag.name.toLowerCase()===name.toLowerCase());
            if(existing){remap.set(proposed.id!,existing.id);continue;}
            const tag:Tag={...meta(proposed.id),name,color:tint};await insert(tx,'tags',tag);await audit(tx,'tag_added','system',tag.id,null,tag);all.push(tag);
          }
        }
        for(let i=0;i<inputs.length;i++){
          const input=inputs[i],tagIds=input.tagIds?.map(tagId=>remap.get(tagId)??tagId);
          try{await writeTransaction(tx,{...input,tagIds});}catch(error){throw new Error(`Row ${i+2}: ${error instanceof Error?error.message:'Invalid transaction.'}`);}
        }
      });
    },
    async saveCategory(input){
      const name=text(input.name,'Category name',60),icon=text(input.icon??'pricetag','Icon',60),tint=input.color??'#007DFE';color(tint);if(input.id)id(input.id);
      await db.transaction(async tx=>{await requireProfile(tx);const all=await rows<Category>(tx,'categories');const old=all.find(c=>c.id===input.id);if(old?.deletedAt)throw new Error('This category was deleted.');if(all.some(c=>!c.deletedAt&&c.id!==input.id&&c.name.toLowerCase()===name.toLowerCase()))throw new Error('A category with this name already exists.');const next:Category={...(old?touch(old):meta(input.id)),name,icon,color:tint};if(old&&same(old,next,TABLES.categories))return;if(old)await update(tx,'categories',next);else await insert(tx,'categories',next);await audit(tx,old?'category_renamed':'category_added','system',next.id,old,next);});
    },
    async deleteCategory(recordId){id(recordId);await db.transaction(async tx=>{await requireProfile(tx);const old=await find<Category>(tx,'categories',recordId);if(!old||old.deletedAt)return;const next={...touch(old),deletedAt:deps.now()};await update(tx,'categories',next);await audit(tx,'category_deleted','system',recordId,old,next);});},
    async saveTag(input){
      const name=text(input.name,'Tag name',40),tint=input.color??'#7C3AED';color(tint);if(input.id)id(input.id);
      await db.transaction(async tx=>{await requireProfile(tx);const all=await rows<Tag>(tx,'tags');const old=all.find(t=>t.id===input.id);if(old?.deletedAt)throw new Error('This tag was deleted.');if(all.some(t=>!t.deletedAt&&t.id!==input.id&&t.name.toLowerCase()===name.toLowerCase()))throw new Error('A tag with this name already exists.');const next:Tag={...(old?touch(old):meta(input.id)),name,color:tint};if(old&&same(old,next,TABLES.tags))return;if(old)await update(tx,'tags',next);else await insert(tx,'tags',next);await audit(tx,old?'tag_renamed':'tag_added','system',next.id,old,next);});
    },
    async deleteTag(recordId){id(recordId);await db.transaction(async tx=>{await requireProfile(tx);const old=await find<Tag>(tx,'tags',recordId);if(!old||old.deletedAt)return;const next={...touch(old),deletedAt:deps.now()};await update(tx,'tags',next);await audit(tx,'tag_deleted','system',recordId,old,next);});},
    async saveAccount(input){
      const name=text(input.name,'Account name',60),icon=text(input.icon??'wallet','Icon',60),tint=input.color??'#007DFE';color(tint);currency(input.currency);convertMinor(100,input.exchangeRate);if(input.id)id(input.id);if(!['asset','liability'].includes(input.type)||typeof input.includedInBalance!=='boolean')throw new Error('Choose a valid account type and balance inclusion.');if(input.openingBalanceMinor!==undefined)assertMoney(input.openingBalanceMinor,true);
      await db.transaction(async tx=>{const profile=await requireProfile(tx);const all=await rows<Account>(tx,'accounts');const old=all.find(a=>a.id===input.id);if(old?.deletedAt)throw new Error('This account was deleted.');if(all.some(a=>!a.deletedAt&&a.id!==input.id&&a.name.toLowerCase()===name.toLowerCase()))throw new Error('An account with this name already exists.');if(input.currency===profile.baseCurrency&&input.exchangeRate!==1)throw new Error('The main currency must use an exchange rate of 1.');if(old&&old.currency!==input.currency&&await tx.first('SELECT id FROM transactions WHERE accountId = ? OR destinationAccountId = ? LIMIT 1',[old.id,old.id]))throw new Error('Create a new account to use a different currency. Existing transactions keep their original currency.');
        const next:Account={...(old?touch(old):meta(input.id)),name,type:input.type,currency:input.currency,exchangeRate:input.exchangeRate,includedInBalance:input.includedInBalance,icon,color:tint};if(old&&same(old,next,TABLES.accounts))return;if(old)await update(tx,'accounts',next);else await insert(tx,'accounts',next);await audit(tx,old?'account_updated':'account_added','system',next.id,old,next);
        if(!old&&input.openingBalanceMinor)await writeTransaction(tx,{kind:input.type==='liability'?'adjustment_debit':'adjustment_credit',amountMinor:input.openingBalanceMinor,date:localDate(new Date(deps.now())),title:`Opening balance · ${name}`,accountId:next.id,allowOverdraft:true});
      });
    },
    async deleteAccount(recordId,options){
      id(recordId);
      if(options&&!['exclude','transfer'].includes(options.mode))throw new Error('Choose whether to transfer this balance or remove it from your total.');
      return db.transaction(async tx=>{
        await requireProfile(tx);const current=await financialState(tx);const old=current.accounts.find(a=>a.id===recordId);if(!old||old.deletedAt)return;
        if(current.accounts.filter(a=>!a.deletedAt&&a.type==='asset').length<=1&&old.type==='asset')throw new Error('Keep at least one asset account.');
        const remaining=accountBalance(current,recordId);let transferId:string|undefined;
        if(options?.mode==='transfer'){
          if(old.type!=='asset'||remaining<=0)throw new Error('Only a wallet with a positive asset balance can transfer everything. Choose remove from total for debt or an empty wallet.');
          if(!options.destinationAccountId)throw new Error('Choose a wallet to receive the balance.');id(options.destinationAccountId);
          const destination=current.accounts.find(a=>a.id===options.destinationAccountId&&!a.deletedAt&&a.type==='asset');
          if(!destination||destination.id===old.id)throw new Error('Choose a different active asset wallet to receive the balance.');
          transferId=deps.uuid();
          await writeTransaction(tx,{id:transferId,kind:'transfer',amountMinor:remaining,title:`Transfer from ${old.name}`,date:localDate(new Date(deps.now())),accountId:old.id,destinationAccountId:destination.id,allowOverdraft:true});
        }else if(!options&&remaining!==0)throw new Error('Transfer or reconcile this account to zero before deleting it.');
        const next={...touch(old),deletedAt:deps.now(),includedInBalance:false};await update(tx,'accounts',next);await audit(tx,'account_deleted','system',recordId,old,next);
        return transferId;
      });
    },
    async voidTransaction(recordId) {
      id(recordId);
      await db.transaction(async tx=> {
        await requireProfile(tx);const old=await find<Transaction>(tx,'transactions',recordId);if(!old)throw new Error('Transaction not found.');if(old.voidedAt)return;
        const next={...touch(old),voidedAt:deps.now()};await update(tx,'transactions',next);
        if(old.kind==='goal_contribution') {
          const contribution=(await rows<GoalContribution>(tx,'goal_contributions')).find(c=>c.transactionId===old.id);
          if(!contribution)throw new Error('Contribution record is missing.');await update(tx,'goal_contributions',{...touch(contribution),deletedAt:deps.now()});
          const goal=await find<Goal>(tx,'goals',contribution.goalId);
          if(goal&&goal.status==='completed'){ const reopened={...touch(goal),status:'active' as const};await update(tx,'goals',reopened);await audit(tx,'goal_reopened','goal',goal.id,goal,reopened);await goalReminder(tx,reopened); }
        }
        await audit(tx,`${old.kind}_voided`,old.kind==='expense'?'expense':old.kind==='goal_contribution'?'goal':'income',old.id,old,next);
      });
    },
    async setBudget(amountMinor,month) {
      assertMoney(amountMinor,true);assertMonth(month);
      await db.transaction(async tx=>{await requireProfile(tx);const old=(await rows<Budget>(tx,'budgets')).find(b=>b.month===month);if(old?.amountMinor===amountMinor)return;const next:Budget={...(old?touch(old):meta()),month,amountMinor};if(old)await update(tx,'budgets',next);else await insert(tx,'budgets',next);await audit(tx,'budget_updated','system',next.id,old,next);});
    },
    async saveGoal(input) {
      const name=text(input.name,'Goal name');assertMoney(input.targetMinor);assertDate(input.startDate);if(input.id)id(input.id);
      if(!Number.isInteger(input.durationMonths)||input.durationMonths<1||input.durationMonths>600)throw new Error('Choose a duration from 1 to 600 months.');
      if(!Number.isInteger(input.paymentDay)||input.paymentDay<1||input.paymentDay>31)throw new Error('Choose a payment day from 1 to 31.');
      await db.transaction(async tx=>{await requireProfile(tx);const old=input.id?await find<Goal>(tx,'goals',input.id):null;if(old?.status==='archived')throw new Error('Archived goals cannot be edited.');
        const imageUri=input.imageUri===undefined?old?.imageUri??null:input.imageUri;goalImage(imageUri);
        const next:Goal={...(old?touch(old):meta(input.id)),name,imageUri,targetMinor:input.targetMinor,durationMonths:input.durationMonths,startDate:input.startDate,paymentDay:input.paymentDay,status:old?.status??'active'};
        if(old&&(await rows<GoalContribution>(tx,'goal_contributions')).some(c=>c.goalId===old.id&&!c.deletedAt&&c.date<input.startDate))throw new Error('The goal start date cannot be later than its recorded contributions.');
        if(old?.status==='completed'&&goalProgress(next,await rows<GoalContribution>(tx,'goal_contributions'),await ledgerAmounts(tx)).remainingMinor>0)next.status='active';
        if(old&&same(old,next,TABLES.goals))return;
        if(old)await update(tx,'goals',next);else await insert(tx,'goals',next);await audit(tx,old?'goal_edited':'goal_created','goal',next.id,old,next);await goalReminder(tx,next);
      });
    },
    async setGoalStatus(recordId,status) {
      id(recordId);if(!['active','paused','completed','archived'].includes(status))throw new Error('Invalid goal status.');
      await db.transaction(async tx=>{await requireProfile(tx);const old=await find<Goal>(tx,'goals',recordId);if(!old)throw new Error('Goal not found.');if(old.status===status)return;
        if(status==='completed'&&goalProgress(old,await rows<GoalContribution>(tx,'goal_contributions'),await ledgerAmounts(tx)).remainingMinor>0)throw new Error('Reach the savings target before completing this goal.');
        const next={...touch(old),status};await update(tx,'goals',next);await audit(tx,`goal_${status}`,'goal',recordId,old,next);await goalReminder(tx,next);
      });
    },
    async contribute(input) {
      assertMoney(input.amountMinor);postedDate(input.date);id(input.goalId);if(input.id)id(input.id);const notes=text(input.notes??'','Notes',2000,true);
      const photos=input.notePhotos===undefined?[]:input.notePhotos;notePhotos(photos);
      return db.transaction(async tx=>{const profile=await requireProfile(tx);
        if(input.id){const prior=await find<GoalContribution>(tx,'goal_contributions',input.id);if(prior){const priorTransaction=await find<Transaction>(tx,'transactions',prior.transactionId);if(prior.goalId===input.goalId&&prior.amountMinor===input.amountMinor&&prior.date===input.date&&!prior.deletedAt&&priorTransaction?.notes===notes&&(input.notePhotos===undefined||JSON.stringify(priorTransaction.notePhotos)===JSON.stringify(photos)))return prior.transactionId;throw new Error('This contribution identifier has already been used.');}}
        const goal=await find<Goal>(tx,'goals',input.goalId);if(!goal||goal.status!=='active')throw new Error('Only active goals can receive contributions.');
        if(input.date<goal.startDate)throw new Error('Contribution date must be on or after the goal start date.');
        const ledger=await ledgerAmounts(tx);
        const saved=goalProgress(goal,await rows<GoalContribution>(tx,'goal_contributions'),ledger);
        if(input.amountMinor>saved.remainingMinor)throw new Error('Contribution cannot exceed the remaining goal target.');
        const current={accounts:await rows<Account>(tx,'accounts'),transactions:ledger};const account=current.accounts.find(a=>a.id===(input.accountId??current.accounts.find(a=>!a.deletedAt&&a.type==='asset'&&a.currency===profile.baseCurrency)?.id)&&!a.deletedAt);
        if(!account||account.type!=='asset'||account.currency!==profile.baseCurrency)throw new Error('Choose an asset account in your main currency for savings contributions.');
        if(input.amountMinor>accountBalance(current,account.id))throw new Error('This account balance is too low for this contribution.');
        if(account.includedInBalance&&input.amountMinor>balanceSummary(current).availableMinor)throw new Error('Your spendable balance is too low for this contribution.');
        const transaction:Transaction={...meta(),kind:'goal_contribution',amountMinor:input.amountMinor,title:`Savings · ${goal.name}`,date:input.date,categoryId:null,notes,notePhotos:[...photos],goalId:goal.id,voidedAt:null,accountId:account.id,destinationAccountId:null,destinationAmountMinor:null,baseAmountMinor:input.amountMinor,tagIds:[]};
        const contribution:GoalContribution={...meta(input.id),goalId:goal.id,transactionId:transaction.id,amountMinor:input.amountMinor,date:input.date};
        await insert(tx,'transactions',transaction);await insert(tx,'goal_contributions',contribution);await audit(tx,'goal_contribution','goal',contribution.id,null,{contribution,transaction});
        validateLedger([...ledger,transaction]);
        if(input.amountMinor===saved.remainingMinor){const completed={...touch(goal),status:'completed' as const};await update(tx,'goals',completed);await audit(tx,'goal_completed','goal',goal.id,goal,completed);await goalReminder(tx,completed);}
        return transaction.id;
      });
    },
    async saveReminder(input) {
      const title=text(input.title,'Reminder');assertTimestamp(input.dueAt);if(input.id)id(input.id);if(!['none','daily','weekly','monthly'].includes(input.recurrence))throw new Error('Choose a valid recurrence.');
      await db.transaction(async tx=>{await requireProfile(tx);const old=input.id?await find<Reminder>(tx,'reminders',input.id):null;const goalId=input.goalId??null;
        const goal=goalId?await find<Goal>(tx,'goals',goalId):null;
        if(goalId&&(!goal||goal.deletedAt))throw new Error('Goal not found.');
        if(goalId&&(await rows<Reminder>(tx,'reminders')).some(r=>r.goalId===goalId&&r.id!==old?.id))throw new Error('This goal already has a contribution reminder. Edit its existing reminder in Reminders.');
        const next:Reminder={...(old?touch(old):meta(input.id)),title,dueAt:new Date(input.dueAt).toISOString(),recurrence:input.recurrence,monthlyDay:input.recurrence==='monthly'?new Date(input.dueAt).getDate():null,goalId,status:goal&&goal.status!=='active'?'dismissed':'active'};
        if(old&&same(old,next,TABLES.reminders))return;if(old)await update(tx,'reminders',next);else await insert(tx,'reminders',next);await audit(tx,old?'reminder_updated':'reminder_created','system',next.id,old,next);
      });
    },
    async actReminder(recordId,action,snoozeUntil) {
      id(recordId);if(!['complete','dismiss','snooze'].includes(action))throw new Error('Unknown reminder action.');
      if(action==='snooze'){if(!snoozeUntil)throw new Error('Choose a snooze time.');assertTimestamp(snoozeUntil);if(Date.parse(snoozeUntil)<=Date.parse(deps.now()))throw new Error('Snooze time must be in the future.');}
      await db.transaction(async tx=>{await requireProfile(tx);const old=await find<Reminder>(tx,'reminders',recordId);if(!old)throw new Error('Reminder not found.');
        if(old.goalId&&action!=='dismiss'){const goal=await find<Goal>(tx,'goals',old.goalId);if(!goal||goal.status!=='active')throw new Error('Resume the goal before changing its reminder.');}
        let next=touch(old);
        if(action==='snooze')next={...next,dueAt:new Date(snoozeUntil!).toISOString(),status:'active'};
        else if(action==='complete'&&old.recurrence!=='none')next={...next,dueAt:nextRecurrence(old.dueAt,old.recurrence,deps.now(),old.monthlyDay),status:'active'};
        else next={...next,status:action==='complete'?'completed':'dismissed'};
        if(same(old,next,TABLES.reminders))return;await update(tx,'reminders',next);await audit(tx,`reminder_${action}`,'system',recordId,old,next);
      });
    },
    async updateProfile(patch) {
      const allowed=TABLES.profiles.filter(k=>k!=='currency');if(Object.keys(patch).some(k=>!allowed.includes(k as never)))throw new Error('Unsupported profile setting.');
      if(patch.displayName!==undefined)text(patch.displayName,'Name',60);
      if(patch.appearance!==undefined&&!['system','light','dark'].includes(patch.appearance))throw new Error('Choose a valid appearance.');
      if(patch.autoLockSeconds!==undefined&&![0,30,60,300].includes(patch.autoLockSeconds))throw new Error('Choose a valid auto-lock duration.');
      if(patch.hideBalance!==undefined&&typeof patch.hideBalance!=='boolean')throw new Error('Invalid balance privacy setting.');
      if(patch.notificationsEnabled!==undefined&&typeof patch.notificationsEnabled!=='boolean')throw new Error('Invalid notification setting.');
      if(patch.dailySummaryEnabled!==undefined&&typeof patch.dailySummaryEnabled!=='boolean')throw new Error('Invalid daily summary setting.');
      if(patch.homeShortcuts!==undefined)homeShortcuts(patch.homeShortcuts);
      if(patch.performanceThresholds!==undefined)thresholds(patch.performanceThresholds);
      if(patch.baseCurrency!==undefined)currency(patch.baseCurrency);
      if(patch.balanceLabel!==undefined)text(patch.balanceLabel,'Balance name',60);
      if(patch.avatarUri!==undefined)profileAvatar(patch.avatarUri);
      for(const key of ['tutorialCompleted','transactionSounds','hapticsEnabled'] as const)if(patch[key]!==undefined&&typeof patch[key]!=='boolean')throw new Error('Invalid preference.');
      if(patch.notificationSound!==undefined&&!['default','chime.wav','pop.wav','none'].includes(patch.notificationSound))throw new Error('Choose an available notification sound.');
      await db.transaction(async tx=>{const old=await requireProfile(tx);if(patch.baseCurrency&&patch.baseCurrency!==old.baseCurrency)throw new Error('Your main currency is set during setup. Keep it unchanged so budgets and historical charts remain accurate; add foreign currency accounts instead.');const next={...touch(old),...patch,displayName:patch.displayName?.trim()??old.displayName,balanceLabel:patch.balanceLabel?.trim()??old.balanceLabel};if(same(old,next,TABLES.profiles))return;await update(tx,'profiles',next);await audit(tx,'settings_updated','system',old.id,old,next);});
    },
    async logSystem(type,before,after) {text(type,'Activity type',120);await db.transaction(async tx=>{const profile=await requireProfile(tx);await audit(tx,type,'system',profile.id,before,after);});},
    async createBackup() {
      const data=await db.transaction(snapshot);if(!data.profile)throw new Error('Create your tracker before backing it up.');
      const createdAt=deps.now();const checksum=await deps.digest(JSON.stringify({format:'ftracker-backup',version:4,createdAt,data}));return {format:'ftracker-backup',version:4,createdAt,data,checksum};
    },
    async restoreBackup(backup,replaceExisting=false) {
      const envelope=await validateBackup(backup,deps.digest);
      await db.transaction(async tx=>{if((await rows<Profile>(tx,'profiles')).length){if(!replaceExisting)throw new Error('Restore requires an empty tracker. Back up existing data, then confirm replacing it before restoring.');await clearRecords(tx);}
        const data=envelope.data;
        await insert(tx,'profiles',data.profile!);
        for(const record of data.accounts)await insert(tx,'accounts',record);
        for(const record of data.tags)await insert(tx,'tags',record);
        for(const record of data.categories)await insert(tx,'categories',record);
        for(const record of data.budgets)await insert(tx,'budgets',record);
        for(const record of data.goals)await insert(tx,'goals',record);
        for(const record of data.transactions)await insert(tx,'transactions',record);
        for(const record of data.contributions)await insert(tx,'goal_contributions',record);
        for(const record of data.reminders)await insert(tx,'reminders',record);
        for(const record of data.auditLogs)await insert(tx,'audit_logs',record);
        await checkLedger(tx);await audit(tx,'backup_restored','system',data.profile!.id,null,{backupCreatedAt:envelope.createdAt,transactions:data.transactions.length});
      });
    },
    async clearAllData() {
      await db.transaction(clearRecords);
    },
  };
  return repository;
}

/** Strict restore boundary: a checksum catches corruption, not maliciously authored files. */
export async function validateBackup(input: unknown, digest: (text:string)=>Promise<string>): Promise<BackupEnvelope> {
  const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid backup object.');return value as Record<string,unknown>;};
  const exact=(row:Record<string,unknown>,keys:readonly string[])=>{if(Object.keys(row).length!==keys.length||keys.some(k=>!Object.hasOwn(row,k)))throw new Error('Backup contains missing or unsupported fields.');};
  const envelope=object(input);exact(envelope,['format','version','createdAt','data','checksum']);
  if(envelope.format!=='ftracker-backup'||![1,2,3,4].includes(envelope.version as number)||typeof envelope.checksum!=='string'||!/^[a-f0-9]{64}$/i.test(envelope.checksum))throw new Error('Unsupported or invalid Robb Tracker backup.');
  assertTimestamp(envelope.createdAt as string);
  const payload={format:envelope.format,version:envelope.version,createdAt:envelope.createdAt,data:envelope.data};
  if(await digest(JSON.stringify(payload))!==envelope.checksum)throw new Error('Backup checksum failed. The file may be incomplete or damaged.');
  const data=object(JSON.parse(JSON.stringify(envelope.data)));
  if(envelope.version===1){
    exact(data,['profile','transactions','categories','budgets','goals','contributions','reminders','auditLogs']);
    const profile=object(data.profile);exact(profile,[...META_KEYS,'displayName','currency','appearance','hideBalance','autoLockSeconds','notificationsEnabled','performanceThresholds']);
    const defaultAccount={...Object.fromEntries(META_KEYS.map(key=>[key,profile[key]])),name:'Cash',type:'asset',currency:'PHP',exchangeRate:1,includedInBalance:true,icon:'wallet',color:'#007DFE',deletedAt:null};
    Object.assign(profile,{baseCurrency:'PHP',balanceLabel:'My available balance',avatarUri:null,tutorialCompleted:false,transactionSounds:true,hapticsEnabled:true,notificationSound:'default'});
    if(!Array.isArray(data.transactions))throw new Error('Invalid backup transactions.');
    for(const entry of data.transactions){const row=object(entry);exact(row,[...META_KEYS,'kind','amountMinor','title','date','categoryId','notes','goalId','voidedAt']);Object.assign(row,{accountId:profile.id,destinationAccountId:null,destinationAmountMinor:null,baseAmountMinor:row.amountMinor,tagIds:[]});}
    data.accounts=[defaultAccount];data.tags=[];
  }
  exact(data,['profile','transactions','categories','budgets','goals','contributions','reminders','auditLogs','accounts','tags']);
  if(envelope.version===1||envelope.version===2){
    const profile=object(data.profile);exact(profile,[...META_KEYS,...TABLES.profiles.filter(key=>key!=='homeShortcuts'&&key!=='dailySummaryEnabled')]);
    Object.assign(profile,{dailySummaryEnabled:true,homeShortcuts:[...DEFAULT_HOME_SHORTCUTS]});
    if(!Array.isArray(data.transactions))throw new Error('Invalid backup transactions.');
    for(const entry of data.transactions){const row=object(entry);exact(row,[...META_KEYS,...TABLES.transactions.filter(key=>key!=='notePhotos')]);row.notePhotos=[];}
  }
  if(envelope.version!==4){
    if(!Array.isArray(data.goals))throw new Error('Invalid backup goals.');
    for(const entry of data.goals){const row=object(entry);exact(row,[...META_KEYS,...TABLES.goals.filter(key=>key!=='imageUri')]);row.imageUri=null;}
  }
  const mappings:[string,Table| 'audit_logs'][]=[['accounts','accounts'],['tags','tags'],['transactions','transactions'],['categories','categories'],['budgets','budgets'],['goals','goals'],['contributions','goal_contributions'],['reminders','reminders'],['auditLogs','audit_logs']];
  const allIds=new Map<string,Set<string>>();
  const validateRecord=(table:Table|'audit_logs',value:unknown)=> {
    const row=object(value);exact(row,table==='audit_logs'?AUDIT_KEYS:[...META_KEYS,...TABLES[table]]);id(row.id as string);
    const ids=allIds.get(table)??new Set<string>();if(ids.has(row.id as string))throw new Error('Backup contains duplicate identifiers.');ids.add(row.id as string);allIds.set(table,ids);
    text(row.deviceId,'Device identifier',120);
    if(table==='audit_logs') { text(row.type,'Activity type',120);if(!['income','expense','goal','system'].includes(row.group as string))throw new Error('Invalid audit group.');id(row.recordId as string);assertTimestamp(row.timestamp as string);for(const key of ['before','after'])if(row[key]!==null){if(typeof row[key]!=='string')throw new Error('Invalid audit data.');try{JSON.parse(row[key] as string);}catch{throw new Error('Invalid audit data.');}}return; }
    if(row.ownerId!==null)id(row.ownerId as string);assertTimestamp(row.createdAt as string);assertTimestamp(row.updatedAt as string);if(row.deletedAt!==null)assertTimestamp(row.deletedAt as string);
    if(!['synced','pending_create','pending_update','pending_delete','sync_error'].includes(row.syncStatus as string)||!Number.isSafeInteger(row.serverVersion)||(row.serverVersion as number)<0)throw new Error('Invalid sync metadata.');
    if(table==='profiles'){text(row.displayName,'Name',60);if(row.currency!=='PHP'||!['system','light','dark'].includes(row.appearance as string)||typeof row.hideBalance!=='boolean'||typeof row.notificationsEnabled!=='boolean'||typeof row.dailySummaryEnabled!=='boolean'||![0,30,60,300].includes(row.autoLockSeconds as number))throw new Error('Invalid profile settings.');thresholds(row.performanceThresholds);homeShortcuts(row.homeShortcuts);currency(row.baseCurrency as string);text(row.balanceLabel,'Balance name',60);profileAvatar(row.avatarUri);if(['tutorialCompleted','transactionSounds','hapticsEnabled'].some(k=>typeof row[k]!=='boolean')||!['default','chime.wav','pop.wav','none'].includes(row.notificationSound as string))throw new Error('Invalid profile preferences.');}
    if(table==='categories'){text(row.name,'Category');text(row.icon,'Category icon',60);if(typeof row.color!=='string'||!/^#[0-9a-f]{6}$/i.test(row.color))throw new Error('Invalid category color.');}
    if(table==='accounts'){text(row.name,'Account name',60);currency(row.currency as string);convertMinor(100,row.exchangeRate as number);text(row.icon,'Icon',60);color(row.color as string);if(!['asset','liability'].includes(row.type as string)||typeof row.includedInBalance!=='boolean')throw new Error('Invalid account settings.');}
    if(table==='tags'){text(row.name,'Tag name',40);color(row.color as string);}
    if(table==='budgets'){assertMonth(row.month as string);assertMoney(row.amountMinor as number,true);}
    if(table==='goals'){text(row.name,'Goal name');goalImage(row.imageUri);assertMoney(row.targetMinor as number);assertDate(row.startDate as string);if(!Number.isInteger(row.durationMonths)||(row.durationMonths as number)<1||(row.durationMonths as number)>600||!Number.isInteger(row.paymentDay)||(row.paymentDay as number)<1||(row.paymentDay as number)>31||!['active','paused','completed','archived'].includes(row.status as string))throw new Error('Invalid goal settings.');}
    if(table==='transactions'){text(row.title,'Transaction');text(row.notes,'Notes',2000,true);notePhotos(row.notePhotos);assertMoney(row.amountMinor as number);assertDate(row.date as string);if(!['income','expense','adjustment_credit','adjustment_debit','goal_contribution','transfer'].includes(row.kind as string))throw new Error('Invalid transaction type.');if(row.categoryId!==null)id(row.categoryId as string);if(row.goalId!==null)id(row.goalId as string);if(row.voidedAt!==null)assertTimestamp(row.voidedAt as string);id(row.accountId as string);if(row.destinationAccountId!==null)id(row.destinationAccountId as string);if(row.destinationAmountMinor!==null)assertMoney(row.destinationAmountMinor as number);if(!Number.isSafeInteger(row.baseAmountMinor)||(row.baseAmountMinor as number)<1||!Array.isArray(row.tagIds)||row.tagIds.length>20||new Set(row.tagIds).size!==row.tagIds.length)throw new Error('Invalid transaction account or tags.');for(const tagId of row.tagIds)id(tagId as string);if(row.kind==='transfer'?(row.destinationAccountId===null||row.destinationAccountId===row.accountId||row.destinationAmountMinor===null):(row.destinationAccountId!==null||row.destinationAmountMinor!==null))throw new Error('Invalid transfer record.');}
    if(table==='goal_contributions'){id(row.goalId as string);id(row.transactionId as string);assertMoney(row.amountMinor as number);assertDate(row.date as string);}
    if(table==='reminders'){text(row.title,'Reminder');assertTimestamp(row.dueAt as string);if(row.goalId!==null)id(row.goalId as string);if(!['none','daily','weekly','monthly'].includes(row.recurrence as string)||!['active','completed','dismissed'].includes(row.status as string)||(row.monthlyDay!==null&&(!Number.isInteger(row.monthlyDay)||(row.monthlyDay as number)<1||(row.monthlyDay as number)>31))||(row.recurrence==='monthly'&&row.monthlyDay===null))throw new Error('Invalid reminder settings.');}
  };
  validateRecord('profiles',data.profile);
  let count=1;
  for(const [key,table]of mappings){if(!Array.isArray(data[key]))throw new Error('Invalid backup record collection.');const list=data[key]as unknown[];count+=list.length;if(count>100_000)throw new Error('Backup contains too many records for this app version.');for(const row of list)validateRecord(table,row);}
  const snapshot=data as unknown as Snapshot;
  const contains=(table:string,recordId:string|null)=>recordId===null||!!allIds.get(table)?.has(recordId);
  for(const tx of snapshot.transactions){if(!contains('categories',tx.categoryId)||!contains('goals',tx.goalId)||!contains('accounts',tx.accountId)||!contains('accounts',tx.destinationAccountId)||tx.tagIds.some(t=>!contains('tags',t)))throw new Error('Backup has broken transaction references.');if((tx.kind==='goal_contribution')!==!!tx.goalId)throw new Error('Backup has invalid goal transaction links.');}
  if(!snapshot.accounts.some(a=>!a.deletedAt&&a.type==='asset'))throw new Error('Backup must include an active asset account.');
  for(const account of snapshot.accounts){if(account.currency===snapshot.profile?.baseCurrency&&account.exchangeRate!==1)throw new Error('Invalid main currency exchange rate.');convertMinor(accountBalance(snapshot,account.id),account.exchangeRate);}
  const linked=new Set<string>();
  for(const c of snapshot.contributions){const tx=snapshot.transactions.find(t=>t.id===c.transactionId);if(!contains('goals',c.goalId)||!tx||tx.kind!=='goal_contribution'||tx.goalId!==c.goalId||tx.amountMinor!==c.amountMinor||tx.date!==c.date||!!tx.voidedAt!==!!c.deletedAt||linked.has(c.transactionId))throw new Error('Backup has inconsistent contribution records.');linked.add(c.transactionId);}
  if(snapshot.transactions.some(t=>t.kind==='goal_contribution'&&!linked.has(t.id)))throw new Error('Backup has an orphan goal contribution.');
  for(const r of snapshot.reminders)if(!contains('goals',r.goalId))throw new Error('Backup has broken reminder references.');
  const months=new Set<string>();for(const b of snapshot.budgets){if(months.has(b.month))throw new Error('Backup has duplicate monthly budgets.');months.add(b.month);}
  const reminderGoals=new Set<string>();for(const r of snapshot.reminders)if(r.goalId){if(reminderGoals.has(r.goalId))throw new Error('Backup has duplicate goal reminders.');reminderGoals.add(r.goalId);}
  balance(snapshot.transactions);
  return {...envelope,data:snapshot} as unknown as BackupEnvelope;
}
