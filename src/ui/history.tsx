import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useApp } from '../state/AppProvider';
import { AuditLog } from '../core/types';
import { formatMoney } from '../core/money';
import { Button, Card, Chip, Dropdown, Empty, ErrorMessage, InfoButton, Page, Row, Toast, shared, useTheme } from './components';
import { PeriodControls, usePeriod } from './finance';
import { useTask } from './forms';

export function RemindersScreen() {
  const { snapshot, repo, mutate, notificationError } = useApp();
  const { colors } = useTheme();
  const [status, setStatus] = useState<'active'|'completed'|'dismissed'>('active');
  const [saved,setSaved]=useState('');
  const task = useTask();
  const reminders = useMemo(() => snapshot.reminders.filter(r => !r.deletedAt && r.status === status).sort((a,b) => status === 'active' ? a.dueAt.localeCompare(b.dueAt) : b.updatedAt.localeCompare(a.updatedAt)), [snapshot.reminders,status]);
  const goals = useMemo(() => new Map(snapshot.goals.map(goal => [goal.id,goal])), [snapshot.goals]);
  const now = new Date();
  return <Page safeTop={false} compact title="Reminders" action={<Row style={{gap:2}}><InfoButton compact title="Reminder actions" message="Done completes a one-time reminder. Done & next advances a repeating reminder to its next date. Tomorrow reschedules its alert. Dismiss stops it and keeps its history. These actions do not create an expense or savings contribution."/><Button title="New" icon="add" onPress={() => router.push('/reminder/new')} /></Row>}>
    {!snapshot.profile?.notificationsEnabled && <Row style={{justifyContent:'space-between',gap:6}}><Text style={{color:colors.muted,fontSize:12,flex:1}}>Alerts are off. Reminders stay saved.</Text><Button title="Enable alerts" variant="ghost" onPress={() => router.push('/settings')} /></Row>}
    <Toast message={saved}/><ErrorMessage message={notificationError} /><ErrorMessage message={task.error}/>
    <View accessibilityRole="tablist" style={{flexDirection:'row',borderBottomWidth:1,borderBottomColor:colors.border}}>{([{value:'active',label:'Upcoming'},{value:'completed',label:'Done'},{value:'dismissed',label:'Dismissed'}] as const).map(tab=><Pressable key={tab.value} accessibilityRole="tab" accessibilityState={{selected:status===tab.value}} onPress={()=>setStatus(tab.value)} style={{flex:1,minHeight:44,alignItems:'center',justifyContent:'center',borderBottomWidth:status===tab.value?2:0,borderBottomColor:colors.primary}}><Text style={{color:status===tab.value?colors.primary:colors.muted,fontSize:14,fontWeight:status===tab.value?'700':'500'}}>{tab.label}</Text></Pressable>)}</View>
    {reminders.length ? <View>{reminders.map(r => {
      const goal = r.goalId ? goals.get(r.goalId) : undefined;
      const paused = goal && goal.status !== 'active';
      const due = new Date(r.dueAt), overdue = due < now;
      const state = paused ? 'Goal paused' : overdue ? 'Overdue' : due.toDateString() === now.toDateString() ? 'Today' : 'Upcoming';
      const recurrence = {none:'One time',daily:'Every day',weekly:'Every week',monthly:'Every month'}[r.recurrence];
      return <View key={r.id} style={{paddingVertical:10,borderBottomWidth:1,borderBottomColor:colors.border,gap:5}}><Row style={{alignItems:'flex-start',gap:8}}><Ionicons name={goal?'flag-outline':'notifications-outline'} size={21} color={overdue&&!paused&&status==='active'?colors.warning:colors.primary}/><View style={{flex:1,gap:3}}><Text style={{color:colors.text,fontSize:15,fontWeight:'700'}}>{r.title}</Text><Text style={{color:colors.muted,fontSize:12,lineHeight:16}}>{due.toLocaleString(undefined,{month:'short',day:'numeric',year:due.getFullYear()!==now.getFullYear()?'numeric':undefined,hour:'numeric',minute:'2-digit'})}</Text><Text style={{color:colors.muted,fontSize:11,lineHeight:14}}>{recurrence}{goal?` · ${goal.name}`:''}</Text></View>{status==='active'&&<Text style={{color:paused?colors.muted:overdue?colors.warning:colors.primary,fontSize:11,fontWeight:'700'}}>{state}</Text>}</Row>
        {status === 'active' && <><Row style={{gap:6}}><View style={{flex:1}}><Button title={r.recurrence==='none'?'Done':'Done & next'} variant="secondary" disabled={task.pending} icon="checkmark" onPress={()=>void task.run(async()=>{await mutate(()=>repo.actReminder(r.id,'complete'));if(r.recurrence==='none'){setStatus('completed');setSaved('Reminder marked done');}else setSaved('Done. Next occurrence scheduled.');})}/></View><View style={{flex:1}}><Button title="Tomorrow" variant="ghost" disabled={task.pending} icon="time-outline" onPress={()=>void task.run(async()=>{const next=new Date();next.setDate(next.getDate()+1);const original=new Date(r.dueAt);next.setHours(original.getHours(),original.getMinutes(),0,0);await mutate(()=>repo.actReminder(r.id,'snooze',next.toISOString()));setSaved('Reminder moved to tomorrow');})}/></View></Row><Row style={{justifyContent:'flex-end',gap:4}}><Button title="Edit" variant="ghost" disabled={task.pending} onPress={()=>router.push(`/reminder/new?id=${r.id}`)}/><Button title="Dismiss" variant="ghost" disabled={task.pending} onPress={()=>void task.run(async()=>{await mutate(()=>repo.actReminder(r.id,'dismiss'));setSaved('Reminder dismissed');})}/></Row></>}
      </View>;
    })}</View> : <Empty title={status==='active'?'No upcoming reminders':status==='completed'?'No completed reminders':'No dismissed reminders'} body={status==='active'?'Add a bill, savings date, or anything to remember.':'Your reminder history appears here.'} action={status==='active'?<Button title="Add reminder" variant="secondary" onPress={()=>router.push('/reminder/new')}/>:undefined}/>}
  </Page>;
}

function readableType(type: string) {
  const names:Record<string,string>={tracker_created:'Created your tracker',balance_added:'Added opening balance',income_added:'Added money',income_edited:'Edited money added',income_voided:'Voided money added',expense_added:'Added expense',expense_edited:'Edited expense',expense_voided:'Voided expense',transfer_added:'Transferred money',transfer_edited:'Edited transfer',transfer_voided:'Voided transfer',settings_updated:'Updated preferences',budget_updated:'Updated monthly budget',backup_restored:'Restored a backup',backup_exported:'Saved a backup',csv_exported:'Exported transactions',xlsx_exported:'Exported Excel workbook',goal_contribution:'Added to a savings goal',goal_created:'Created a savings goal',goal_edited:'Edited a savings goal',goal_completed:'Completed a goal',goal_paused:'Paused a goal',goal_active:'Resumed a goal',goal_archived:'Archived a goal',goal_reopened:'Reopened a goal',reminder_created:'Created a reminder',reminder_updated:'Updated a reminder',reminder_complete:'Completed a reminder',reminder_dismiss:'Dismissed a reminder',reminder_snooze:'Snoozed a reminder',category_added:'Added a category',category_renamed:'Edited a category',category_deleted:'Removed a category',tag_added:'Added a tag',tag_renamed:'Edited a tag',tag_deleted:'Removed a tag',account_added:'Added a wallet',account_updated:'Updated a wallet',account_deleted:'Removed a wallet'};
  return names[type]??type.replaceAll('_',' ').replaceAll('.',' ').replace(/^\w/,s=>s.toUpperCase());
}
function auditValues(value:string|null):Record<string,unknown> {
  if(!value)return {};
  try { const parsed:unknown=JSON.parse(value);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};const object=parsed as Record<string,unknown>;return object.transaction&&typeof object.transaction==='object'?object.transaction as Record<string,unknown>:object; } catch {return {};}
}
const auditLabels:Record<string,string>={title:'Description',name:'Name',displayName:'Your name',amountMinor:'Amount',targetMinor:'Target',date:'Date',categoryId:'Category',accountId:'From wallet',destinationAccountId:'To wallet',destinationAmountMinor:'Received amount',tagIds:'Tags',notes:'Notes',notePhotos:'Photo notes',dailySummaryEnabled:'Daily summary',homeShortcuts:'Home shortcuts',goalId:'Savings goal',kind:'Type',type:'Wallet type',currency:'Currency',baseCurrency:'Main currency',balanceLabel:'Balance name',avatarUri:'Profile photo',imageUri:'Goal image',includedInBalance:'Include in total',exchangeRate:'Exchange rate',month:'Budget month',status:'Status',durationMonths:'Months to save',startDate:'Starting date',paymentDay:'Payment day',dueAt:'Reminder date',recurrence:'Repeats',monthlyDay:'Day of month',appearance:'Appearance',hideBalance:'Hide balance',notificationsEnabled:'Reminders',performanceThresholds:'Spending levels',transactionSounds:'Transaction sounds',hapticsEnabled:'Subtle vibrations',notificationSound:'Reminder sound',tutorialCompleted:'Welcome tour',voidedAt:'Voided',transactions:'Transactions restored',backupCreatedAt:'Backup created'};
function AuditCard({ event }: { event: AuditLog }) {
  const { colors } = useTheme();
  const {snapshot}=useApp();
  const [expanded, setExpanded] = useState(false);
  const before=auditValues(event.before),after=auditValues(event.after);
  const changed=Object.keys(auditLabels).filter(key=>(key in before||key in after)&&JSON.stringify(before[key])!==JSON.stringify(after[key]));
  const currency=snapshot.accounts.find(a=>a.id===(after.accountId??before.accountId))?.currency??snapshot.profile?.baseCurrency;
  const renderValue=(key:string,value:unknown):string=>{
    if(value===null||value===undefined||value==='')return '—';
    if(key==='categoryId')return snapshot.categories.find(c=>c.id===value)?.name??'Previous category';
    if(key==='accountId'||key==='destinationAccountId')return snapshot.accounts.find(a=>a.id===value)?.name??'Previous wallet';
    if(key==='goalId')return snapshot.goals.find(g=>g.id===value)?.name??'Savings goal';
    if(key==='tagIds'&&Array.isArray(value))return value.map(id=>snapshot.tags.find(t=>t.id===id)?.name??'Previous tag').join(', ')||'No tags';
    if(key==='performanceThresholds'&&Array.isArray(value))return value.map(n=>`${Math.round(Number(n)*100)}%`).join(' · ');
    if(key==='avatarUri')return 'Photo selected';
    if(key==='imageUri')return 'Image selected';
    if(key==='notePhotos'&&Array.isArray(value))return value.length+' photo'+(value.length===1?'':'s');
    if(key==='homeShortcuts'&&Array.isArray(value))return value.length+' shortcuts';
    if(typeof value==='boolean')return value?'On':'Off';
    if(key.endsWith('Minor')&&typeof value==='number')return formatMoney(value,key==='destinationAmountMinor'?snapshot.accounts.find(a=>a.id===(after.destinationAccountId??before.destinationAccountId))?.currency:currency);
    if(['dueAt','voidedAt','backupCreatedAt'].includes(key)&&typeof value==='string')return new Date(value).toLocaleString();
    if(key==='kind'){const names:Record<string,string>={income:'Money in',expense:'Expense',transfer:'Transfer',goal_contribution:'Savings',adjustment_credit:'Balance increase',adjustment_debit:'Balance decrease'};return names[String(value)]??'Transaction';}
    if(key==='notificationSound'){const names:Record<string,string>={default:'iPhone default','chime.wav':'Chime','pop.wav':'Pop',none:'Silent'};return names[String(value)]??'Selected sound';}
    if(typeof value==='string')return value.replaceAll('_',' ').replace(/^\w/,s=>s.toUpperCase());
    if(typeof value==='number')return String(value);
    return 'Updated';
  };
  const accent=event.type.startsWith('transfer')?colors.transfer:event.group==='income'?colors.success:event.group==='expense'?colors.danger:colors.primary;
  const subject=after.title??after.name??before.title??before.name;
  return <View style={{borderBottomWidth:1,borderBottomColor:colors.border,paddingVertical:8,gap:6}}><Pressable onPress={() => setExpanded(!expanded)} accessibilityRole="button" accessibilityLabel={`${readableType(event.type)}, ${new Date(event.timestamp).toLocaleString()}, ${expanded ? 'collapse details' : 'expand details'}`} accessibilityState={{ expanded }} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 48 }}><Ionicons name={event.type.startsWith('transfer')?'swap-horizontal':event.group === 'income' ? 'arrow-up-outline' : event.group === 'expense' ? 'receipt-outline' : event.group === 'goal' ? 'flag-outline' : 'time-outline'} size={21} color={accent} /><View style={{ flex: 1, gap: 2 }}><Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{readableType(event.type)}</Text>{typeof subject==='string'&&<Text numberOfLines={1} style={{color:colors.muted,fontSize:12}}>{subject}</Text>}</View><View style={{alignItems:'flex-end',gap:3}}>{typeof (after.amountMinor??before.amountMinor)==='number'&&<Text style={{color:accent,fontWeight:'600',fontSize:13}}>{formatMoney(Number(after.amountMinor??before.amountMinor),currency)}</Text>}<Text style={{ color: colors.muted, fontSize: 11 }}>{new Date(event.timestamp).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</Text></View><Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} /></Pressable>
    {expanded && <View><Row style={{paddingVertical:6,alignItems:'flex-start',gap:8}}>{['Changed','Before','After'].map(label=><Text key={label} style={{flex:1,color:colors.muted,fontSize:11,fontWeight:'700'}}>{label}</Text>)}</Row>{changed.length?changed.map(key=><Row key={key} style={{paddingVertical:7,borderTopWidth:1,borderTopColor:colors.border,alignItems:'flex-start',gap:8}}><Text style={{flex:1,color:colors.text,fontWeight:'600',fontSize:12,lineHeight:16}}>{auditLabels[key]}</Text><Text selectable style={{flex:1,color:colors.muted,fontSize:12,lineHeight:16}}>{renderValue(key,before[key])}</Text><Text selectable style={{flex:1,color:colors.text,fontSize:12,lineHeight:16}}>{renderValue(key,after[key])}</Text></Row>):<Text style={{color:colors.muted,paddingVertical:8,fontSize:12,lineHeight:16}}>Activity recorded. No financial details changed.</Text>}</View>}
  </View>;
}
export function AuditScreen() {
  const {snapshot}=useApp(),{colors}=useTheme(),period=usePeriod('allTime');
  const [group,setGroup]=useState<AuditLog['group']|'all'|'transfer'>('all'),[visible,setVisible]=useState(50);
  useEffect(()=>setVisible(50),[group,period.period,period.range.start,period.range.end]);
  const events=snapshot.auditLogs.filter(event=>(group==='all'||(group==='transfer'?event.type.startsWith('transfer'):event.group===group))&&(period.period==='allTime'||(!period.error&&localAuditDate(event.timestamp)>=period.range.start&&localAuditDate(event.timestamp)<=period.range.end))).slice().sort((a,b)=>b.timestamp.localeCompare(a.timestamp));
  return <Page safeTop={false} compact title="Activity history" action={<InfoButton compact title="Activity history" message="A read-only record of changes. Tap a row to compare before and after."/>}>
    <Row style={{gap:10}}><View style={{flex:1}}><Dropdown hideLabel label="Activity" value={group} options={[{value:'all',label:'All activity'},{value:'income',label:'Money in'},{value:'expense',label:'Expenses'},{value:'transfer',label:'Transfers'},{value:'goal',label:'Savings'},{value:'system',label:'Settings & other'}]} onChange={value=>setGroup(value as typeof group)}/></View><Text style={{color:colors.muted,fontSize:11}}>{events.length} changes</Text></Row><PeriodControls state={period}/>
    <View>{events.slice(0,visible).map((event,index)=><View key={event.id}>{(index===0||localAuditDate(event.timestamp)!==localAuditDate(events[index-1].timestamp))&&<Text style={{color:colors.primary,fontSize:12,fontWeight:'700',paddingTop:14,paddingBottom:3}}>{new Date(event.timestamp).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</Text>}<AuditCard event={event}/></View>)}{!events.length&&<Text style={{color:colors.muted,fontSize:13,paddingVertical:20}}>No activity for these filters.</Text>}</View>
    {events.length>visible&&<Button title="Show more" variant="ghost" onPress={()=>setVisible(count=>count+50)}/>}
  </Page>;
}
function localAuditDate(timestamp: string) { const value = new Date(timestamp); return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`; }
