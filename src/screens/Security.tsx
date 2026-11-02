import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { actionPin } from '../platform/actionPin';
import { RECOVERY_QUESTIONS, type ActionPinState } from '../core/actionPin';
import { useActionPin } from '../state/ActionPinProvider';
import { Button, Card, ErrorMessage, Page, Section, Toast } from '../ui/components';
import { useTheme } from '../ui/theme';

export function SecurityScreen() {
  const security = useActionPin(), { colors } = useTheme();
  const [state, setState] = useState<ActionPinState | null>(null), [error, setError] = useState(''), [saved, setSaved] = useState(''), [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => { try { setState(await actionPin.getState()); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not read your action PIN.'); } }, []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const run = async (work: () => Promise<void>, message: string) => { setBusy(true); setError(''); setSaved(''); try { await work(); setSaved(message); } catch (reason) { setError(reason instanceof Error ? reason.message : 'The PIN could not be updated.'); } finally { await refresh(); setBusy(false); } };
  return <Page safeTop={false} title="Action PIN" subtitle="Protect changes. Keep everyday recording quick."><Toast message={saved} /><Card><Section title={state ? state.hasPin ? 'Your action PIN is ready' : 'Set up your action PIN' : 'Checking secure storage…'}><Text style={{ color: colors.muted, fontSize: 14, lineHeight: 19 }}>Your {state?.pinLength ?? 4}-digit PIN confirms edits and removals. New PINs use 4 digits; existing 6-digit PINs keep working until you change or recover them.</Text>{state?.hasPin ? <><Button title="Change PIN" icon="key-outline" disabled={busy} onPress={() => void run(security.changePin, 'Action PIN updated')} /><Button title="Forgot PIN?" variant="secondary" disabled={busy} onPress={() => void run(security.recoverPin, 'Action PIN recovered')} /><Button title="Change recovery questions" variant="secondary" disabled={busy} onPress={() => void run(security.manageRecovery, 'Recovery questions updated')} /></> : <Button title="Create PIN & recovery questions" disabled={busy || !state} onPress={() => void run(security.configure, 'Action PIN is ready')} />}</Section></Card>
    {state?.hasPin && <Card><Section title="Your recovery questions">{state.questionIds.map((id, index) => <View key={id} style={{ gap: 4 }}><Text style={{ color: colors.primary, fontSize: 12 }}>Question {index + 1}</Text><Text style={{ color: colors.text, fontSize: 14 }}>{RECOVERY_QUESTIONS.find(question => question.id === id)?.label}</Text></View>)}<Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>Either correct answer can reset a forgotten PIN. Answers ignore capitalization and extra spaces. Your PIN and answers stay in your phone’s secure storage and are excluded from backups.</Text></Section></Card>}
    <ErrorMessage message={error} />
  </Page>;
}
