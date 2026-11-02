import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Animated, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '../state/AppProvider';
import { isCurrencyCode, parseMoney } from '../core/money';
import { pickBackup } from '../platform/files';
import { requestNotificationPermission } from '../platform/notifications';
import { AnimatedGradient, Button, CurrencyField, ErrorMessage, Field, Page, Progress, Row } from '../ui/components';
import { useTheme } from '../ui/theme';
import { BrandMark } from '../ui/BrandMark';
import { configureActionPin } from '../state/ActionPinProvider';

const headings = ['Your money. Your pace.', 'What should we call you?', 'Choose your main currency', 'Name your first wallet', 'How much is in it?', 'Your monthly budget?', 'Name your balance', 'Protect important changes', 'You’re ready, let’s go.'];
const hints = ['Is this your first time using Robb Tracker?', 'A personal welcome, every day.', 'You can add other currencies and set their rates later.', 'Cash, BDO, or any name you like.', 'Start with today’s amount, or zero.', 'Optional. Change it whenever you need.', 'This appears above your total on Home.', 'An action PIN protects edits and removals. Opening the app and adding transactions stay quick.', 'Saved on your phone. Ready when you are.'];

export function OnboardingScreen() {
  const { colors } = useTheme();
  const { repo, mutate, busy } = useApp();
  const [step, setStep] = useState(0), [returning, setReturning] = useState(false);
  const [name, setName] = useState(''), [currency, setCurrency] = useState('PHP');
  const [accountName, setAccountName] = useState('Cash'), [balanceLabel, setBalanceLabel] = useState('My available money');
  const [opening, setOpening] = useState(''), [budget, setBudget] = useState(''), [error, setError] = useState('');
  const [pinReady,setPinReady]=useState(false),[configuringPin,setConfiguringPin]=useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const motion = useRef(new Animated.Value(0)).current;
  useEffect(() => { void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion); const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion); return () => listener.remove(); }, []);
  useEffect(() => { setError(''); if (reduceMotion) { motion.setValue(1); return; } motion.setValue(0); const animation = Animated.timing(motion, { toValue: 1, duration: 240, useNativeDriver: true }); animation.start(); return () => animation.stop(); }, [step, returning, motion, reduceMotion]);
  const next = () => {
    try {
      if (step === 2 && !isCurrencyCode(currency)) throw new Error('Use a currency code with 3–8 letters or numbers, beginning with a letter.');
      if (step === 4) parseMoney(opening || '0', true);
      if (step === 5) parseMoney(budget || '0', true);
      setStep(value => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Check your answer.'); }
  };
  const create = async () => {
    setError('');
    try {
      if(!pinReady)throw new Error('Set your action PIN and recovery answers before creating your tracker.');
      await mutate(() => repo.setup({ displayName: name.trim() || 'My tracker', openingBalanceMinor: parseMoney(opening || '0', true), monthlyBudgetMinor: parseMoney(budget || '0', true), currency, accountName: accountName.trim() || 'Cash', balanceLabel: balanceLabel.trim() || 'My available money' }));
      try{const granted=await requestNotificationPermission();await mutate(()=>repo.updateProfile({notificationsEnabled:granted}));}catch{/* The tracker stays usable when permission is declined. */}
      router.replace('/(tabs)');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create your tracker.'); }
  };
  const restore = async () => {
    setError('');
    try {
      const backup = await pickBackup(); if (backup === null) return;
      await configureActionPin();setPinReady(true);
      await mutate(() => repo.restoreBackup(backup)); router.replace('/(tabs)');
      Alert.alert('Welcome back', 'Your records are ready.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not restore this backup.'); }
  };
  const setupPin=async()=>{setError('');setConfiguringPin(true);try{await configureActionPin();setPinReady(true);}catch(reason){setError(reason instanceof Error?reason.message:'Could not save your action PIN.');}finally{setConfiguringPin(false);}};
  const footer = step > 0 ? <View style={{ gap: 6 }}><ErrorMessage message={error} /><Button title={step === 8 ? 'Open my tracker' : step===7&&!pinReady?'Create action PIN':step === 5 && !budget ? 'Skip for now' : 'Continue'} icon={step === 8 ? 'sparkles-outline' : undefined} onPress={() => step === 8 ? void create() : step===7&&!pinReady?void setupPin():next()} disabled={busy||configuringPin} loading={busy||configuringPin} /><Button title="Back" variant="ghost" onPress={() => setStep(value => value - 1)} disabled={busy||configuringPin} /></View> : undefined;
  return <Page compact maxWidth={720} footer={footer}>
    <AnimatedGradient style={{ padding: 24, gap: 16, minHeight: 240 }}>
      <Row style={{ justifyContent: 'space-between' }}><Row style={{ gap: 9 }}><BrandMark onBlue /><Text style={{ color: 'white', fontSize: 17, fontWeight: '700', letterSpacing: -0.4 }}>Robb Tracker</Text></Row><Text style={{ color: '#CDE4FF', fontSize: 12 }}>{step + 1} / {headings.length}</Text></Row>
      <Animated.View style={{ opacity: motion, gap: 9, paddingTop: 14, transform: [{ translateY: motion.interpolate({ inputRange: [0, 1], outputRange: [9, 0] }) }] }}>
        <Text accessibilityRole="header" style={{ color: 'white', fontSize: step === 0 ? 39 : 31, lineHeight: step === 0 ? 43 : 35, fontWeight: '800', letterSpacing: -1 }}>{returning && step === 0 ? 'Welcome back.' : headings[step]}</Text>
        <Text style={{ color: '#E1EFFF', fontSize: 14, lineHeight: 19 }}>{returning && step === 0 ? 'Do you have a saved JSON backup?' : hints[step]}</Text>
      </Animated.View>
    </AnimatedGradient>
    <Progress value={(step + 1) / headings.length * 100} />
    <Animated.View style={{ opacity: motion, gap: 14, paddingTop: 6, width:'100%', alignSelf:'stretch' }}>
      {step === 0 && (returning ? <><Button title="Choose my backup" icon="folder-open-outline" onPress={() => void restore()} disabled={busy} loading={busy} /><Button title="Start fresh instead" variant="secondary" onPress={() => { setReturning(false); next(); }} disabled={busy} /><Button title="Back" variant="ghost" onPress={() => setReturning(false)} disabled={busy} /></> : <><Button title="Yes, let’s begin" onPress={next} disabled={busy} /><Button title="I’ve used Robb Tracker before" variant="secondary" onPress={() => setReturning(true)} disabled={busy} /></>)}
      {step === 1 && <Field label="Your name" value={name} onChangeText={setName} placeholder="First Name" maxLength={60} autoCapitalize="words" />}
      {step === 2 && <><CurrencyField label="Main currency" value={currency} onChange={setCurrency}/><Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17 }}>Amounts use two decimal places. Your main currency stays fixed to preserve budget history.</Text></>}
      {step === 3 && <Field label="Wallet name" value={accountName} onChangeText={setAccountName} placeholder="Cash" maxLength={60} />}
      {step === 4 && <Field label={`Opening amount · ${currency}`} value={opening} onChangeText={setOpening} placeholder="0.00" keyboardType="decimal-pad" style={{ fontSize: 34, lineHeight:44, minHeight:88, paddingVertical:18, paddingHorizontal:14, fontWeight: '700', width:'100%' }} />}
      {step === 5 && <Field label={`Monthly budget · ${currency}`} value={budget} onChangeText={setBudget} placeholder="0.00 · optional" keyboardType="decimal-pad" style={{ fontSize: 30, lineHeight:40, minHeight:84, paddingVertical:18, paddingHorizontal:14, fontWeight: '700', width:'100%' }} />}
      {step === 6 && <Field label="Balance name" value={balanceLabel} onChangeText={setBalanceLabel} placeholder="My available money" maxLength={60} />}
      {step === 7 && <View style={{gap:12}}><Text style={{color:colors.text,fontSize:17,fontWeight:'600'}}>{pinReady?'Your action PIN is ready ✓':'Create a 4-digit PIN'}</Text><Text style={{color:colors.muted,fontSize:14,lineHeight:20}}>Choose two recovery questions. Either correct answer can help you reset your PIN.</Text>{pinReady&&<Button title="Review PIN protection" variant="secondary" onPress={()=>void setupPin()} disabled={configuringPin}/>}</View>}
      {step === 8 && <View>{[['Name', name.trim() || 'My tracker'], ['Wallet', accountName.trim() || 'Cash'], ['Currency', currency], ['Balance name', balanceLabel.trim() || 'My available money'],['Important changes','Protected by action PIN']].map(([label, value]) => <Row key={label} style={{ minHeight: 42, justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border }}><Text style={{ color: colors.muted, fontSize: 14 }}>{label}</Text><Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>{value}</Text></Row>)}</View>}
      {step === 0 && <ErrorMessage message={error} />}
    </Animated.View>
  </Page>;
}
