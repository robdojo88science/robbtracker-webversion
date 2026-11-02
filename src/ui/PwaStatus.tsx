import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, ErrorMessage, GlassSurface, Page, Toast } from './components';
import { useTheme } from './theme';
import { useApp } from '../state/AppProvider';
import { webAppUrl, webPath } from '../platform/webPaths';

type PwaState = { ready: boolean; update: boolean; error: string; installed: boolean };
declare global { interface Window { __ROBB_PWA__?: PwaState; robbCheckUpdate?: () => Promise<void>; robbInstallUpdate?: () => void; } }
const initial = { ready: false, update: false, error: '', installed: false };
function usePwa() {
  const [state, setState] = useState<PwaState>(() => ({ ...(window.__ROBB_PWA__ ?? initial) }));
  useEffect(() => {
    const update = () => setState({ ...(window.__ROBB_PWA__ ?? initial) });
    window.addEventListener('robb-pwa', update); update();
    return () => window.removeEventListener('robb-pwa', update);
  }, []);
  return state;
}
export function PwaStatus() {
  const state = usePwa(), { colors } = useTheme();
  if (state.ready && !state.error && !state.update) return null;
  return <View style={{ backgroundColor: colors.primaryLight, paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
    <Text accessibilityLiveRegion="polite" style={{ flex: 1, fontSize: 12, color: colors.text }}>{state.error ? 'Offline setup needs another try' : state.update ? 'An app update is ready' : 'Preparing offline access...'}</Text>
    <Button title="Details" variant="ghost" onPress={() => window.location.assign(webPath('install'))} />
  </View>;
}
export function InstallScreen() {
  const state = usePwa(), { colors } = useTheme(), { busy, snapshot } = useApp();
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [checking, setChecking] = useState(false);
  const text = { color: colors.muted, fontSize: 14, lineHeight: 19 };
  const heading = { color: colors.text, fontWeight: '700' as const, fontSize: 17 };
  const share = async () => {
    setError(''); const url = webAppUrl();
    try {
      if (navigator.share) await navigator.share({ title: 'Robb Tracker', text: 'Your own offline money tracker. Open in Safari and add to Home Screen.', url });
      else { await navigator.clipboard.writeText(url); setMessage('App link copied'); }
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError('Use your browser Share menu to send this app link.');
    }
  };
  const checkUpdate = async () => {
    setChecking(true); setError('');
    try { if (!window.robbCheckUpdate) throw new Error(); await window.robbCheckUpdate(); setMessage('Update check complete'); }
    catch { setError('Connect to the internet to check for updates.'); }
    finally { setChecking(false); }
  };
  return <Page safeTop={!snapshot.profile} compact title="Install & share">
    {!snapshot.profile && <Button title="Back to app" variant="ghost" onPress={() => window.location.assign(webPath())} />}
    <Toast message={message} />
    <GlassSurface>
      <Text accessibilityRole="header" style={{ ...heading, color: state.ready ? colors.success : colors.text, fontSize: 19 }}>{state.ready ? 'Ready to use offline' : 'Preparing offline files'}</Text>
      <Text style={text}>The first visit and future updates need internet. Once this status is ready, your saved tracker and app screens work offline.</Text>
    </GlassSurface>
    <GlassSurface>
      <Text style={heading}>Add to your iPhone or iPad</Text>
      {['Open this link in Safari.', 'Tap Share, then Add to Home Screen.', 'Turn on Open as Web App if shown, then tap Add.', 'Open the new R icon and wait for offline setup to finish.'].map((step, index) => <Text key={index} style={{ color: colors.text, fontSize: 15, lineHeight: 21 }}>{index + 1}. {step}</Text>)}
      <Text style={{ ...text, fontSize: 13 }}>{state.installed ? 'This app is open from your Home Screen.' : 'Install from Safari for the best offline experience.'}</Text>
    </GlassSurface>
    <Button title="Share app link" icon="share-outline" onPress={() => void share()} />
    <GlassSurface>
      <Text style={heading}>Your device, your records</Text>
      <Text style={text}>Sharing the link shares the app only. Everyone starts with their own tracker and personal 4-digit action PIN. Save a JSON backup to Files before clearing website data or removing the app.</Text>
      {snapshot.profile && <Button title="Backup & data" variant="ghost" onPress={() => router.push('/data')} />}
    </GlassSurface>
    <GlassSurface>
      <Text style={heading}>Browser limits</Text>
      <Text style={text}>Reminders and summaries remain available in the app. Alerts require the app to stay open and browser support. Apple on-device AI is available only in the native app; this version keeps the fast offline chat parser, multiple entries and spending questions.</Text>
    </GlassSurface>
    {state.update ? <Button title="Install update & reopen" disabled={busy} onPress={() => window.robbInstallUpdate?.()} /> : <Button title="Check for updates" variant="secondary" loading={checking} disabled={busy} onPress={() => void checkUpdate()} />}
    <ErrorMessage message={error || state.error} />
  </Page>;
}