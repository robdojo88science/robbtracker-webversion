import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Linking, Pressable, Switch, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useApp } from '../state/AppProvider';
import { Page, Button, ErrorMessage, Field, GlassSurface, Toast } from '../ui/components';
import { SettingsBackground, SettingsForm, SettingsGroup, SettingsHeading, SettingsRow, SettingsSearch } from '../ui/settings';
import { homeShortcuts } from '../ui/homeShortcuts';
import { useTheme } from '../ui/theme';
import { formatMoney, parseMoney } from '../core/money';
import { monthKey } from '../core/dates';
import { cancelAll, getNotificationStatus, requestNotificationPermission, sendTestNotification } from '../platform/notifications';
import { shareBackup, shareCsv, shareWorkbook, pickBackup } from '../platform/files';
import { appBuildLabel } from '../platform/buildInfo';

const errorText = (reason: unknown) => reason instanceof Error ? reason.message : 'This action could not be completed. Please try again.';
const GREEN = '#34C759';
const APPEARANCES = { system: 'Automatic', light: 'Light', dark: 'Dark' };
const SOUNDS = { default: 'Default', 'chime.wav': 'Chime', 'pop.wav': 'Pop', none: 'Silent' };
const PANELS = { appearance: 'Appearance', sounds: 'Sounds & haptics', notifications: 'Notifications', home: 'Home shortcuts', balance: 'Balance display', budget: 'Monthly budget', levels: 'Spending levels', alertSound: 'Alert sound' };
type Panel = keyof typeof PANELS;
const openPanel = (section: Panel) => router.push({ pathname: '/preferences/[section]', params: { section } });
const backToSettings = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/more');
function PhoneSwitch({ label, value, onChange, disabled }: { label: string; value: boolean; onChange(value: boolean): void; disabled?: boolean }) {
  return <Switch accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: GREEN }} />;
}
export function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange(value: boolean): void; disabled?: boolean }) {
  const { colors } = useTheme();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'space-between', minHeight: 48 }}><Text style={{ color: colors.text, fontSize: 15, flex: 1, lineHeight: 19 }}>{label}</Text><PhoneSwitch label={label} value={value} onChange={onChange} disabled={disabled} /></View>;
}

type MenuItem = { title: string; icon: React.ComponentProps<typeof Ionicons>['name']; tint: string; path?: string; panel?: Panel; value?: string; words?: string };
export function MoreScreen() {
  const { snapshot, notificationError } = useApp(), { colors } = useTheme();
  const profile = snapshot.profile;
  const [search, setSearch] = useState(''), [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => setAvatarFailed(false), [profile?.avatarUri]);
  const sections: { title: string; items: MenuItem[] }[] = [
    { title: 'Personalize', items: [
      { title: 'Appearance', icon: 'contrast', tint: '#007AFF', panel: 'appearance', value: APPEARANCES[profile?.appearance ?? 'system'], words: 'display light dark automatic theme' },
      { title: 'Sounds & haptics', icon: 'volume-high', tint: '#FF2D55', panel: 'sounds', value: profile?.transactionSounds ? 'On' : 'Off', words: 'vibration feedback' },
      { title: 'Home shortcuts', icon: 'apps', tint: '#5856D6', panel: 'home', words: 'customize order quick links' },
    ] },
    { title: 'Privacy & alerts', items: [
      { title: 'Notifications', icon: 'notifications', tint: '#FF453A', panel: 'notifications', value: profile?.notificationsEnabled ? 'On' : 'Off' },
      { title: 'Action PIN', icon: 'key', tint: '#007AFF', path: '/security', words: 'security recovery password' },
      { title: 'Offline chat', icon: 'sparkles', tint: '#AF52DE', path: '/ai-settings', value: 'On device', words: 'intelligence apple ai' },
    ] },
    { title: 'Your money', items: [
      { title: 'Wallets & accounts', icon: 'wallet', tint: '#5856D6', path: '/accounts', value: String(snapshot.accounts.filter(item => !item.deletedAt).length), words: 'currency transfers money' },
      { title: 'Balance display', icon: 'eye', tint: '#30B0C7', panel: 'balance', value: profile?.hideBalance ? 'Hidden' : 'Visible', words: 'hide rename available money' },
      { title: 'Monthly budget', icon: 'pie-chart', tint: GREEN, panel: 'budget', words: 'spending limit performance levels' },
      { title: 'Categories', icon: 'grid', tint: '#FF9500', path: '/categories', value: String(snapshot.categories.filter(item => !item.deletedAt).length) },
      { title: 'Tags', icon: 'pricetags', tint: '#30B0C7', path: '/tags', value: String(snapshot.tags.filter(item => !item.deletedAt).length) },
    ] },
    { title: 'Tools & records', items: [
      { title: 'Reminders', icon: 'list', tint: '#FF9500', path: '/reminders', value: String(snapshot.reminders.filter(item => !item.deletedAt && item.status === 'active').length), words: 'bills upcoming' },
      { title: 'Quick chat', icon: 'chatbubbles', tint: GREEN, path: '/assistant', value: 'Offline' },
      { title: 'Import spreadsheet', icon: 'document-text', tint: '#34A853', path: '/import', words: 'excel csv google sheets' },
      { title: 'Activity history', icon: 'time', tint: '#30B0C7', path: '/audit', words: 'audit trail' },
      { title: 'Backup & data', icon: 'archive', tint: '#007AFF', path: '/data', words: 'export restore reset delete xlsx csv files' },
    ] },
    { title: 'Help', items: [
      { title: 'Install & share', path: '/install', icon: 'share', tint: '#007AFF', words: 'home screen iphone ipad offline app link update' },
      { title: 'App guide', icon: 'book', tint: '#8E8E93', path: '/help', words: 'help faq' },
      { title: 'Welcome tour', icon: 'compass', tint: '#007AFF', path: '/tutorial', words: 'tips first use' },
    ] },
  ];
  const query = search.trim().toLowerCase();
  const extra: MenuItem[] = Object.entries(PANELS).map(([panel, title]) => ({ title, panel: panel as Panel, icon: panel === 'budget' ? 'pie-chart' : panel === 'appearance' ? 'contrast' : 'options', tint: '#007AFF' }));
  const searchable = [...new Map([...extra, ...sections.flatMap(section => section.items)].map(item => [item.title, item])).values()];
  const visible = query ? [{ title: 'Search results', items: searchable.filter(item => `${item.title} ${item.words ?? ''}`.toLowerCase().includes(query)) }] : sections;
  const anyResults = visible.some(section => section.items.length);
  return <Page compact maxWidth={1140} background={<SettingsBackground />}>
    <SettingsHeading title="Settings" /><SettingsSearch value={search} onChange={setSearch} />
    {!query && <GlassSurface blur style={{ marginTop: 2 }}><Pressable accessibilityRole="button" accessibilityLabel="Edit your profile" onPress={() => router.push('/profile')} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 66 }}>{profile?.avatarUri && !avatarFailed ? <Image source={{ uri: profile.avatarUri }} onError={() => setAvatarFailed(true)} style={{ width: 58, height: 58, borderRadius: 29 }} /> : <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.primary, fontSize: 27, fontWeight: '700' }}>{profile?.displayName.charAt(0).toUpperCase() || 'R'}</Text></View>}<View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.text, fontSize: 20, fontWeight: '600', letterSpacing: -0.4 }}>{profile?.displayName}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>Profile & personal details</Text></View><Ionicons name="chevron-forward" size={16} color={colors.muted} /></Pressable></GlassSurface>}
    {visible.filter(section => section.items.length).map(section => <SettingsGroup key={section.title} title={section.title}>{section.items.map(item => <SettingsRow key={item.title} title={item.title} icon={item.icon} tint={item.tint} value={item.value} onPress={() => item.panel ? openPanel(item.panel) : router.push(item.path as never)} />)}</SettingsGroup>)}
    {!anyResults && <Text style={{ color: colors.muted, fontSize: 14, padding: 14 }}>No matching settings.</Text>}
    <ErrorMessage message={notificationError} />
    {!query && <View style={{ alignItems: 'center', gap: 4, paddingVertical: 12 }}><Text style={{ color: colors.muted, fontSize: 11 }}>Robb Tracker · Stored on this device</Text><Text selectable style={{ color: colors.muted, fontSize: 10 }}>{appBuildLabel()}</Text></View>}
  </Page>;
}

function AppearanceChoice({ label, mode, selected, disabled, onPress }: { label: string; mode: 'system' | 'light' | 'dark'; selected: boolean; disabled: boolean; onPress(): void }) {
  const { colors } = useTheme();
  const dark = mode === 'dark', background = dark ? '#111A2A' : '#EEF2F8', surface = dark ? '#243247' : '#FFFFFF';
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} accessibilityLabel={`${label} appearance`} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ flex: 1, alignItems: 'center', paddingVertical: 16, gap: 9, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 })}><View style={{ width: 76, height: 113, backgroundColor: background, borderRadius: 3, borderWidth: selected ? 2 : 1, borderColor: selected ? colors.primary : colors.border, overflow: 'hidden', padding: 6, gap: 5 }}><View style={{ height: 28, backgroundColor: mode === 'system' ? '#93ACE4' : '#147DF5', marginHorizontal: -6, marginTop: -6, marginBottom: 6, paddingTop: 9, paddingHorizontal: 7 }}><View style={{ height: 4, width: 30, backgroundColor: '#FFFFFF88' }} /></View>{[0, 1, 2].map(index => <View key={index} style={{ height: 13, backgroundColor: surface, flexDirection: 'row', gap: 4, alignItems: 'center', paddingHorizontal: 4 }}><View style={{ width: 5, height: 5, backgroundColor: ['#FF9500', '#34C759', '#AF52DE'][index] }} /><View style={{ height: 2, width: 30, backgroundColor: dark ? '#92A1B3' : '#BBC5D4' }} /></View>)}{mode === 'system' && <View style={{ position: 'absolute', top: 28, right: 0, bottom: 0, width: 23, backgroundColor: '#12223EAA' }} />}</View><Text style={{ color: colors.text, fontSize: 13 }}>{label}</Text><Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? colors.primary : colors.muted} /></Pressable>;
}

export function PreferencesScreen() {
  const { repo, snapshot, mutate, busy, notificationError } = useApp(), { colors } = useTheme();
  const params = useLocalSearchParams<{ section?: string }>();
  const panel: Panel | null = typeof params.section === 'string' && Object.hasOwn(PANELS, params.section) ? params.section as Panel : null;
  const profile = snapshot.profile!, month = monthKey();
  const applicableBudget = [...snapshot.budgets].filter(item => !item.deletedAt && item.month <= month).sort((a, b) => b.month.localeCompare(a.month))[0];
  const originalBudget = ((applicableBudget?.amountMinor ?? 0) / 100).toFixed(2), originalThresholds = profile.performanceThresholds.map(value => String(Math.round(value * 100))).join(', ');
  const [label, setLabel] = useState(profile.balanceLabel), [budget, setBudget] = useState(originalBudget), [thresholds, setThresholds] = useState(originalThresholds);
  const [error, setError] = useState(''), [saved, setSaved] = useState(''), [shortcuts, setShortcuts] = useState<string[]>(profile.homeShortcuts);
  const [notificationStatus, setNotificationStatus] = useState<Awaited<ReturnType<typeof getNotificationStatus>> | null>(null);
  const [statusUnavailable, setStatusUnavailable] = useState(false), [statusVersion, setStatusVersion] = useState(0);
  const actionGate = useRef(false);
  useFocusEffect(useCallback(() => {
    if (panel !== 'notifications') return;
    let active = true;
    const refresh = () => void getNotificationStatus().then(status => { if (active) { setNotificationStatus(status); setStatusUnavailable(false); } }).catch(() => { if (active) { setNotificationStatus(null); setStatusUnavailable(true); } });
    refresh(); const timer = setTimeout(refresh, 800);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { active = false; clearTimeout(timer); listener.remove(); };
  }, [panel, profile.notificationsEnabled, profile.dailySummaryEnabled, statusVersion]));
  useEffect(() => { if (!saved) return; const timer = setTimeout(() => setSaved(''), 3500); return () => clearTimeout(timer); }, [saved]);
  const act = async (work: () => Promise<void>, message = 'Preferences updated') => {
    if (actionGate.current) return;
    actionGate.current = true; setError(''); setSaved('');
    try { await mutate(work); setSaved(message); } catch (reason) { setError(errorText(reason)); }
    finally { actionGate.current = false; }
  };
  const saveBudget = () => act(async () => { const amount = parseMoney(budget, true); await repo.setBudget(amount, month); setBudget((amount / 100).toFixed(2)); }, 'Monthly budget updated');
  const saveThresholds = () => act(async () => {
    const values = thresholds.split(',').map(value => { const text = value.trim(); if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Enter five increasing percentages separated by commas.'); return Number(text) / 100; });
    await repo.updateProfile({ performanceThresholds: values });
  }, 'Spending levels updated');
  const notifications = (enabled: boolean) => act(async () => { if (enabled && !(await requestNotificationPermission())) throw new Error('Allow browser notifications to receive alerts while this app is open.'); await repo.updateProfile({ notificationsEnabled: enabled }); }, 'Notification preference updated');
  const rowSwitch = (title: string, icon: React.ComponentProps<typeof Ionicons>['name'], tint: string, value: boolean, onChange: (enabled: boolean) => void) => <SettingsRow title={title} icon={icon} tint={tint} control={<PhoneSwitch label={title} value={value} onChange={onChange} disabled={busy} />} />;
  let content: React.ReactNode;
  let footer: React.ReactNode;
  if (panel === 'appearance') content = <><SettingsGroup><View accessibilityRole="radiogroup" style={{ flexDirection: 'row', paddingHorizontal: 4 }}>{(['system', 'light', 'dark'] as const).map(appearance => <AppearanceChoice key={appearance} label={APPEARANCES[appearance]} mode={appearance} selected={profile.appearance === appearance} disabled={busy} onPress={() => { if (profile.appearance !== appearance) void act(() => repo.updateProfile({ appearance })); }} />)}</View></SettingsGroup><Text style={{ color: colors.muted, fontSize: 12, lineHeight: 16, paddingHorizontal: 10 }}>Automatic follows your iPhone appearance.</Text></>;
  else if (panel === 'sounds') content = <><SettingsGroup title="Feedback">{rowSwitch('Tap vibrations', 'hand-left', '#AF52DE', profile.hapticsEnabled, hapticsEnabled => void act(() => repo.updateProfile({ hapticsEnabled })))}{rowSwitch('Transaction sounds', 'volume-high', '#FF2D55', profile.transactionSounds, transactionSounds => void act(() => repo.updateProfile({ transactionSounds })) )}</SettingsGroup><SettingsGroup title="Alerts"><SettingsRow title="Alert sound" icon="musical-notes" tint="#FF2D55" value={SOUNDS[profile.notificationSound]} onPress={() => openPanel('alertSound')} /><SettingsRow title="Play test alert" icon="play" tint="#FF9500" disabled={busy} onPress={() => void sendTestNotification(profile.notificationSound).then(() => setSaved('Test alert arrives in 5 seconds')).catch(reason => setError(errorText(reason)))} /></SettingsGroup></>;
  else if (panel === 'alertSound') content = <SettingsGroup footer="Your iPhone also controls silent mode and Focus.">{(Object.keys(SOUNDS) as (keyof typeof SOUNDS)[]).map(sound => <SettingsRow key={sound} title={SOUNDS[sound]} chevron={false} checked={profile.notificationSound === sound} disabled={busy} control={profile.notificationSound === sound ? <Ionicons name="checkmark" size={21} color={colors.primary} /> : undefined} onPress={() => { if (profile.notificationSound !== sound) void act(() => repo.updateProfile({ notificationSound: sound }), 'Alert sound updated'); }} />)}</SettingsGroup>;
  else if (panel === 'balance') { content = <><SettingsGroup title="Name"><SettingsForm><Field label="Balance label" value={label} onChangeText={setLabel} placeholder="My available money" maxLength={60} /></SettingsForm></SettingsGroup><SettingsGroup>{rowSwitch('Hide balance amounts', 'eye-off', '#5856D6', profile.hideBalance, hideBalance => void act(() => repo.updateProfile({ hideBalance })))}<SettingsRow title="Main currency" icon="cash" tint={GREEN} value={profile.baseCurrency} /><SettingsRow title="Wallets & currencies" icon="wallet" tint="#5856D6" onPress={() => router.push('/accounts')} /></SettingsGroup></>; footer = <Button title="Save balance name" loading={busy} disabled={!label.trim() || label.trim() === profile.balanceLabel} onPress={() => void act(() => repo.updateProfile({ balanceLabel: label.trim() }), 'Balance name updated')} />; }
  else if (panel === 'budget') { content = <><SettingsGroup title="Spending limit" footer={`Applies from ${new Date(month + '-01T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} until you change it.`}><SettingsForm><Field label={`Monthly budget · ${profile.baseCurrency}`} keyboardType="decimal-pad" value={budget} onChangeText={setBudget} placeholder="0.00" style={{ fontSize: 30, lineHeight: 36, minHeight: 56, fontWeight: '600' }} /></SettingsForm></SettingsGroup><SettingsGroup><SettingsRow title="Spending levels" icon="speedometer" tint="#FF9500" value="6 levels" onPress={() => openPanel('levels')} /><SettingsRow title="View performance" icon="bar-chart" tint="#007AFF" onPress={() => router.push('/(tabs)/performance')} /></SettingsGroup></>; let unchanged = false; try { unchanged = parseMoney(budget, true) === (applicableBudget?.amountMinor ?? 0); } catch { /* Incomplete edits stay visible for validation. */ } footer = <Button title="Save monthly budget" loading={busy} disabled={unchanged} onPress={() => void saveBudget()} />; }
  else if (panel === 'levels') { content = <SettingsGroup footer="Five increasing percentages define your six spending levels."><SettingsForm><Field label="Level boundaries (%)" value={thresholds} onChangeText={setThresholds} placeholder="25, 50, 75, 100, 125" /><Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17 }}>Sobrang Tipid · Tipid · Sakto Lang · Medyo Magastos Na · Magastos Na · Sobrang Gastos Na</Text></SettingsForm></SettingsGroup>; footer = <Button title="Save spending levels" loading={busy} disabled={thresholds === originalThresholds} onPress={() => void saveThresholds()} />; }
  else if (panel === 'home') { content = <><SettingsGroup title="Visible on Home" footer="Selected shortcuts appear in the order below.">{homeShortcuts.map(shortcut => <SettingsRow key={shortcut.key} title={shortcut.title} chevron={false} checked={shortcuts.includes(shortcut.key)} disabled={busy} icon={shortcut.icon} tint="#007AFF" onPress={() => setShortcuts(items => items.includes(shortcut.key) ? items.filter(key => key !== shortcut.key) : [...items, shortcut.key])} control={<Ionicons name={shortcuts.includes(shortcut.key) ? 'checkmark-circle' : 'ellipse-outline'} size={21} color={shortcuts.includes(shortcut.key) ? colors.primary : colors.muted} />} />)}</SettingsGroup>{shortcuts.length > 0 && <SettingsGroup title="Order">{shortcuts.map((key, index) => <SettingsRow key={key} title={homeShortcuts.find(item => item.key === key)?.title ?? key} value={String(index + 1)} control={<View style={{ flexDirection: 'row' }}>{([-1, 1] as const).map(direction => <Pressable key={direction} accessibilityRole="button" accessibilityLabel={`Move ${homeShortcuts.find(item => item.key === key)?.title} ${direction < 0 ? 'up' : 'down'}`} disabled={busy || index + direction < 0 || index + direction >= shortcuts.length} onPress={() => setShortcuts(items => { const next = [...items]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; })} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: index + direction < 0 || index + direction >= shortcuts.length ? 0.25 : 1 }}><Ionicons name={direction < 0 ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} /></Pressable>)}</View>} />)}</SettingsGroup>}</>; footer = <Button title="Save Home shortcuts" loading={busy} disabled={JSON.stringify(shortcuts) === JSON.stringify(profile.homeShortcuts)} onPress={() => void act(() => repo.updateProfile({ homeShortcuts: shortcuts }), 'Home shortcuts updated')} />; }
  else if (panel === 'notifications') content = <><SettingsGroup>{rowSwitch('Allow notifications', 'notifications', '#FF453A', profile.notificationsEnabled, enabled => void notifications(enabled))}{rowSwitch('Daily spending summary', 'moon', '#5856D6', profile.dailySummaryEnabled, dailySummaryEnabled => void act(() => repo.updateProfile({ dailySummaryEnabled })))}<SettingsRow title="Summary time" icon="time" tint="#8E8E93" value="11:59:59 PM" /><SettingsRow title="Alert sound" icon="musical-notes" tint="#FF2D55" value={SOUNDS[profile.notificationSound]} onPress={() => openPanel('alertSound')} /></SettingsGroup><SettingsGroup title="Delivery" footer="Alerts require this web app to stay open. Offline alerts after closing it are unavailable."><SettingsRow title="Phone permission" onPress={statusUnavailable ? () => { setStatusUnavailable(false); setStatusVersion(value => value + 1); } : undefined} value={statusUnavailable ? 'Unavailable - retry' : notificationStatus ? notificationStatus.granted ? 'Allowed' : 'Off' : 'Checking…'} /><SettingsRow title="Scheduled alerts" value={statusUnavailable ? 'Unavailable' : notificationStatus ? `${notificationStatus.pendingReminders + notificationStatus.pendingSummaries}` : '—'} /><SettingsRow title="Summary & details" icon="information-circle" tint="#007AFF" onPress={() => router.push('/notifications')} /><SettingsRow title="Send test alert" icon="play" tint="#FF9500" disabled={busy} onPress={() => void sendTestNotification(profile.notificationSound).then(() => setSaved('Test alert arrives in 5 seconds')).catch(reason => setError(errorText(reason)))} /><SettingsRow title="Browser notification settings" icon="settings" tint="#8E8E93" onPress={() => void Linking.openSettings().catch(reason => setError(errorText(reason)))} /></SettingsGroup></>;
  else content = <><SettingsGroup title="Look & feel"><SettingsRow title="Appearance" icon="contrast" tint="#007AFF" value={APPEARANCES[profile.appearance]} onPress={() => openPanel('appearance')} /><SettingsRow title="Sounds & haptics" icon="volume-high" tint="#FF2D55" value={profile.transactionSounds ? 'On' : 'Off'} onPress={() => openPanel('sounds')} /><SettingsRow title="Home shortcuts" icon="apps" tint="#5856D6" value={String(profile.homeShortcuts.length)} onPress={() => openPanel('home')} /></SettingsGroup><SettingsGroup title="Your money"><SettingsRow title="Balance display" icon="eye" tint="#30B0C7" value={profile.hideBalance ? 'Hidden' : 'Visible'} onPress={() => openPanel('balance')} /><SettingsRow title="Monthly budget" icon="pie-chart" tint={GREEN} value={formatMoney(applicableBudget?.amountMinor ?? 0, profile.baseCurrency)} onPress={() => openPanel('budget')} /><SettingsRow title="Spending levels" icon="speedometer" tint="#FF9500" value="6 levels" onPress={() => openPanel('levels')} /></SettingsGroup><SettingsGroup title="Privacy & alerts"><SettingsRow title="Notifications" icon="notifications" tint="#FF453A" value={profile.notificationsEnabled ? 'On' : 'Off'} onPress={() => openPanel('notifications')} /><SettingsRow title="Action PIN" icon="key" tint="#007AFF" onPress={() => router.push('/security')} /><SettingsRow title="Offline chat" icon="sparkles" tint="#AF52DE" value="On device" onPress={() => router.push('/ai-settings')} /></SettingsGroup></>;
  return <Page compact maxWidth={1140} background={<SettingsBackground />} header={<SettingsHeading title={panel ? PANELS[panel] : 'Preferences'} onBack={backToSettings} />} footer={footer ? <View style={{ gap: 5 }}><ErrorMessage message={error} />{footer}</View> : undefined}><Toast message={saved} />{content}{!footer && <ErrorMessage message={error} />}<ErrorMessage message={notificationError} /></Page>;
}

export function DataScreen() {
  const { snapshot, repo, mutate, busy } = useApp();
  const { colors } = useTheme();
  const [working, setWorking] = useState(false), [confirmation, setConfirmation] = useState(''), [showReset, setShowReset] = useState(false);
  const [error, setError] = useState(''), [saved, setSaved] = useState('');
  const actionGate = useRef(false);
  const act = async (work: () => Promise<void | boolean>, message: string) => { if (actionGate.current) return; actionGate.current = true; setWorking(true); setError(''); setSaved(''); try { const result = await work(); if (result !== false) setSaved(message); } catch (reason) { setError(errorText(reason)); } finally { actionGate.current = false; setWorking(false); } };
  const restore = () => void act(async () => {
    const backup = await pickBackup(); if (backup === null) return false;
    const confirmed = await new Promise<boolean>(resolve => Alert.alert('Replace your current tracker?', 'The backup replaces the records on this phone. Save a current backup first if you want to keep it. Invalid files leave your records unchanged.', [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, { text: 'Restore backup', onPress: () => resolve(true) }], { cancelable: true, onDismiss: () => resolve(false) }));
    if (!confirmed) return false;
    await mutate(() => repo.restoreBackup(backup, true));
  }, 'Backup restored');
  const erase = () => Alert.alert('Delete this local tracker?', 'This removes records and history from this phone. Save a backup first. This action cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete local tracker', style: 'destructive', onPress: () => void act(async () => { if (confirmation !== 'DELETE') throw new Error('Type DELETE to confirm.'); await cancelAll(); await mutate(() => repo.clearAllData()); }, '') }]);
  return <Page compact maxWidth={1140} background={<SettingsBackground />} header={<SettingsHeading title="Backup & data" onBack={backToSettings} />} footer={working ? <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44 }}><ActivityIndicator color={colors.primary} /><Text style={{ color: colors.text, fontSize: 14 }}>Working...</Text></View> : undefined}><Toast message={saved} /><SettingsGroup title="Your backup" footer="A JSON backup contains the complete tracker. Shared files are readable; save them somewhere private."><SettingsRow title="Save backup to Files" icon="cloud-download" tint="#007AFF" disabled={working || busy} onPress={() => void act(async () => { await shareBackup(await repo.createBackup()); await mutate(() => repo.logSystem('backup_exported')); }, 'Backup share sheet opened')} /><SettingsRow title="Restore from Files" icon="folder-open" tint="#FF9500" disabled={working || busy} onPress={restore} /></SettingsGroup><SettingsGroup title="Spreadsheets" footer="Excel and Google Sheets can edit your exported ledger."><SettingsRow title="Export Excel workbook" icon="document-text" tint="#34A853" value=".xlsx" disabled={working || busy} onPress={() => void act(async () => { await shareWorkbook(snapshot); await mutate(() => repo.logSystem('xlsx_exported')); }, 'Excel share sheet opened')} /><SettingsRow title="Export CSV" icon="document" tint="#30B0C7" value=".csv" disabled={working || busy} onPress={() => void act(async () => { await shareCsv(snapshot); await mutate(() => repo.logSystem('csv_exported')); }, 'CSV share sheet opened')} /><SettingsRow title="Import spreadsheet" icon="cloud-upload" tint="#34A853" disabled={working || busy} onPress={() => router.push('/import')} /></SettingsGroup><SettingsGroup title="Reset"><SettingsRow title="Delete local tracker" icon="trash" tint="#FF453A" destructive disabled={working || busy} onPress={() => setShowReset(!showReset)} />{showReset && <SettingsForm><Field label="Type DELETE to confirm" value={confirmation} onChangeText={setConfirmation} autoCapitalize="characters" autoCorrect={false} /><Button title="Delete local tracker" variant="danger" onPress={erase} disabled={confirmation !== 'DELETE' || working || busy} /></SettingsForm>}</SettingsGroup><ErrorMessage message={error} /></Page>;
}
