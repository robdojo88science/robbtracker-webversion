import React, { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Crypto from 'expo-crypto';
import type { TransactionInput } from '../core/types';
import type { ChatDraft } from '../core/chat';
import { assertDate } from '../core/dates';
import { importBalanceWarnings } from '../core/import';
import { formatMoney, parseMoney } from '../core/money';
import { useApp } from '../state/AppProvider';
import { AnimatedGradient, Button, Chip, DateField, Dropdown, ErrorMessage, Field, InfoButton, Page, Row } from '../ui/components';
import { useTheme } from '../ui/theme';
import { transactionFeedback } from '../platform/feedback';
import { goToTransactions } from '../platform/navigation';
import { getAIStatus, interpretOfflineBatch, type AIEngine, type AIStatus } from '../platform/ai';

type Review = { input: TransactionInput; amount: string; newTags: { id: string; name: string }[] };
function reviewAmount(value: string, currency?: string) { try { return formatMoney(parseMoney(value, true), currency); } catch { return value || '0.00'; } }

export function AssistantScreen() {
  const { snapshot, repo, mutate, busy } = useApp(), { colors } = useTheme();
  const [text, setText] = useState(''), [error, setError] = useState('');
  const [reviews, setReviews] = useState<Review[]>([]), [selected, setSelected] = useState(0), [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<AIStatus | null>(null), [engine, setEngine] = useState<AIEngine | null>(null), [notice, setNotice] = useState('');
  const [processing, setProcessing] = useState(false), [saving, setSaving] = useState(false), [lastQuestion, setLastQuestion] = useState('');
  const [messages, setMessages] = useState<{ question: string; answer: string }[]>([]);
  const request = useRef(0), interpreting = useRef(false), saveGate = useRef(false), controller = useRef<AbortController | null>(null);
  const current = reviews[selected], draft = current?.input;
  const update = (patch: Partial<Review>) => setReviews(items => items.map((item, index) => index === selected ? { ...item, ...patch } : item));
  const updateInput = (patch: Partial<TransactionInput>) => { if (draft) update({ input: { ...draft, ...patch } }); };
  useFocusEffect(useCallback(() => {
    let active = true;
    void getAIStatus().then(next => { if (active) setStatus(next); }).catch(() => {});
    return () => { active = false; controller.current?.abort(); request.current++; interpreting.current = false; setProcessing(false); };
  }, []));
  const cancel = () => { controller.current?.abort(); request.current++; interpreting.current = false; setProcessing(false); setNotice('Cancelled. Nothing was saved.'); };
  const ask = async (preferModel = false, repeat?: string) => {
    if (interpreting.current || busy || saveGate.current) return;
    const question = repeat ?? text; if (!question.trim()) return;
    interpreting.current = true; setProcessing(true); const activeRequest = ++request.current;
    controller.current = new AbortController(); setError(''); setReviews([]); setEditing(false); setEngine(null);
    try {
      const response = await interpretOfflineBatch(question, snapshot, { preferModel, signal: controller.current.signal, onEngine: next => { if (activeRequest === request.current) setEngine(next); } });
      if (activeRequest !== request.current) return;
      setEngine(response.engine); setNotice(response.notice); setLastQuestion(question);
      const result = response.result;
      if (result.type !== 'answer') {
        const tagIds = new Map<string, string>();
        const drafts: ChatDraft[] = result.type === 'batch' ? result.drafts : [result];
        setReviews(drafts.map(item => ({ input: { ...item.input, id: Crypto.randomUUID() }, amount: (item.input.amountMinor / 100).toFixed(2), newTags: (item.newTagNames ?? []).map(name => { const key = name.toLowerCase(); if (!tagIds.has(key)) tagIds.set(key, Crypto.randomUUID()); return { name, id: tagIds.get(key)! }; }) })));
        setSelected(0);
      }
      setMessages(items => [...items.slice(-8), { question, answer: result.message }]); if (!repeat) setText('');
    } catch (reason) { if (activeRequest === request.current) { setError(reason instanceof Error ? reason.message : 'Use a description and amount for each entry.'); setNotice('Nothing was saved.'); } }
    finally { if (activeRequest === request.current) { interpreting.current = false; setProcessing(false); controller.current = null; } }
  };
  const save = async () => {
    if (!reviews.length || saveGate.current || busy) return;
    saveGate.current = true; setSaving(true); setError('');
    try {
      const inputs = reviews.map((review, index): TransactionInput => {
        const input = { ...review.input, amountMinor: parseMoney(review.amount), tagIds: [...new Set([...(review.input.tagIds ?? []), ...review.newTags.map(tag => tag.id)])] };
        assertDate(input.date); if (!input.title.trim()) throw new Error(`Entry ${index + 1}: add a description.`);
        const wallet = snapshot.accounts.find(item => item.id === input.accountId && !item.deletedAt);
        if (!wallet) throw new Error(`Entry ${index + 1}: choose an available wallet.`);
        if (input.kind === 'transfer') {
          const destination = snapshot.accounts.find(item => item.id === input.destinationAccountId && !item.deletedAt);
          if (!destination || destination.id === wallet.id || destination.currency !== wallet.currency) throw new Error(`Entry ${index + 1}: choose different wallets in the same currency, or use the Transfer form.`);
          input.destinationAmountMinor = input.amountMinor;
        }
        return input;
      });
      const warnings = importBalanceWarnings(inputs, snapshot);
      if (warnings.length) {
        const accepted = await new Promise<boolean>(resolve => Alert.alert('This exceeds available money', `A negative balance would be allowed for ${warnings.join(', ')}. Save these entries?`, [{ text: 'Keep editing', style: 'cancel', onPress: () => resolve(false) }, { text: 'Confirm & save', onPress: () => resolve(true) }], { cancelable: true, onDismiss: () => resolve(false) }));
        if (!accepted) return;
      }
      const newTags = [...new Map(reviews.flatMap(review => review.newTags).map(tag => [tag.id, { ...tag, color: '#007DFE' }])).values()];
      await mutate(() => repo.importTransactions(inputs.map(input => ({ ...input, allowOverdraft: warnings.length > 0 })), newTags));
      setReviews([]); void transactionFeedback(inputs.at(-1)!.kind, snapshot.profile); goToTransactions(inputs.at(-1)!.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save. Keep these entries and try again.'); }
    finally { saveGate.current = false; setSaving(false); }
  };
  const engineLabel = processing ? engine === 'apple' ? 'Using on-device intelligence…' : 'Interpreting…' : engine === 'apple' ? 'On-device intelligence' : 'Offline quick entry';
  const footer = reviews.length ? <View style={{ gap: 5 }}><ErrorMessage message={error} /><Row style={{ gap: 6 }}><View style={{ flex: 1 }}><Button title={reviews.length > 1 ? `Confirm & save all ${reviews.length}` : 'Confirm & save'} onPress={() => void save()} loading={saving || busy} /></View><Button title="Discard" variant="ghost" disabled={saving || busy} onPress={() => setReviews([])} /></Row></View> : <Row style={{ alignItems: 'flex-end', gap: 6 }}><View style={{ flex: 1 }}><Field label="Message" value={text} onChangeText={setText} editable={!processing} multiline style={{ minHeight: 44, maxHeight: 100 }} placeholder="transpo 25; lunch 80 today" /></View>{processing ? <Button title="Cancel" variant="secondary" onPress={cancel} /> : <Button title="Send" icon="send-outline" onPress={() => void ask()} disabled={!text.trim() || busy} />}</Row>;
  return <Page safeTop={false} compact maxWidth={1440} title="Quick chat" footer={footer} action={<Row style={{ gap: 2 }}><InfoButton compact title="Offline quick chat" message="Separate complete transactions with commas or semicolons, for example transpo 25; lunch 80 today. Commas inside 1,000 or Nov5,2024 stay part of that amount or date. Each entry keeps its own date and wallet. Review and edit the list, then save all entries together." /><Button title="Options" icon="options-outline" variant="ghost" onPress={() => router.push('/ai-settings')} /></Row>}>
    <Text accessibilityLiveRegion="polite" style={{ color: colors.muted, fontSize: 12 }}>{engineLabel}</Text>
    {!reviews.length && !messages.length && <AnimatedGradient subtle style={{ padding: 12, gap: 6 }}><Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>Add it in a sentence.</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>{['transpo 25 today', 'lunch 80 yesterday', 'transpo 25; coffee 80', 'salary 1,000 Nov5,2024'].map(example => <Chip key={example} label={example} onPress={() => setText(example)} />)}</View></AnimatedGradient>}
    {!reviews.length && <><ErrorMessage message={error} />{!!error && <Button title="Use transaction form" variant="secondary" onPress={() => router.push('/transaction/new')} />}</>}
    {reviews.length > 1 && <View style={{ gap: 4 }}><Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{reviews.length} transactions to review</Text>{reviews.map((review, index) => { const wallet = snapshot.accounts.find(item => item.id === review.input.accountId); return <Row key={review.input.id} style={{ borderBottomWidth: 1, borderBottomColor: colors.border, gap: 5 }}><Pressable accessibilityRole="button" accessibilityLabel={`Edit entry ${index + 1}: ${review.input.title}`} onPress={() => { setSelected(index); setEditing(true); }} style={{ flex: 1, minHeight: 58, paddingVertical: 7, gap: 3 }}><Row><Text numberOfLines={1} style={{ flex: 1, color: colors.text, fontWeight: '600' }}>{review.input.title}</Text><Text style={{ color: review.input.kind === 'income' ? colors.success : review.input.kind === 'transfer' ? colors.transfer : colors.danger, fontWeight: '700', fontSize: 13 }}>{reviewAmount(review.amount, wallet?.currency)}</Text></Row><Text style={{ color: colors.muted, fontSize: 11 }}>{review.input.date} · {wallet?.name} · Tap to edit</Text></Pressable><Button title="Remove" variant="ghost" disabled={saving || busy} onPress={() => { setReviews(items => items.filter((_, itemIndex) => itemIndex !== index)); setSelected(0); setEditing(false); }} /></Row>; })}</View>}
    {draft && (reviews.length === 1 || editing) && <View style={{ gap: 8 }}><Row style={{ justifyContent: 'space-between' }}><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>{reviews.length > 1 ? `Entry ${selected + 1}` : `Review ${draft.kind}`}</Text><Button title={editing ? 'Done editing' : 'Edit'} variant="ghost" disabled={saving || busy} onPress={() => setEditing(!editing)} /></Row>
      {!editing && <Row><View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{draft.title}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{draft.date} · {snapshot.accounts.find(item => item.id === draft.accountId)?.name}</Text></View><Text style={{ color: draft.kind === 'income' ? colors.success : draft.kind === 'transfer' ? colors.transfer : colors.danger, fontSize: 23, fontWeight: '700' }}>{reviewAmount(current.amount, snapshot.accounts.find(item => item.id === draft.accountId)?.currency)}</Text></Row>}
      {editing && <View style={{ gap: 8 }}><Field label="Description" value={draft.title} onChangeText={title => updateInput({ title })} /><Row style={{ alignItems: 'flex-start' }}><View style={{ flex: 1 }}><Field label="Amount" value={current.amount} onChangeText={amount => update({ amount })} keyboardType="decimal-pad" /></View><View style={{ flex: 1 }}><DateField value={draft.date} onChange={date => updateInput({ date })} /></View></Row><Dropdown label="Wallet" value={draft.accountId ?? ''} options={snapshot.accounts.filter(item => !item.deletedAt).map(item => ({ label: item.name, value: item.id }))} onChange={accountId => updateInput({ accountId })} />{draft.kind === 'expense' && <Dropdown label="Category" value={draft.categoryId ?? ''} options={[{ label: 'Uncategorized', value: '' }, ...snapshot.categories.filter(item => !item.deletedAt).map(item => ({ label: item.name, value: item.id }))]} onChange={categoryId => updateInput({ categoryId: categoryId || null })} />}{draft.kind === 'transfer' && <Dropdown label="To wallet" value={draft.destinationAccountId ?? ''} options={snapshot.accounts.filter(item => !item.deletedAt && item.id !== draft.accountId).map(item => ({ label: item.name, value: item.id }))} onChange={destinationAccountId => updateInput({ destinationAccountId })} />}</View>}
      {(!!draft.tagIds?.length || current.newTags.length > 0) && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>{draft.tagIds?.map(id => <Chip key={id} label={`#${snapshot.tags.find(tag => tag.id === id)?.name} ×`} onPress={() => updateInput({ tagIds: draft.tagIds?.filter(tagId => tagId !== id) })} />)}{current.newTags.map(tag => <Chip key={tag.id} label={`#${tag.name} ×`} onPress={() => update({ newTags: current.newTags.filter(item => item.id !== tag.id) })} />)}</View>}
      {reviews.length === 1 && engine === 'basic' && status?.apple.available && status.preferences.mode === 'auto' && <Button title="Try on-device intelligence" variant="ghost" disabled={processing || busy || saving} onPress={() => void ask(true, lastQuestion)} />}
    </View>}
    {(reviews.length ? messages.slice(0, -1) : messages).slice(-3).map((item, index) => <View key={index} style={{ gap: 4, paddingVertical: 7, borderBottomColor: colors.border, borderBottomWidth: 1 }}><Text style={{ color: colors.muted, fontSize: 12 }}>{item.question}</Text><Text style={{ color: colors.text, fontSize: 14, lineHeight: 18 }}>{item.answer}</Text></View>)}
  </Page>;
}