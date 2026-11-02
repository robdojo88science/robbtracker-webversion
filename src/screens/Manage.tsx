import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useApp } from '../state/AppProvider';
import { computeAccountBalances } from '../core/analytics';
import { formatMoney, isCurrencyCode, parseMoney } from '../core/money';
import { Account, Category, Tag } from '../core/types';
import { chooseProfilePhoto } from '../platform/profile';
import { goToTransactions } from '../platform/navigation';
import { transactionFeedback } from '../platform/feedback';
import { Button, Card, Chip, CurrencyField, Dropdown, Empty, ErrorMessage, Field, Page, Row, Section, Toast, useTheme } from '../ui/components';
import { Toggle } from './Settings';
import { useTask } from '../ui/forms';

const palette = ['#007DFE', '#7C5CFC', '#19A779', '#F29A28', '#E55D87', '#18A8BC', '#EF6559', '#7186A1'];
function Note({ children }: { children: React.ReactNode }) { const { colors } = useTheme(); return <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}>{children}</Text>; }
function ColorPicker({ value, onChange }: { value: string; onChange(value: string): void }) { return <Row style={{ flexWrap: 'wrap' }}>{palette.map(color => <Pressable key={color} accessibilityRole="button" accessibilityLabel={`Choose color ${color}`} accessibilityState={{ selected: value === color }} onPress={() => onChange(color)} style={{ width: 34, height: 34, borderRadius:3, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>{value === color && <Ionicons name="checkmark" color="white" size={22} />}</Pressable>)}</Row>; }

export function ProfileScreen() {
  const { snapshot, repo, mutate } = useApp();
  const { colors } = useTheme();
  const profile = snapshot.profile!;
  const [name, setName] = useState(profile.displayName);
  const [avatar, setAvatar] = useState(profile.avatarUri);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [saved, setSaved] = useState('');
  const task = useTask();
  useEffect(() => { if (!saved) return; const timer = setTimeout(() => setSaved(''), 3500); return () => clearTimeout(timer); }, [saved]);
  const changed = name.trim() !== profile.displayName || avatar !== profile.avatarUri;
  return <Page safeTop={false} title="Your profile" subtitle="A familiar face for your money space." maxWidth={560}>
    <Toast message={saved} /><Card><View style={{ alignItems: 'center', gap: 16, paddingVertical: 14 }}>{avatar && !avatarFailed ? <Image source={{ uri: avatar }} onError={() => setAvatarFailed(true)} style={{ width: 112, height: 112, borderRadius:56 }} /> : <View style={{ width: 112, height: 112, borderRadius:56, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.primary, fontSize: 46, fontWeight: '800' }}>{name.charAt(0).toUpperCase() || 'R'}</Text></View>}<Button title="Choose profile photo" icon="camera-outline" variant="secondary" onPress={() => void task.run(async () => { const uri = await chooseProfilePhoto(); if (uri) { setAvatar(uri); setAvatarFailed(false); } })} disabled={task.pending} />{avatar && <Button title="Remove photo" variant="ghost" onPress={() => { setAvatar(null); setAvatarFailed(false); }} />}</View><Field label="Display name" value={name} onChangeText={setName} maxLength={60} placeholder="Your name" /><ErrorMessage message={task.error} /><Button title="Save profile" disabled={!changed || !name.trim()} loading={task.pending} onPress={() => void task.run(async () => { await mutate(() => repo.updateProfile({ displayName: name.trim(), avatarUri: avatar })); setSaved('Profile updated'); })} /><Note>Your photo is saved with your profile and included in new JSON backups. No upload or online account is needed.</Note></Card>
  </Page>;
}

export function AccountsScreen() {
  const { snapshot, repo, mutate } = useApp();
  const { colors } = useTheme();
  const [editing, setEditing] = useState<Account | null | undefined>(undefined);
  const [walletDraftId, setWalletDraftId] = useState('');
  const walletBalances = useMemo(() => computeAccountBalances(snapshot.transactions), [snapshot.transactions]);
  const [name, setName] = useState('');
  const [type, setType] = useState<'asset' | 'liability'>('asset');
  const [currency, setCurrency] = useState(snapshot.profile!.baseCurrency);
  const [rate, setRate] = useState('1');
  const [included, setIncluded] = useState(true);
  const [opening, setOpening] = useState('');
  const [color, setColor] = useState(palette[0]);
  const [saved, setSaved] = useState('');
  const [removing, setRemoving] = useState<Account | null>(null);
  const [destinationId, setDestinationId] = useState('');
  const task = useTask();
  const base = snapshot.profile!.baseCurrency;
  const accounts = useMemo(() => snapshot.accounts.filter(account => !account.deletedAt), [snapshot.accounts]);
  const start = (account: Account | null) => { setEditing(account); setWalletDraftId(account?.id ?? randomUUID()); setName(account?.name ?? ''); setType(account?.type ?? 'asset'); setCurrency(account?.currency ?? base); setRate(String(account?.exchangeRate ?? 1)); setIncluded(account?.includedInBalance ?? true); setOpening(''); setColor(account?.color ?? palette[0]); };
  const changed = editing === null || !!editing && (name.trim() !== editing.name || type !== editing.type || currency !== editing.currency || Number(rate) !== editing.exchangeRate || included !== editing.includedInBalance || color !== editing.color);
  const destinations = accounts.filter(account => account.type === 'asset' && account.id !== removing?.id);
  const removingBalance = removing ? (walletBalances.get(removing.id) ?? 0) : 0;
  const canMove = !!removing && removing.type === 'asset' && removingBalance > 0 && destinations.length > 0;
  const lastAsset = removing?.type === 'asset' && accounts.filter(account => account.type === 'asset').length <= 1;
  const remove = (account: Account) => {
    const options = accounts.filter(item => item.id !== account.id && item.type === 'asset');
    setDestinationId(options.find(item => item.name.toLowerCase() === 'cash')?.id ?? options[0]?.id ?? '');
    setRemoving(account); setEditing(undefined);
  };
  const confirmRemoval = (mode: 'transfer' | 'exclude') => {
    if (!removing) return;
    void task.run(async () => {
      let transactionId: string | undefined;
      await mutate(async () => { transactionId = await repo.deleteAccount(removing.id, { mode, destinationAccountId: mode === 'transfer' ? destinationId : undefined }); });
      setSaved(mode === 'transfer' ? 'Money moved and wallet removed' : 'Wallet removed from your total'); setRemoving(null);
      if (transactionId) { void transactionFeedback('transfer', snapshot.profile); goToTransactions(transactionId); }
    });
  };
  return <Page safeTop={false} compact title={removing ? 'Remove wallet' : 'Wallets'} maxWidth={1440} action={editing === undefined && !removing ? <Button title="Add" icon="add" onPress={() => start(null)} /> : undefined}>
    <Toast message={saved} />
    {/* Keep confirmation in the page so the action PIN has one native modal to present. */}
    {removing && <Card><Row style={{ justifyContent: 'space-between' }}><Text style={{ color: colors.text, fontSize: 20, fontWeight: '700', flex: 1 }}>{removing.name}</Text><Button title="Cancel" variant="ghost" disabled={task.pending} onPress={() => setRemoving(null)} /></Row><Text style={{ color: colors.text, fontSize: 28, fontWeight: '700' }}>{formatMoney(removingBalance, removing.currency)}</Text>
      <Note>Choose what happens to this balance. Your transactions and activity history stay saved.</Note>
      {canMove && <Dropdown label="Move money to" value={destinationId} options={destinations.map(account => ({ value: account.id, label: `${account.name} · ${account.currency}`, color: account.color }))} onChange={setDestinationId} />}
      <Button title="Move all money" icon="swap-horizontal-outline" loading={task.pending} disabled={!canMove || !destinationId || lastAsset} onPress={() => confirmRemoval('transfer')} />
      <Note>{canMove ? 'Transfers the full balance using your saved rates, then removes this wallet.' : 'Moving money needs a positive asset balance and another asset wallet.'}</Note>
      <Button title="Remove wallet" variant="danger" loading={task.pending} disabled={lastAsset} onPress={() => confirmRemoval('exclude')} />
      <Note>Excludes {formatMoney(removingBalance, removing.currency)} from your available balance. No transfer is created.</Note>
      {lastAsset && <Note>Add another asset wallet before removing your last one.</Note>}
      <ErrorMessage message={task.error} />
    </Card>}
    {editing !== undefined && <Card><Section title={editing ? `Edit ${editing.name}` : 'New wallet'}><Field label="Wallet name" value={name} onChangeText={setName} placeholder="Cash, BDO, Emergency Fund..." maxLength={60} /><Dropdown label="Type" value={type} onChange={value => setType(value as 'asset' | 'liability')} options={[{ value: 'asset', label: '💰 Asset · money you have' }, { value: 'liability', label: '💳 Liability · money you owe' }]} /><CurrencyField value={currency} existingCodes={[base,...snapshot.accounts.map(a=>a.currency)]} onChange={value=>{setCurrency(value);if(value===base)setRate('1');}}/>{currency !== base && <><Field label={`1 ${currency} equals how many ${base}?`} value={rate} onChangeText={setRate} keyboardType="decimal-pad" money={false} placeholder="Enter your own exchange rate" /><Note>Manual rate · all amounts use two decimal places.</Note></>}{!editing && <Field label={`${type === 'liability' ? 'Amount currently owed' : 'Opening amount'} · ${currency}`} value={opening} onChangeText={setOpening} keyboardType="decimal-pad" placeholder="0.00" />}<Toggle label="Include in my main balance" value={included} onChange={setIncluded} /><Note>{included ? 'This wallet is included when Home adds up your assets and liabilities.' : 'Still visible in your wallets, but excluded from the Home total.'}</Note><ColorPicker value={color} onChange={setColor} /><ErrorMessage message={task.error} /><Button title={editing ? 'Save wallet changes' : 'Create wallet'} disabled={!name.trim() || !changed || !isCurrencyCode(currency)} loading={task.pending} onPress={() => void task.run(async () => { const amount = parseMoney(opening || '0', true); const savedAccountId=editing?.id ?? walletDraftId; await mutate(() => repo.saveAccount({ id: savedAccountId, name: name.trim(), type, currency, exchangeRate: currency === base ? 1 : Number(rate), includedInBalance: included, color, icon: type === 'liability' ? 'card-outline' : 'wallet-outline', ...(!editing ? { openingBalanceMinor: amount } : {}) })); const created = !editing && amount > 0 ? (await repo.queryTransactions({accountId:savedAccountId}))[0] : null; setEditing(undefined); setSaved(editing ? 'Wallet updated' : 'Wallet created'); if (created) { void transactionFeedback(created.kind, snapshot.profile); goToTransactions(created.id); } })} /><Button title="Cancel" variant="ghost" disabled={task.pending} onPress={() => setEditing(undefined)} /></Section></Card>}
    {!removing && editing===undefined && <View>{accounts.length ? accounts.map(account => <View key={account.id} style={{paddingVertical:10,borderBottomWidth:1,borderBottomColor:colors.border,gap:5}}><Row style={{gap:8}}><Ionicons name={account.type==='liability'?'card-outline':'wallet-outline'} color={account.color} size={23}/><View style={{flex:1,gap:3}}><Text style={{color:colors.text,fontSize:16,fontWeight:'700'}}>{account.name}</Text><Text style={{color:colors.muted,fontSize:12}}>{account.currency} · {account.type==='liability'?'Debt':account.includedInBalance?'Included':'Excluded'}</Text></View><Text numberOfLines={1} adjustsFontSizeToFit style={{color:(walletBalances.get(account.id) ?? 0)<0?colors.danger:colors.text,fontSize:18,fontWeight:'700',flexShrink:1}}>{formatMoney((walletBalances.get(account.id) ?? 0),account.currency)}</Text></Row><Row style={{gap:4}}><View style={{flex:1}}><Button title="Add money" variant="secondary" icon="add" disabled={task.pending} onPress={()=>router.push({pathname:'/transaction/new',params:{kind:'income',accountId:account.id}})}/></View><View style={{flex:1}}><Button title="Transfer" variant="ghost" icon="swap-horizontal-outline" disabled={task.pending||accounts.length<2} onPress={()=>router.push({pathname:'/transaction/new',params:{kind:'transfer',accountId:account.id}})}/></View><Pressable accessibilityRole="button" accessibilityLabel={`Edit ${account.name}`} disabled={task.pending} onPress={()=>start(account)} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="create-outline" size={21} color={colors.primary}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${account.name}`} disabled={task.pending} onPress={()=>remove(account)} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="trash-outline" size={21} color={colors.danger}/></Pressable></Row></View>) : <Empty title="Your first wallet" body="Add Cash, a bank account, or a fund." action={<Button title="Add a wallet" onPress={()=>start(null)}/>}/>}</View>}
    {editing === undefined && !removing && <ErrorMessage message={task.error} />}
  </Page>;
}

export function CategoriesScreen() { return <LabelsScreen mode="category" />; }
export function TagsScreen() { return <LabelsScreen mode="tag" />; }
function LabelsScreen({ mode }: { mode: 'category' | 'tag' }) {
  const { snapshot, repo, mutate } = useApp();
  const { colors } = useTheme();
  const [editing, setEditing] = useState<Category | Tag | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [color, setColor] = useState(palette[0]);
  const [saved, setSaved] = useState('');
  const task = useTask();
  const noun = mode === 'category' ? 'category' : 'tag';
  const items = (mode === 'category' ? snapshot.categories : snapshot.tags).filter(item => !item.deletedAt);
  const start = (item: Category | Tag | null) => { setEditing(item); setName(item?.name ?? ''); setColor(item?.color ?? palette[0]); };
  const changed = editing === null || !!editing && (name.trim() !== editing.name || color !== editing.color);
  const remove = (item: Category | Tag) => Alert.alert(`Remove “${item.name}”?`, `It won’t appear for new transactions. Existing records keep their ${noun} and history.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void task.run(async () => { await mutate(() => mode === 'category' ? repo.deleteCategory(item.id) : repo.deleteTag(item.id)); setSaved(`${mode === 'category' ? 'Category' : 'Tag'} removed`); }) }]);
  return <Page safeTop={false} title={mode === 'category' ? 'Expense categories' : 'Your tags'} subtitle={mode === 'category' ? 'Clear groups for where your money goes.' : 'Your own labels, easier searching and clearer graphs.'} maxWidth={660} action={editing === undefined ? <Button title="Add" icon="add" onPress={() => start(null)} /> : undefined}>
    <Toast message={saved} />
    <Card><Note>{mode === 'category' ? 'Choose one category for each expense, such as Food or Transport. Tap Edit to rename a category.' : 'Add several tags to an expense, such as Work, Travel, or Family. Filter your history and view a separate tag graph in Performance.'}</Note></Card>
    {editing !== undefined && <Card><Section title={editing ? `Edit ${noun}` : `New ${noun}`}><Field label={`${mode === 'category' ? 'Category' : 'Tag'} name`} value={name} onChangeText={setName} maxLength={60} placeholder={mode === 'category' ? 'e.g. Coffee & snacks' : 'e.g. Weekend trip'} /><ColorPicker value={color} onChange={setColor} /><ErrorMessage message={task.error} /><Button title={editing ? 'Save changes' : `Create ${noun}`} disabled={!changed || !name.trim()} loading={task.pending} onPress={() => void task.run(async () => { await mutate(() => mode === 'category' ? repo.saveCategory({ id: editing?.id, name: name.trim(), color, icon: 'pricetag-outline' }) : repo.saveTag({ id: editing?.id, name: name.trim(), color })); setEditing(undefined); setSaved(`${mode === 'category' ? 'Category' : 'Tag'} ${editing ? 'updated' : 'created'}`); })} /><Button title="Cancel" variant="ghost" disabled={task.pending} onPress={() => setEditing(undefined)} /></Section></Card>}
    <Card>{items.length ? items.map(item => <View key={item.id} style={{ gap: 10, paddingVertical: 8 }}><Row><View style={{ width: 12, height: 12, borderRadius:3, backgroundColor: item.color }} /><Text style={{ color: colors.text, fontWeight: '600', fontSize: 16, flex: 1 }}>{mode === 'tag' ? '#' : ''}{item.name}</Text><Button title="Edit" variant="ghost" onPress={() => start(item)} /><Button title="Remove" variant="ghost" disabled={task.pending} onPress={() => remove(item)} /></Row></View>) : <Empty title={`No ${noun}s yet`} body={`Create your first ${noun} to organize your spending.`} />}</Card>
    {editing === undefined && <ErrorMessage message={task.error} />}
  </Page>;
}



