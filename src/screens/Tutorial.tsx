import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Text, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AnimatedGradient, Button, ErrorMessage, Page, Row } from '../ui/components';
import { useTheme } from '../ui/theme';
import { useApp } from '../state/AppProvider';

const steps = [
  { icon: 'wallet-outline', eyebrow: 'YOUR MONEY', title: 'Every wallet, one view.', body: 'Name Cash, BDO, or any fund. Choose which wallets count toward your main balance.', target: 'Home → Wallets', route: '/accounts' },
  { icon: 'add-circle-outline', eyebrow: 'QUICK ENTRY', title: 'A few details. Done.', body: 'Enter the amount, description, wallet, and date. Tags and notes are there when you need them.', target: 'Home → Add transaction', route: '/transaction/new' },
  { icon: 'pie-chart-outline', eyebrow: 'SPENDING CLARITY', title: 'See where it went.', body: 'Pick a period, then view category or tag totals. Tap a chart point to see its value.', target: 'Performance', route: '/(tabs)/performance' },
  { icon: 'notifications-outline', eyebrow: 'A GENTLE NUDGE', title: 'Remember what matters.', body: 'Set reminders with your preferred sound. Your iPhone controls notification and Focus settings.', target: 'Coming up → Reminders', route: '/reminders' },
  { icon: 'download-outline', eyebrow: 'YOURS TO KEEP', title: 'Bring your history along.', body: 'Save a JSON backup to Files and restore it whenever you move to a new installation.', target: 'More → Backup & data', route: '/data' },
] as const;

export function TutorialScreen() {
  const { snapshot, repo, mutate, busy } = useApp(), { colors } = useTheme();
  const [step, setStep] = useState(0), [error, setError] = useState(''); const fade = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => { void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion); const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion); return () => listener.remove(); }, []);
  useEffect(() => { if (reduceMotion) { fade.setValue(1); return; } fade.setValue(0); const animation = Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }); animation.start(); return () => animation.stop(); }, [step, fade, reduceMotion]);
  const finish = async (route?: string) => {
    try { if (!snapshot.profile?.tutorialCompleted) await mutate(() => repo.updateProfile({ tutorialCompleted: true })); if (route) router.replace(route as any); else router.replace('/(tabs)'); }
    catch (e) { setError((e as Error).message); }
  };
  const current = steps[step];
  return <Page safeTop={false} compact maxWidth={720} footer={<View style={{ gap: 6 }}><Button title={step === steps.length - 1 ? 'Open my tracker' : 'Next tip'} onPress={() => step === steps.length - 1 ? void finish() : setStep(step + 1)} disabled={busy} /><Button title="Explore on my own" variant="ghost" disabled={busy} onPress={() => void finish()} /><ErrorMessage message={error} /></View>}>
    <Animated.View style={{ opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }], gap: 18 }}>
      <AnimatedGradient style={{ padding: 24, gap: 15 }}><Row style={{ justifyContent: 'space-between' }}><Ionicons name={current.icon} size={35} color="white" /><Text style={{ color: '#DCEBFF', fontSize: 12 }}>{step + 1} / {steps.length}</Text></Row><Text style={{ color: '#DCEBFF', fontSize: 10, letterSpacing: 2, fontWeight: '700' }}>{current.eyebrow}</Text><Text style={{ color: 'white', fontSize: 33, lineHeight: 37, fontWeight: '800', letterSpacing: -1 }}>{current.title}</Text><Text style={{ color: '#FFFFFF', fontSize: 15, lineHeight: 21 }}>{current.body}</Text></AnimatedGradient>
      <View style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 }}><Row><Ionicons name="arrow-up-outline" size={19} color={colors.primary} /><Text style={{ color: colors.text, fontSize: 15, fontWeight: '600', flex: 1 }}>{current.target}</Text></Row><Button title="Show me" variant="secondary" disabled={busy} onPress={() => void finish(current.route)} /></View>
      <Row style={{ justifyContent: 'center' }}>{steps.map((_, i) => <View key={i} style={{ height: 3, width: i === step ? 30 : 12, borderRadius: 3, backgroundColor: i === step ? colors.primary : colors.border }} />)}</Row>
      {step > 0 && <Button title="Previous tip" variant="ghost" onPress={() => setStep(step - 1)} />}
    </Animated.View>
  </Page>;
}
