import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { normalizeRecoveryAnswer, RECOVERY_QUESTIONS, type ActionPinService, type ActionPinState } from '../core/actionPin';

export type PinDialogMode = 'setup' | 'authorize' | 'change-pin' | 'recover' | 'recovery';
export interface PinDialogRequest { id: number; mode: PinDialogMode; reason?: string }
/** Standalone fields intentionally do not import useApp or the shared themed components. */
export function ActionPinDialog({ request, service, onSuccess, onCancel }: { request: PinDialogRequest; service: ActionPinService; onSuccess(): void; onCancel(): void }) {
  const dark = useColorScheme() === 'dark';
  const colors = { text: dark ? '#F4F8FF' : '#142B50', muted: dark ? '#B3C5DF' : '#61738F', surface: dark ? 'rgba(20,34,59,.95)' : 'rgba(255,255,255,.95)', input: dark ? '#0B1528' : '#F4F8FF', border: dark ? '#2A3F60' : '#DFE9F8', primary: dark ? '#71B5FF' : '#007DFE', danger: dark ? '#FF8796' : '#C33249' };
  const [phase, setPhase] = useState<PinDialogMode>(request.mode), [state, setState] = useState<ActionPinState | null>(null);
  const [pin, setPin] = useState(''), [newPin, setNewPin] = useState(''), [confirm, setConfirm] = useState('');
  const [questions, setQuestions] = useState(['first-school', 'first-pet']), [answers, setAnswers] = useState(['', '']);
  const [visibleAnswers, setVisibleAnswers] = useState([false, false]), [setupStep, setSetupStep] = useState(0);
  const [visiblePins, setVisiblePins] = useState<Record<string, boolean>>({});
  const [openQuestion, setOpenQuestion] = useState<number | null>(null), [busy, setBusy] = useState(true), [longWait, setLongWait] = useState(false);
  const [error, setError] = useState(''), [now, setNow] = useState(Date.now());
  const submitting = useRef(false);

  useEffect(() => {
    let active = true;
    void service.getState().then(value => {
      if (!active) return;
      setState(value);
      if (!value.hasPin) setPhase('setup');
      else if (request.mode === 'setup') setPhase('authorize');
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Secure storage could not be read.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [service, request.mode]);
  useEffect(() => {
    const current = Date.now(); setNow(current);
    if (!state?.lockedUntil || state.lockedUntil <= current) return;
    const timer = setInterval(() => { const current = Date.now(); setNow(current); if (current >= state.lockedUntil) clearInterval(timer); }, 1000);
    return () => clearInterval(timer);
  }, [state?.lockedUntil]);
  useEffect(() => {
    setLongWait(false);
    if (!busy) return;
    const timer = setTimeout(() => setLongWait(true), 3000);
    return () => clearTimeout(timer);
  }, [busy]);

  const remaining = Math.max(0, Math.ceil(((state?.lockedUntil ?? 0) - now) / 1000));
  const currentPinLength = state?.pinLength ?? 4;
  const needsNewPin = phase === 'setup' || phase === 'change-pin' || phase === 'recover';
  const needsQuestions = phase === 'setup' || phase === 'recovery';
  const titles: Record<PinDialogMode, string> = { setup: 'Create your action PIN', authorize: 'Confirm with your PIN', 'change-pin': 'Change your PIN', recover: 'Recover your PIN', recovery: 'Recovery questions' };
  const setupTitles = ['Choose your 4-digit PIN', 'Repeat your PIN', 'Choose your first question', 'Choose your second question'];
  const setupHints = ['This protects edits and removals.', 'Enter the same 4 digits once more.', 'Choose a question and a private answer.', 'Save a different question so you can use either answer to recover.'];
  const progress: Record<PinDialogMode, string> = { setup: 'Saving your PIN and recovery answers…', authorize: 'Checking your PIN…', 'change-pin': 'Saving your new PIN…', recover: 'Checking your answer and saving your PIN…', recovery: 'Saving your recovery answers…' };

  const submit = async () => {
    if (busy || submitting.current || !state || remaining > 0) return;
    setError('');
    if (phase === 'authorize' && pin.length !== currentPinLength) { setError(`Enter your ${currentPinLength}-digit PIN.`); return; }
    if (phase === 'setup') {
      if (setupStep === 0 && newPin.length !== 4) { setError('Choose a PIN with exactly 4 digits.'); return; }
      if (setupStep === 1 && (confirm.length !== 4 || confirm !== newPin)) { setError('Repeat the same 4-digit PIN.'); return; }
      if (setupStep >= 2) {
        const answer = normalizeRecoveryAnswer(answers[setupStep - 2]);
        if (answer.length < 2 || answer.length > 120) { setError('Enter an answer with 2 to 120 characters.'); return; }
        if (questions[0] === questions[1]) { setError('Choose two different recovery questions.'); return; }
      }
      if (setupStep < 3) { setOpenQuestion(null); setVisibleAnswers([false, false]); setSetupStep(step => step + 1); return; }
    }
    if ((phase === 'change-pin' || phase === 'recovery') && pin.length !== currentPinLength) { setError(`Enter your current ${currentPinLength}-digit PIN.`); return; }
    if (needsNewPin && (newPin.length !== 4 || newPin !== confirm)) { setError('Enter a 4-digit PIN and repeat it exactly.'); return; }
    if (phase === 'recover' && !answers.some(answer => normalizeRecoveryAnswer(answer).length >= 2)) { setError('Answer either saved recovery question.'); return; }
    submitting.current = true; setBusy(true); setVisiblePins({}); Keyboard.dismiss();
    try {
      // Paint progress before slower JavaScript hashing on older native builds.
      await new Promise<void>(resolve => requestAnimationFrame(() => { setTimeout(resolve, 0); }));
      if (phase === 'authorize' && !(await service.verifyPin(pin))) throw new Error('The PIN is incorrect. Try again.');
      if (phase === 'setup') await service.setup(newPin, questions.map((questionId, index) => ({ questionId, answer: answers[index] })));
      if (phase === 'change-pin') await service.changePin(pin, newPin);
      if (phase === 'recovery') await service.updateRecovery(pin, questions.map((questionId, index) => ({ questionId, answer: answers[index] })));
      if (phase === 'recover') await service.recoverPin(state.questionIds.map((questionId, index) => ({ questionId, answer: answers[index] })), newPin);
      setPin(''); setNewPin(''); setConfirm(''); setAnswers(['', '']); setVisibleAnswers([false, false]); onSuccess();
    } catch (reason) {
      setPin(''); setVisibleAnswers([false, false]); setError(reason instanceof Error ? reason.message : 'This action could not be verified.');
      try { setState(await service.getState()); } catch { setState(null); }
    } finally { submitting.current = false; setBusy(false); }
  };
  useEffect(() => {
    if (phase === 'authorize' && pin.length === currentPinLength && state && !busy && remaining === 0) void submit();
  }, [phase, pin, currentPinLength, state, busy, remaining]);

  const label = (text: string) => <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{text}</Text>;
  const pinField = (title: string, value: string, change: (next: string) => void, length: 4 | 6, focus = false) => <View key={title} style={{ gap: 7 }}>{label(title)}<View style={{flexDirection:'row',alignItems:'center',backgroundColor:colors.input,borderColor:colors.border,borderWidth:1,borderRadius:3}}>
    <TextInput accessibilityLabel={title} value={value} onChangeText={next => change(next.replace(/\D/g, ''))} editable={!busy && !!state} autoFocus={focus} onSubmitEditing={() => void submit()} secureTextEntry={!visiblePins[title]} keyboardType="number-pad" maxLength={length} autoComplete="off" textContentType="none" autoCorrect={false} style={{flex:1,minWidth:0,color:colors.text,fontSize:24,letterSpacing:8,textAlign:'center',padding:12,minHeight:48}} />
    <Pressable accessibilityRole="button" accessibilityLabel={`${visiblePins[title]?'Hide':'Show'} ${title}`} disabled={busy} onPress={()=>setVisiblePins(old=>({...old,[title]:!old[title]}))} style={{minWidth:46,minHeight:46,alignItems:'center',justifyContent:'center'}}><Ionicons name={visiblePins[title]?'eye-off-outline':'eye-outline'} color={colors.primary} size={21}/></Pressable></View>
  </View>;
  const answerField = (index: number) => <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.input, borderColor: colors.border, borderWidth: 1, borderRadius: 3 }}>
    <TextInput accessibilityLabel={`Answer ${index + 1}`} value={answers[index]} onChangeText={value => setAnswers(old => old.map((item, i) => i === index ? value : item))} editable={!busy && !!state} secureTextEntry={!visibleAnswers[index]} autoCapitalize="none" autoCorrect={false} autoComplete="off" maxLength={120} placeholder="Your answer" placeholderTextColor={colors.muted} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 16, padding: 12, minHeight: 46 }} />
    <Pressable accessibilityRole="button" accessibilityLabel={`${visibleAnswers[index] ? 'Hide' : 'Show'} answer ${index + 1}`} disabled={busy} onPress={() => setVisibleAnswers(old => old.map((value, i) => i === index ? !value : value))} style={{ minWidth: 46, minHeight: 46, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={visibleAnswers[index] ? 'eye-off-outline' : 'eye-outline'} color={colors.primary} size={21} /></Pressable>
  </View>;
  const changePhase = (next: PinDialogMode) => { setPhase(next); setError(''); setPin(''); setAnswers(['', '']); setVisibleAnswers([false, false]); setVisiblePins({}); };
  const reason = request.reason ?? (request.mode === 'setup' && state?.hasPin ? 'Confirm the existing action PIN on this phone' : undefined);
  const cannotSubmit = busy || !state || remaining > 0 || phase === 'authorize' && pin.length !== currentPinLength;

  return <Modal visible transparent animationType="fade" onRequestClose={() => { if (!busy || !state) onCancel(); }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: 'rgba(3,16,38,.48)', justifyContent: 'center' }}>
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8 }}><View style={{ maxHeight: '96%', width: '100%', maxWidth: 540, alignSelf: 'center', backgroundColor: colors.surface, borderRadius: 3, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
        {Platform.OS === 'ios' && <BlurView tint={dark ? 'dark' : 'light'} intensity={45} style={StyleSheet.absoluteFill} />}
        <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 18, gap: 12 }}>
          {phase === 'setup' && <Text accessibilityLabel={`PIN setup step ${setupStep + 1} of 4`} style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>ACTION PIN · {setupStep + 1} / 4</Text>}
          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 23, fontWeight: '800' }}>{busy && phase === 'setup' && state ? 'Finishing PIN setup' : phase === 'setup' ? setupTitles[setupStep] : titles[phase]}</Text>
          {reason && <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>{reason}</Text>}
          {busy ? <View style={{ paddingVertical: 24, gap: 12, alignItems: 'center' }}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text accessibilityLiveRegion="polite" style={{ color: colors.text, fontSize: 15, textAlign: 'center' }}>{state ? progress[phase] : 'Opening secure PIN…'}</Text>
            {longWait && <Text accessibilityLiveRegion="polite" style={{ color: colors.muted, fontSize: 13, lineHeight: 17, textAlign: 'center' }}>This device is taking longer. Still working securely; keep this screen open.</Text>}
          </View> : <>
            <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 17 }}>{phase === 'setup' ? setupHints[setupStep] : phase === 'authorize' ? `Enter your ${currentPinLength}-digit PIN to continue.` : phase === 'recover' ? 'Answer either saved question and choose a new 4-digit PIN.' : phase === 'recovery' ? 'Confirm your PIN, then save two different questions.' : 'Confirm your current PIN and choose a new 4-digit PIN.'}</Text>
            {(phase === 'authorize' || phase === 'change-pin' || phase === 'recovery') && pinField(`Current ${currentPinLength}-digit PIN`, pin, setPin, currentPinLength, phase === 'authorize')}
            {needsQuestions && (phase === 'setup' ? setupStep >= 2 ? [setupStep - 2] : [] : [0, 1]).map(index => <View key={index} style={{ gap: 7 }}>
              {label(`Recovery question ${index + 1}`)}
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: openQuestion === index }} onPress={() => setOpenQuestion(openQuestion === index ? null : index)} style={{ borderWidth: 1, borderColor: colors.border, padding: 12, backgroundColor: colors.input, borderRadius: 3 }}><Text style={{ color: colors.primary, fontSize: 14 }}>{RECOVERY_QUESTIONS.find(question => question.id === questions[index])?.label} ▾</Text></Pressable>
              {openQuestion === index && RECOVERY_QUESTIONS.filter(question => question.id !== questions[1 - index]).map(question => <Pressable accessibilityRole="button" key={question.id} onPress={() => { setQuestions(old => old.map((item, i) => i === index ? question.id : item)); setAnswers(old => old.map((item, i) => i === index ? '' : item)); setVisibleAnswers([false, false]); setOpenQuestion(null); }} style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}><Text style={{ color: colors.text, fontSize: 14 }}>{question.label}</Text></Pressable>)}
              {answerField(index)}
            </View>)}
            {phase === 'recover' && state?.questionIds.map((questionId, index) => <View key={questionId} style={{ gap: 7 }}>{label(RECOVERY_QUESTIONS.find(question => question.id === questionId)?.label ?? 'Recovery question')}{answerField(index)}</View>)}
            {needsNewPin && <>{(phase !== 'setup' || setupStep === 0) && pinField('New 4-digit PIN', newPin, setNewPin, 4, phase === 'setup')}{(phase !== 'setup' || setupStep === 1) && pinField('Repeat new PIN', confirm, setConfirm, 4, phase === 'setup')}</>}
          </>}
          {!!remaining && <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13 }}>Try again in {remaining} seconds.</Text>}
          {!!error && <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13, lineHeight: 17 }}>{error}</Text>}
          {!busy && <Pressable accessibilityRole="button" disabled={cannotSubmit} onPress={() => void submit()} style={{ borderRadius: 3, backgroundColor: '#007DFE', padding: 14, opacity: cannotSubmit ? .5 : 1, alignItems: 'center' }}><Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>{phase === 'authorize' ? 'Confirm action' : phase === 'recover' ? request.reason ? 'Reset PIN and continue' : 'Reset PIN' : phase === 'setup' ? setupStep < 3 ? 'Next' : 'Save PIN and continue' : 'Save changes'}</Text></Pressable>}
          {phase === 'setup' && setupStep > 0 && !busy && <Pressable accessibilityRole="button" onPress={() => { setError(''); setOpenQuestion(null); setVisibleAnswers([false, false]); setSetupStep(step => step - 1); }} style={{ padding: 10, alignItems: 'center' }}><Text style={{ color: colors.primary, fontSize: 14 }}>Back</Text></Pressable>}
          {(phase === 'authorize' || phase === 'change-pin') && !busy && <Pressable accessibilityRole="button" onPress={() => changePhase('recover')} style={{ padding: 10, alignItems: 'center' }}><Text style={{ color: colors.primary, fontSize: 14 }}>Forgot PIN?</Text></Pressable>}
          {(!busy || !state) && <Pressable accessibilityRole="button" onPress={onCancel} style={{ padding: 10, alignItems: 'center' }}><Text style={{ color: colors.muted, fontSize: 14 }}>Cancel</Text></Pressable>}
        </ScrollView>
      </View></SafeAreaView>
    </KeyboardAvoidingView>
  </Modal>;
}
