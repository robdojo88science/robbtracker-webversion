import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DEFAULT_AI_PREFERENCES, type AIPreferences } from '../core/ai';
import { getAIStatus, saveAISettings, testAIProvider, type AIStatus } from '../platform/ai';
import { useApp } from '../state/AppProvider';
import { AnimatedGradient, Button, ErrorMessage, InfoButton, Page, Section, useTheme } from '../ui/components';
import { useTask } from '../ui/forms';
import { Toggle } from './Settings';

export function AISettingsScreen() {
  const { snapshot } = useApp(), { colors } = useTheme(), task = useTask();
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [preferences, setPreferences] = useState<AIPreferences>({ ...DEFAULT_AI_PREFERENCES });
  const [test, setTest] = useState('');
  const refresh = useCallback(async () => {
    const next = await getAIStatus();
    setStatus(next); setPreferences(next.preferences);
  }, []);
  useFocusEffect(useCallback(() => { void task.run(refresh); }, [refresh]));
  const setAppleEnabled = (enabled: boolean) => void task.run(async () => {
    const next: AIPreferences = { mode: enabled ? 'auto' : 'basic' };
    await saveAISettings(next);
    setPreferences(next); setTest('');
    setStatus(await getAIStatus(enabled));
  });
  return <Page safeTop={false} compact title="Offline chat" maxWidth={1440} action={<InfoButton compact title="Offline chat" message="Short entries use the fast local parser. This browser version uses the offline parser; Apple on-device intelligence is available only in the native app. Messages stay on this device. Every transaction waits for your review and confirmation." />}>
    <AnimatedGradient subtle style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Ionicons name="shield-checkmark-outline" color={colors.primary} size={26} />
      <View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>Ready without internet</Text><Text style={{ color: colors.muted, fontSize: 12, lineHeight: 16 }}>Quick entry and calculations run on your device.</Text></View>
    </AnimatedGradient>
    <ErrorMessage message={task.error || status?.warning} />
    <Section title="On-device intelligence">
      <Toggle label="Help with harder messages" value={preferences.mode === 'auto'} onChange={setAppleEnabled} disabled={!status?.apple.available || task.pending} />
      <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 17 }}>{status?.apple.message ?? 'Checking this device…'}</Text>
      <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 16 }}>Simple entries always take the fast path. Turn this off to use the local parser for every message.</Text>
      {status?.apple.available && preferences.mode === 'auto' && <Button title="Test on-device intelligence" variant="ghost" icon="sparkles-outline" disabled={task.pending} loading={task.pending} onPress={() => void task.run(async () => setTest(await testAIProvider(snapshot)))} />}
      {!!test && <Text accessibilityRole="alert" style={{ color: colors.success, fontSize: 13, lineHeight: 17 }}>{test}</Text>}
    </Section>
  </Page>;
}
