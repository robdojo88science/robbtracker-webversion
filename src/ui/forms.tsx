import React, { useMemo, useRef, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, Switch, Text, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useApp } from '../state/AppProvider';
import { assertDate, localDate } from '../core/dates';
import { convertMinor, formatMoney, parseMoney } from '../core/money';
import { accountBalance, balanceSummary, computeAccountBalances, goalProgress } from '../core/analytics';
import { transactionFeedback } from '../platform/feedback';
import { requestNotificationPermission } from '../platform/notifications';
import { chooseNotePhotos } from '../platform/notes';
import { chooseProfilePhoto } from '../platform/profile';
import { goToTransactions } from '../platform/navigation';
import { GoalStatus, Recurrence, TransactionInput } from '../core/types';
import { Button, Card, Chip, DateField, Dropdown, Empty, ErrorMessage, Field, InfoButton, Money, Page, Progress, Row, Section, shared, Toast, useTheme } from './components';
import { TransactionRow } from './finance';

export function useTask() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  async function run(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError(null);
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Please try again.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  return { pending, error, run };
}
function finish() { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }
function decimal(minor: number) { return (minor / 100).toFixed(2); }

function NotePhotos({ photos, onChange, disabled = false, onPick }: { photos: string[]; onChange?: (photos: string[]) => void; disabled?: boolean; onPick?: () => void }) {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const [preview, setPreview] = useState<string | null>(null);
  return <View style={{ gap: 8 }}>
    {(photos.length > 0 || onChange) && <Row style={{ justifyContent: 'space-between' }}><Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>Photos{onChange ? ` · ${photos.length}/3` : ''}</Text>{onPick && <Button title="Add photo" icon="image-outline" variant="ghost" disabled={disabled || photos.length >= 3} onPress={onPick} />}</Row>}
    {photos.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{photos.map((uri, index) => <View key={`${index}-${uri.length}`} style={{ width: 92, gap: 2 }}><Pressable accessibilityRole="button" accessibilityLabel={`Open note photo ${index + 1}`} onPress={() => setPreview(uri)}><Image source={{ uri }} resizeMode="cover" style={{ width: 92, height: 92, borderRadius: 3, backgroundColor: colors.primaryLight }} /></Pressable>{onChange && <Pressable accessibilityRole="button" accessibilityLabel={`Remove note photo ${index + 1}`} disabled={disabled} onPress={() => onChange(photos.filter((_, i) => i !== index))} style={{ minHeight: 34, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.danger, fontSize: 12 }}>Remove</Text></Pressable>}</View>)}</View>}
    {onChange && <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17 }}>Original resolution is preserved. Tap a photo to check the text before saving.</Text>}
    <Modal visible={preview !== null} animationType="fade" presentationStyle="fullScreen" onRequestClose={() => setPreview(null)}><View style={{ flex: 1, backgroundColor: '#08172C', paddingTop: 56, paddingBottom: 24 }}><Row style={{ paddingHorizontal: 16, justifyContent: 'space-between' }}><Text style={{ color: '#FFFFFF', fontSize: 14 }}>Pinch to zoom</Text><Pressable accessibilityRole="button" accessibilityLabel="Close photo" onPress={() => setPreview(null)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="close" size={27} color="#FFFFFF" /></Pressable></Row><ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} minimumZoomScale={1} maximumZoomScale={5} centerContent>{preview && <Image source={{ uri: preview }} resizeMode="contain" style={{ width, height: Math.max(200, height - 124) }} />}</ScrollView></View></Modal>
  </View>;
}

export function TransactionFormScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= 700;
  const params = useLocalSearchParams<{ id?: string; kind?: string; accountId?: string }>();
  const { snapshot, repo, mutate } = useApp();
  const { colors } = useTheme();
  const existing = useMemo(() => snapshot.transactions.find(t => t.id === params.id), [snapshot.transactions, params.id]);
  const [stableId] = useState(() => params.id ?? randomUUID());
  const candidate = params.kind ?? existing?.kind ?? 'expense';
  const initialKind: TransactionInput['kind'] = ['income', 'expense', 'adjustment_credit', 'adjustment_debit', 'transfer'].includes(candidate) ? candidate as TransactionInput['kind'] : 'expense';
  const [kind, setKind] = useState(initialKind);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [amount, setAmount] = useState(existing ? decimal(existing.amountMinor) : '');
  const [destinationAmount, setDestinationAmount] = useState(existing?.destinationAmountMinor ? decimal(existing.destinationAmountMinor) : '');
  const [date, setDate] = useState(existing?.date ?? localDate());
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [notePhotos, setNotePhotos] = useState<string[]>(existing?.notePhotos ?? []);
  const [category, setCategory] = useState(existing?.categoryId ?? snapshot.categories.find(c => !c.deletedAt)?.id ?? null);
  const [accountId, setAccountId] = useState(existing?.accountId ?? snapshot.accounts.find(a => a.id === params.accountId && !a.deletedAt)?.id ?? snapshot.accounts.find(a => !a.deletedAt)?.id ?? '');
  const [destinationId, setDestinationId] = useState(existing?.destinationAccountId ?? snapshot.accounts.find(a => !a.deletedAt && a.id !== accountId)?.id ?? '');
  const [tagIds, setTagIds] = useState(existing?.tagIds ?? []);
  const [newTag, setNewTag] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [chooseIncomeWallet, setChooseIncomeWallet] = useState(Boolean(params.accountId) || Boolean(existing) || snapshot.accounts.filter(a => !a.deletedAt).length > 1);
  const tap = () => { if (snapshot.profile?.hapticsEnabled !== false) void Haptics.selectionAsync().catch(() => {}); };
  const task = useTask();
  const accounts = useMemo(() => snapshot.accounts.filter(a => !a.deletedAt || a.id === existing?.accountId || a.id === existing?.destinationAccountId), [snapshot.accounts, existing?.accountId, existing?.destinationAccountId]);
  const walletBalances = useMemo(() => computeAccountBalances(snapshot.transactions), [snapshot.transactions]);
  const walletOptions = useMemo(() => accounts.map(a => ({ value: a.id, label: a.name, color: a.color, subtitle: `${a.currency} · ${formatMoney(walletBalances.get(a.id) ?? 0, a.currency)}` })), [accounts, walletBalances]);
  const account = accounts.find(a => a.id === accountId);
  const destination = accounts.find(a => a.id === destinationId);
  const currency = account?.currency ?? snapshot.profile!.baseCurrency;
  const isAdjustment = kind.startsWith('adjustment');
  const isTransfer = kind === 'transfer';
  const label = isAdjustment ? 'Balance adjustment' : kind === 'income' ? 'Add money' : isTransfer ? 'Transfer money' : 'Add expense';
  const withoutCurrent = useMemo(() => existing ? { ...snapshot, transactions: snapshot.transactions.filter(t => t.id !== existing.id) } : snapshot, [snapshot, existing]);
  const accountAvailable = useMemo(() => accountBalance(withoutCurrent, accountId), [withoutCurrent, accountId]);
  const dirty = !existing || kind !== existing.kind || title.trim() !== existing.title || amount !== decimal(existing.amountMinor) || date !== existing.date || notes !== existing.notes || notePhotos.length !== (existing.notePhotos?.length ?? 0) || notePhotos.some((photo, index) => photo !== existing.notePhotos?.[index]) || (kind === 'expense' && category !== existing.categoryId) || accountId !== existing.accountId || (isTransfer && (destinationId !== existing.destinationAccountId || destinationAmount !== decimal(existing.destinationAmountMinor ?? 0))) || tagIds.length !== existing.tagIds.length || tagIds.some(id => !existing.tagIds.includes(id));
  if (params.id && (!existing || existing.voidedAt || existing.kind === 'goal_contribution')) return <Page safeTop={false} title="Transaction unavailable"><Card><Empty title="This record can't be edited" body="Voided records and savings contributions are preserved in your history." action={<Button title="Go back" onPress={finish} />} /></Card></Page>;
  const save = () => void task.run(async () => {
    const amountMinor = parseMoney(amount); assertDate(date);
    let allowOverdraft = false;
    const exceedsWallet = account?.type === 'asset' && (kind === 'expense' || kind === 'adjustment_debit' || isTransfer) && amountMinor > accountAvailable;
    const exceedsMain = kind === 'expense' && account?.includedInBalance && convertMinor(amountMinor, account.exchangeRate) > balanceSummary(withoutCurrent).availableMinor;
    if (exceedsWallet || exceedsMain) {
      allowOverdraft = await new Promise<boolean>(resolve => Alert.alert('This is more than your available money', `${account?.name ?? 'This wallet'} has ${formatMoney(accountAvailable, currency)} available. Saving this ${isTransfer ? 'transfer' : 'expense'} may make your balance negative. Do you want to continue?`, [{ text: 'Go back', style: 'cancel', onPress: () => resolve(false) }, { text: 'Yes, save it', onPress: () => resolve(true) }], { cancelable: true, onDismiss: () => resolve(false) }));
      if (!allowOverdraft) return;
    }
    const received = isTransfer ? destination?.currency === currency ? amountMinor : parseMoney(destinationAmount) : null;
    await mutate(() => repo.saveTransaction({ id: stableId, kind, title: title.trim() || (isTransfer ? `${account?.name} to ${destination?.name}` : ''), amountMinor, date, notes, notePhotos, categoryId: kind === 'expense' ? category : null, accountId, destinationAccountId: isTransfer ? destinationId : null, destinationAmountMinor: received, tagIds: kind === 'expense' ? tagIds : [], allowOverdraft }));
    void transactionFeedback(kind, snapshot.profile); goToTransactions(stableId);
  });
  const saveTitle = existing ? 'Save changes' : isTransfer ? 'Transfer money' : kind === 'expense' ? 'Save expense' : isAdjustment ? 'Save adjustment' : 'Add money';
  const saveDisabled = !dirty || !accountId || !amount.trim() || (!isTransfer && !title.trim()) || (isTransfer && (!destinationId || (destination?.currency !== currency && !destinationAmount.trim())));
  const detailSummary = [tagIds.length ? `${tagIds.length} tag${tagIds.length === 1 ? '' : 's'}` : '', notes.trim() ? 'Note added' : '', notePhotos.length ? `${notePhotos.length} photo${notePhotos.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  return <Page safeTop={false} compact maxWidth={1440} footer={<View style={{ gap: 5 }}><ErrorMessage message={task.error} /><Button title={saveTitle} loading={task.pending} disabled={saveDisabled} onPress={save} /></View>}>
    {!existing && !isAdjustment && <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderBottomColor: colors.border, borderBottomWidth: 1 }}>
      {([{ value: 'expense', label: 'Expense', icon: 'arrow-down-outline' }, { value: 'income', label: 'Money in', icon: 'arrow-up-outline' }, { value: 'transfer', label: 'Transfer', icon: 'swap-horizontal-outline' }] as const).map(item => <Pressable key={item.value} accessibilityRole="tab" accessibilityState={{ selected: kind === item.value }} onPress={() => { tap(); setKind(item.value); }} style={{ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderBottomWidth: 2, borderBottomColor: kind === item.value ? colors.primary : 'transparent' }}><Ionicons name={item.icon} size={17} color={kind === item.value ? colors.primary : colors.muted} /><Text style={{ color: kind === item.value ? colors.primary : colors.muted, fontSize: 14, fontWeight: kind === item.value ? '700' : '500' }}>{item.label}</Text></Pressable>)}
    </View>}
    {existing && <Text style={{ color: colors.muted, fontSize: 12 }}>Editing {label.toLowerCase()}</Text>}
    {isAdjustment && <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}>Correct the wallet balance and record why.</Text>}
    <View style={{flexDirection:wide?'row':'column',gap:8,alignItems:'stretch'}}><View style={wide?{flex:1}:undefined}><Field label={`Amount · ${currency}`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" maxLength={16} style={{ fontSize: 34, lineHeight: 38, fontWeight: '700', minHeight: 56, paddingVertical: 6 }} /></View>
    <View style={wide?{flex:2,justifyContent:'flex-end'}:undefined}><Field label={isTransfer ? 'Description · optional' : kind === 'expense' ? 'What did you spend on?' : isAdjustment ? 'Reason' : 'Where did the money come from?'}
      labelAction={<InfoButton compact title="Transaction description" message="This becomes the name shown in your transaction records and activity history. Use a short description like Lunch or Bus fare so it is easy to recognize and search later." />}
      value={title} onChangeText={setTitle} placeholder={kind === 'expense' ? 'Lunch, groceries, bus fare…' : isTransfer ? 'Cash to BDO' : 'Salary, gift, refund…'} maxLength={120} /></View></View>
    {kind==='income'&&accounts.length>1&&<Row style={{justifyContent:'space-between'}}><Text style={{color:colors.text,fontSize:13,flex:1}}>Choose where to add this money</Text><Switch accessibilityLabel="Choose destination wallet" value={chooseIncomeWallet} onValueChange={enabled=>{setChooseIncomeWallet(enabled);if(!enabled)setAccountId(accounts.find(a=>a.type==='asset'&&a.currency===snapshot.profile?.baseCurrency&&a.name.toLowerCase()==='cash')?.id??accounts.find(a=>a.type==='asset')?.id??accounts[0]?.id??'');}} trackColor={{true:colors.primary}}/></Row>}
    <Row style={{ alignItems: 'flex-start', gap: 10 }}>
      <View style={{ flex: 1, minWidth: 0 }}>{kind==='income'&&!chooseIncomeWallet&&accounts.length>1?<View style={{minHeight:62,justifyContent:'center',gap:4}}><Text style={{color:colors.muted,fontSize:12}}>Add money to</Text><Text style={{color:colors.text,fontSize:15,fontWeight:'600'}}>{account?.name}</Text></View>:<Dropdown label={isTransfer ? 'From' : kind==='income'?'Add money to':'Wallet'} value={accountId} options={walletOptions} onChange={value => { setAccountId(value); if (destinationId === value) setDestinationId(accounts.find(a => a.id !== value)?.id ?? ''); }} />}</View>
      <View style={{ flex: 1, minWidth: 0 }}>{isTransfer ? <Dropdown label="To" value={destinationId} options={walletOptions.filter(a => a.value !== accountId)} onChange={setDestinationId} /> : kind==='expense' ? <Dropdown label="Category" value={category ?? ''} options={[{ value: '', label: 'Uncategorized' }, ...snapshot.categories.filter(c => !c.deletedAt || c.id === existing?.categoryId).map(c => ({ value: c.id, label: c.name, color: c.color }))]} onChange={value => setCategory(value || null)} /> : <DateField value={date} onChange={setDate} />}</View>
    </Row>
    {kind === 'expense' && <Row style={{gap:8}}><View style={{flex:1,minWidth:0}}><DateField hideLabel value={date} onChange={setDate}/></View><View style={{flex:1,flexDirection:'row',alignItems:'center',justifyContent:'flex-end',gap:4}}><Text numberOfLines={2} style={{color:colors.muted,fontSize:12,flexShrink:1}}>{account?.name}: {formatMoney(accountAvailable,currency)}</Text><InfoButton compact title="Dates and balances" message="Your wallet changes when you save, including future-dated records. This month includes the full calendar month in Performance. Use a reminder for a payment you have not made yet."/></View></Row>}
    {isTransfer && <Row style={{ alignItems: 'flex-start', gap: 10 }}><View style={{ flex: 1, minWidth: 0 }}><DateField value={date} onChange={setDate} /></View>{destination?.currency !== currency && <View style={{ flex: 1, minWidth: 0 }}><Field label={`Received · ${destination?.currency ?? ''}`} value={destinationAmount} onChangeText={setDestinationAmount} keyboardType="decimal-pad" placeholder="0.00" maxLength={16} /></View>}</Row>}
    {isTransfer && destination?.currency !== currency && <Button title="Calculate using my rates" variant="ghost" disabled={!amount || !destination} onPress={() => { try { setDestinationAmount(decimal(Math.round(parseMoney(amount) * (account?.exchangeRate ?? 1) / (destination?.exchangeRate ?? 1)))); } catch { /* Keep the incomplete amount editable. */ } }} />}
    {kind!=='expense'&&<Row style={{ justifyContent: 'space-between', gap: 8 }}><Text style={{ color: colors.muted, fontSize: 12, flex: 1 }}>{account?.name ?? 'Wallet'}: {formatMoney(accountAvailable, currency)}</Text><InfoButton compact title="Dates and balances" message="Your wallet changes as soon as you save, including future-dated records. Performance groups expenses by their selected date. This month includes the full calendar month; use a reminder for a payment that has not happened yet." /></Row>}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} accessibilityLabel={detailsOpen ? 'Hide optional details' : 'Show optional details'} onPress={() => setDetailsOpen(value => !value)} style={{ minHeight: 44, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 8 }}><Ionicons name={detailsOpen ? 'chevron-up' : 'add-outline'} size={19} color={colors.primary} /><Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>More details</Text><Text numberOfLines={1} style={{ flex: 1, color: colors.muted, fontSize: 12, textAlign: 'right' }}>{detailSummary || (kind === 'expense' ? 'Tags & notes' : 'Notes')}</Text></Pressable>
    {detailsOpen && <View style={{ gap: 12 }}>
      {kind === 'expense' && <><View style={{ gap: 6 }}><Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>Tags</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{snapshot.tags.filter(t => !t.deletedAt || tagIds.includes(t.id)).map(tag => <Chip key={tag.id} label={`#${tag.name}`} selected={tagIds.includes(tag.id)} onPress={() => setTagIds(ids => ids.includes(tag.id) ? ids.filter(id => id !== tag.id) : [...ids, tag.id])} />)}</View></View><Row style={{ alignItems: 'flex-end', gap: 8 }}><View style={{ flex: 1 }}><Field label="New tag" value={newTag} onChangeText={setNewTag} placeholder="Work, family…" maxLength={60} /></View><Button title="Add" variant="secondary" disabled={!newTag.trim() || task.pending} onPress={() => void task.run(async () => { const match = snapshot.tags.find(t => !t.deletedAt && t.name.toLowerCase() === newTag.trim().toLowerCase()); const id = match?.id ?? randomUUID(); if (!match) await mutate(() => repo.saveTag({ id, name: newTag.trim(), color: '#007DFE' })); setTagIds(ids => ids.includes(id) ? ids : [...ids, id]); setNewTag(''); })} /></Row></>}
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline maxLength={2000} placeholder="Anything else to remember" />
      <NotePhotos photos={notePhotos} onChange={setNotePhotos} disabled={task.pending} onPick={() => void task.run(async () => setNotePhotos(await chooseNotePhotos(notePhotos)))} />
      {kind === 'expense' && <Button title="Edit categories & tags" variant="ghost" icon="options-outline" onPress={() => router.push('/categories')} />}
    </View>}
  </Page>;
}

export function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { snapshot, repo, mutate } = useApp();
  const { colors } = useTheme();
  const task = useTask();
  const tx = snapshot.transactions.find(t => t.id === id);
  if (!tx) return <Page safeTop={false} title="Transaction"><Empty title="Record not found" body="This record is no longer available on this device." /></Page>;
  const category = snapshot.categories.find(c => c.id === tx.categoryId);
  const goal = snapshot.goals.find(g => g.id === tx.goalId);
  const account = snapshot.accounts.find(a => a.id === tx.accountId);
  const destination = snapshot.accounts.find(a => a.id === tx.destinationAccountId);
  const tags = snapshot.tags.filter(tag => tx.tagIds.includes(tag.id));
  const positive = tx.kind === 'income' || tx.kind === 'adjustment_credit';
  const tone = tx.kind === 'transfer' ? '#DAA01E' : positive ? '#19A779' : '#E45361';
  const voidRecord = () => Alert.alert('Reverse this transaction?', tx.kind === 'goal_contribution' ? 'The saved amount returns to your wallet and is removed from goal progress. The original record stays in history.' : 'The wallet balances and totals will be recalculated. This record stays in history with a Reversed label.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Reverse transaction', style: 'destructive', onPress: () => void task.run(async () => { await mutate(() => repo.voidTransaction(tx.id)); goToTransactions(tx.id); }) }]);
  return <Page safeTop={false} title="Transaction details" maxWidth={650}><Card><Text style={{ color: tone, fontSize: 13, fontWeight: '700' }}>{tx.kind === 'transfer' ? '⇄ TRANSFER' : positive ? '↗ MONEY ADDED' : tx.kind === 'goal_contribution' ? '🌱 SAVINGS' : '↙ MONEY OUT'}</Text><Money value={tx.amountMinor} currency={account?.currency} style={{ fontSize: 40, color: tone }} /><Text style={{ color: colors.text, fontSize: 22, fontWeight: '600' }}>{tx.title}</Text>{tx.voidedAt && <Text style={{ color: colors.danger, fontWeight: '600' }}>Reversed · excluded from balance and totals</Text>}
    {([['Date', new Date(`${tx.date}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })], ['Wallet', account?.name], ['To wallet', destination?.name], ['Arrived', destination && tx.destinationAmountMinor !== null ? formatMoney(tx.destinationAmountMinor, destination.currency) : null], ['Category', category?.name], ['Tags', tags.map(t => `#${t.name}`).join('  ')], ['Goal', goal?.name], ['Notes', tx.notes], ['Saved', new Date(tx.createdAt).toLocaleString()]] as const).filter(([, value]) => !!value).map(([label, value]) => <Row key={label} style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}><Text style={{ color: colors.muted, fontSize: 14 }}>{label}</Text><Text selectable style={{ color: colors.text, fontSize: 14, textAlign: 'right', flex: 1, maxWidth: '70%', lineHeight: 19 }}>{value}</Text></Row>)}
    <NotePhotos photos={tx.notePhotos ?? []} /><ErrorMessage message={task.error} />{!tx.voidedAt && <>{tx.kind !== 'goal_contribution' && <Button title="Edit transaction" variant="secondary" icon="create-outline" onPress={() => router.push(`/transaction/new?id=${tx.id}&kind=${tx.kind}`)} />}<Button title="Reverse transaction" variant="ghost" icon="return-up-back-outline" loading={task.pending} onPress={voidRecord} /></>}
  </Card><Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>Your history is preserved. Reversing removes a transaction’s effect while keeping a record of what happened.</Text><Button title="View activity history" variant="ghost" icon="time-outline" onPress={() => router.push('/audit')} /></Page>;
}
export function GoalFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { snapshot, repo, mutate } = useApp();
  const { colors } = useTheme();
  const existing = useMemo(() => snapshot.goals.find(g => g.id === id), [snapshot.goals, id]);
  const [stableId] = useState(() => id ?? randomUUID());
  const [name, setName] = useState(existing?.name ?? '');
  const [target, setTarget] = useState(existing ? decimal(existing.targetMinor) : '');
  const [duration, setDuration] = useState(String(existing?.durationMonths ?? 6));
  const [start, setStart] = useState(existing?.startDate ?? localDate());
  const [day, setDay] = useState(String(existing?.paymentDay ?? 15));
  const [imageUri, setImageUri] = useState<string | null>(existing?.imageUri ?? null);
  const [statusMessage, setStatusMessage] = useState('');
  const task = useTask();
  const progress = useMemo(() => existing ? goalProgress(existing, snapshot.contributions, snapshot.transactions) : null, [existing, snapshot.contributions, snapshot.transactions]);
  const dirty = !existing || name.trim() !== existing.name || target !== decimal(existing.targetMinor) || Number(duration) !== existing.durationMonths || start !== existing.startDate || Number(day) !== existing.paymentDay || imageUri !== existing.imageUri;
  let recommended: number | null = null;
  try { const count = Number(duration); if (Number.isInteger(count) && count > 0) recommended = Math.ceil(parseMoney(target) / count); } catch { /* Keep an incomplete amount editable. */ }
  const changeStatus = (status: GoalStatus) => {
    if (status === 'completed' && existing && progress && progress.remainingMinor > 0) {
      Alert.alert('A little more to reach your goal', `${formatMoney(progress.remainingMinor, snapshot.profile!.baseCurrency)} is still needed. Completing a goal never adds money for you. Would you like to record the remaining contribution?`, [{ text: 'Keep saving', style: 'cancel' }, { text: existing.status === 'active' ? 'Add remaining' : 'Resume & contribute', onPress: () => void task.run(async () => { if (existing.status !== 'active') await mutate(() => repo.setGoalStatus(existing.id, 'active')); router.push({ pathname: '/goal/[id]/contribute', params: { id: existing.id, amount: decimal(progress.remainingMinor) } }); }) }]);
      return;
    }
    const titles: Record<GoalStatus,string> = { active: 'Resume goal?', paused: 'Pause goal?', completed: 'Complete goal?', archived: 'Archive goal?' };
    const body = status === 'archived' ? 'Your contributions and ledger history are preserved. Saved money remains set aside; void a contribution from its transaction details to return it to your spendable balance.' : status === 'paused' ? 'Contributions can resume later. Goal reminders pause with this goal.' : status === 'completed' ? 'Celebrate your milestone. Goal reminders will stop; your savings history stays available.' : 'Goal contribution reminders will resume.';
    Alert.alert(titles[status], body, [{ text: 'Cancel', style: 'cancel' }, { text: titles[status].replace('?',''), onPress: () => void task.run(async () => { await mutate(() => repo.setGoalStatus(existing!.id,status)); setStatusMessage(status === 'completed' ? 'Goal completed 🎉' : status === 'active' ? 'Goal resumed' : status === 'paused' ? 'Goal paused' : 'Goal archived'); }) }]);
  };
  if (id && !existing) return <Page safeTop={false} title="Goal"><Empty title="Goal not found" body="This goal is no longer available." /></Page>;
  return <Page safeTop={false} title={existing ? 'Your goal' : 'Create a goal'} subtitle="Give your next milestone a place to grow." maxWidth={600}>
    {progress && <Card style={{ backgroundColor: colors.primaryLight }}><Row style={{ justifyContent: 'space-between' }}><Money value={progress.savedMinor} style={{ color: colors.primary }} /><Text style={{ color: colors.primary, fontSize: 24, fontWeight: '700' }}>{Math.round(progress.percent)}%</Text></Row><Progress value={progress.percent} /><Text style={{ color: colors.muted, fontSize: 13 }}>Estimated completion: {progress.estimatedDate} · {existing?.status}</Text>{existing?.status === 'active' && <Button title="Add contribution" onPress={() => router.push(`/goal/${existing.id}/contribute`)} />}</Card>}
    {existing?.status === 'archived' ? <Card><Text style={{ color: colors.text, lineHeight: 19 }}>This goal is archived. Resume it below to change its details or make new contributions.</Text></Card> : <Card><View style={{ gap: 8 }}><Row style={{ justifyContent: 'space-between' }}><Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>Goal image · optional</Text><Button title={imageUri ? 'Change image' : 'Add image'} icon="image-outline" variant="ghost" disabled={task.pending} onPress={() => void task.run(async () => { const photo = await chooseProfilePhoto('goal'); if (photo) setImageUri(photo); })} /></Row>{imageUri && <><Image accessibilityLabel="Your goal image preview" source={{ uri: imageUri }} resizeMode="contain" style={{ height: 180, width: '100%', borderRadius: 3, backgroundColor: colors.primaryLight }} /><Button title="Remove image" variant="ghost" icon="close-outline" disabled={task.pending} onPress={() => setImageUri(null)} /></>}</View><Field label="Goal name" value={name} onChangeText={setName} placeholder="e.g. A new laptop" maxLength={120} /><Field label={`Target amount · ${snapshot.profile!.baseCurrency}`} value={target} onChangeText={setTarget} keyboardType="decimal-pad" placeholder="0.00" maxLength={16} /><Field label="Duration · months" value={duration} onChangeText={setDuration} keyboardType="number-pad" maxLength={3} /><DateField label="Start date" value={start} onChange={setStart} /><Field label="Preferred monthly payment day · 1–31" value={day} onChangeText={setDay} keyboardType="number-pad" maxLength={2} />
      {recommended !== null && <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>Recommended {formatMoney(recommended, snapshot.profile!.baseCurrency)} per month</Text>}<Text style={{ color: colors.muted, fontSize: 12, lineHeight: 19 }}>For shorter months, the reminder falls on the last day. Your contributions are always recorded separately from expenses.</Text><ErrorMessage message={task.error} /><Button title={existing ? 'Save goal changes' : 'Create goal'} loading={task.pending} disabled={!dirty || !name.trim()} onPress={() => void task.run(async () => { const targetMinor = parseMoney(target); assertDate(start); await mutate(() => repo.saveGoal({ id: stableId, name: name.trim(), imageUri, targetMinor, durationMonths: Number(duration), startDate: start, paymentDay: Number(day) })); finish(); })} />
    </Card>}
    {existing && <><Section title="Contribution history"><Card>{snapshot.transactions.filter(t => t.goalId === existing.id && !t.deletedAt).sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).map(t => <TransactionRow key={t.id} item={t} />)}{!snapshot.transactions.some(t => t.goalId === existing.id && !t.deletedAt) && <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 19 }}>Your contributions will appear here. Tap a saved contribution to view it or reverse the transfer.</Text>}</Card></Section><Card><Toast message={statusMessage} /><Section title="Manage goal"><View style={shared.stack}>{existing.status === 'active' && <Button title="Pause goal" variant="secondary" disabled={task.pending} onPress={() => changeStatus('paused')} />}{(existing.status === 'paused' || existing.status === 'archived') && <Button title="Resume goal" variant="secondary" disabled={task.pending} onPress={() => changeStatus('active')} />}{existing.status !== 'completed' && <Button title="Mark complete" variant="secondary" disabled={task.pending} onPress={() => changeStatus('completed')} />}{existing.status !== 'archived' && <Button title="Archive goal" variant="ghost" disabled={task.pending} onPress={() => changeStatus('archived')} />}<ErrorMessage message={task.error} /><Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>Completing or archiving keeps your savings set aside. To return funds to your spendable balance, open a contribution above and void that transfer.</Text></View></Section></Card></>}
  </Page>;
}
export function ContributionScreen() {
  const { id, amount: initialAmount } = useLocalSearchParams<{ id: string; amount?: string }>();
  const { snapshot, repo, mutate } = useApp();
  const { colors } = useTheme();
  const goal = useMemo(() => snapshot.goals.find(g => g.id === id), [snapshot.goals, id]);
  const currency = snapshot.profile!.baseCurrency;
  const wallets = useMemo(() => snapshot.accounts.filter(a => !a.deletedAt && a.currency === currency && a.type === 'asset'), [snapshot.accounts, currency]);
  const walletBalances = useMemo(() => computeAccountBalances(snapshot.transactions), [snapshot.transactions]);
  const [stableId] = useState(() => randomUUID());
  const [accountId, setAccountId] = useState(wallets[0]?.id ?? '');
  const [amount, setAmount] = useState(initialAmount ?? '');
  const [date, setDate] = useState(localDate());
  const [notes, setNotes] = useState('');
  const [notePhotos, setNotePhotos] = useState<string[]>([]);
  const task = useTask();
  const progress = useMemo(() => goal ? goalProgress(goal, snapshot.contributions, snapshot.transactions) : null, [goal, snapshot.contributions, snapshot.transactions]);
  if (!goal || goal.status !== 'active' || !progress) return <Page safeTop={false} title="Contribution"><Empty title="This goal isn't active" body="Resume your goal before adding a contribution." /></Page>;
  return <Page safeTop={false} title="A little closer" subtitle={`Add a contribution to ${goal.name}.`} maxWidth={560}>
    <Card><Text style={{ color: colors.muted, fontSize: 13 }}>Available in selected wallet</Text><Money value={walletBalances.get(accountId) ?? 0} hide={snapshot.profile?.hideBalance} /><Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>{formatMoney(progress.remainingMinor, currency)} left to reach your goal. This sets money aside; it isn’t counted as an expense.</Text></Card>
    <Card><Dropdown label="Save from wallet" value={accountId} options={wallets.map(a => ({ value: a.id, label: a.name, color: a.color, subtitle: formatMoney(walletBalances.get(a.id) ?? 0, currency) }))} onChange={setAccountId} />{!wallets.length && <Button title={`Add a ${currency} wallet`} variant="secondary" onPress={() => router.push('/accounts')} />}<Field label={`Contribution · ${currency}`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" maxLength={16} /><Button title={`Use recommended ${formatMoney(Math.min(progress.monthlyMinor, progress.remainingMinor), currency)}`} variant="ghost" onPress={() => setAmount(decimal(Math.min(progress.monthlyMinor, progress.remainingMinor)))} /><DateField value={date} onChange={setDate} /><Field label="Notes · optional" value={notes} onChangeText={setNotes} multiline maxLength={2000} />
      <NotePhotos photos={notePhotos} onChange={setNotePhotos} disabled={task.pending} onPick={() => void task.run(async () => setNotePhotos(await chooseNotePhotos(notePhotos)))} />
      <ErrorMessage message={task.error} /><Button title="Save contribution" loading={task.pending} disabled={!accountId || !amount.trim()} onPress={() => void task.run(async () => {
        const amountMinor = parseMoney(amount); assertDate(date); let transactionId: string | undefined;
        await mutate(async () => { transactionId = await repo.contribute({ id: stableId, goalId: goal.id, amountMinor, date, notes, notePhotos, accountId }); });
        void transactionFeedback('goal_contribution', snapshot.profile); goToTransactions(transactionId);
      })} />
    </Card>
  </Page>;
}

export function ReminderFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { snapshot, repo, mutate } = useApp();
  const { colors } = useTheme();
  const existing = snapshot.reminders.find(r => r.id === id);
  const [stableId] = useState(() => id ?? randomUUID());
  const initial = existing ? new Date(existing.dueAt) : new Date(Date.now() + 86400000);
  const originalTime = existing ? `${String(initial.getHours()).padStart(2, '0')}:${String(initial.getMinutes()).padStart(2, '0')}` : '09:00';
  const [title, setTitle] = useState(existing?.title ?? '');
  const [date, setDate] = useState(localDate(initial));
  const [time, setTime] = useState(originalTime);
  const [recurrence, setRecurrence] = useState<Recurrence>(existing?.recurrence ?? 'none');
  const [goalId, setGoalId] = useState<string | null>(existing?.goalId ?? null);
  const [customTime,setCustomTime]=useState(false),[optionsOpen,setOptionsOpen]=useState(Boolean(existing?.goalId));
  const timeOptions=useMemo(()=>[...new Set([...Array.from({length:96},(_,index)=>String(Math.floor(index/4)).padStart(2,'0')+':'+String(index%4*15).padStart(2,'0')),time])].sort().map(value=>{const [hour,minute]=value.split(':').map(Number);return{value,label:Number.isInteger(hour)&&Number.isInteger(minute)?String(hour%12||12)+':'+String(minute).padStart(2,'0')+' '+(hour<12?'AM':'PM'):value};}),[time]);
  const eligibleGoals = snapshot.goals.filter(g => !g.deletedAt && (g.status === 'active' || g.id === existing?.goalId) && !snapshot.reminders.some(r => r.goalId === g.id && r.id !== existing?.id));
  const task = useTask();
  const dirty = !existing || title.trim() !== existing.title || date !== localDate(initial) || time !== originalTime || recurrence !== existing.recurrence || goalId !== existing.goalId;
  if (id && !existing) return <Page safeTop={false} title="Reminder"><Empty title="Reminder not found" body="This reminder is no longer available." /></Page>;
  const saveReminder=()=>void task.run(async()=>{assertDate(date);if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Choose a valid time, such as 09:00.');const dueAt=new Date(date+'T'+time+':00').toISOString();await mutate(()=>repo.saveReminder({id:stableId,title:title.trim(),dueAt,recurrence,goalId}));finish();});
  return <Page safeTop={false} compact title={existing?'Edit reminder':'New reminder'} maxWidth={1440} action={<InfoButton compact title="Reminders" message="A reminder is an alert, not a transaction. Choose what to remember and when. Done completes a one-time reminder; repeating reminders move to the next date. Record a payment separately in Transactions."/>} footer={<View style={{gap:5}}><ErrorMessage message={task.error}/><Button title={existing?'Save changes':'Create reminder'} loading={task.pending} disabled={!dirty||!title.trim()} onPress={saveReminder}/></View>}>
    <Field label="Remind me to" value={title} onChangeText={setTitle} placeholder="Pay electricity bill" maxLength={120}/>
    <Row style={{alignItems:'flex-start',gap:8}}><View style={{flex:1}}><DateField label="On" value={date} onChange={setDate}/></View><View style={{flex:1}}><Dropdown label="At" value={customTime?'custom':time} options={[...timeOptions,{value:'custom',label:'Custom time'}]} onChange={value=>{setCustomTime(value==='custom');if(value!=='custom')setTime(value);}}/></View></Row>
    {customTime&&<Field label="Exact time (24-hour)" value={time} onChangeText={setTime} placeholder="09:00" maxLength={5} keyboardType="numbers-and-punctuation"/>}
    <Dropdown label="Repeat" value={recurrence} onChange={value=>setRecurrence(value as Recurrence)} options={[{value:'none',label:'Only once'},{value:'daily',label:'Every day'},{value:'weekly',label:'Every week'},{value:'monthly',label:'Every month'}]}/>
    <Pressable accessibilityRole="button" accessibilityState={{expanded:optionsOpen}} onPress={()=>setOptionsOpen(!optionsOpen)} style={{minHeight:44,flexDirection:'row',alignItems:'center',gap:7,borderTopWidth:1,borderTopColor:colors.border}}><Ionicons name={optionsOpen?'chevron-up':'add-outline'} color={colors.primary} size={19}/><Text style={{color:colors.primary,fontSize:13,fontWeight:'600'}}>Link a savings goal</Text></Pressable>
    {optionsOpen&&<Dropdown label="Savings goal" value={goalId??''} options={[{value:'',label:'No linked goal'},...eligibleGoals.map(goal=>({value:goal.id,label:goal.name}))]} onChange={value=>setGoalId(value||null)}/>}
    <Row style={{gap:6}}><Ionicons name={snapshot.profile?.notificationsEnabled?'notifications-outline':'notifications-off-outline'} color={colors.muted} size={18}/><Text style={{flex:1,color:colors.muted,fontSize:12}}>{snapshot.profile?.notificationsEnabled?'Phone alerts are on':'Phone alerts are off'}</Text>{!snapshot.profile?.notificationsEnabled?<Button title="Enable alerts" variant="ghost" disabled={task.pending} onPress={()=>void task.run(async()=>{if(!(await requestNotificationPermission()))throw new Error('Allow notifications in phone Settings to receive alerts.');await mutate(()=>repo.updateProfile({notificationsEnabled:true}));})}/>:<Button title="Alert settings" variant="ghost" onPress={()=>router.push('/settings')}/>}</Row>
  </Page>;
}
