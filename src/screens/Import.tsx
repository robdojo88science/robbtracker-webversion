import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../ui/theme';
import { Button, Card, ErrorMessage, InfoButton, Page, Row, Section, Toast } from '../ui/components';
import { reviewImport, importBalanceWarnings, type ImportReview } from '../core/import';
import { formatMoney } from '../core/money';
import { pickImportFile, shareImportTemplate } from '../platform/importFiles';
import { transactionFeedback } from '../platform/feedback';
import { goToTransactions } from '../platform/navigation';

export function ImportScreen() {
  const { snapshot, repo, mutate, busy } = useApp(); const { colors } = useTheme();
  const [review, setReview] = useState<ImportReview | null>(null), [fileName, setFileName] = useState('');
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState('');
  const run = async (work: () => Promise<void>) => { setWorking(true); setError(''); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not read the file.'); } finally { setWorking(false); } };
  const pick = () => run(async () => {
    const selected = await pickImportFile(); if (!selected) return;
    const result = reviewImport(selected.rows, snapshot);
    result.inputs = result.inputs.map(input => ({ ...input, id: Crypto.randomUUID() }));
    setReview(result); setFileName(selected.name); setSaved('');
  });
  const confirm = () => {
    if (!review?.inputs.length || review.issues.length) return;
    let over:Set<string>;
    try{over=new Set(importBalanceWarnings(review.inputs,snapshot));}
    catch(reason){setError(reason instanceof Error?reason.message:'Review the selected wallets and amounts.');return;}
    Alert.alert(over.size ? 'Some expenses exceed your balance' : 'Save these transactions?', `${review.inputs.length} entries will be added to your local tracker.${over.size ? `\n\nSpending exceeds the available funds in: ${[...over].join(', ')}. Continue and allow a negative wallet balance?` : ''}\n\nExisting records will stay in place.`, [
      { text: 'Review again', style: 'cancel' }, { text: over.size ? 'Confirm & allow negative balance' : 'Import transactions', onPress: () => void run(async () => {
        await mutate(() => repo.importTransactions(review.inputs.map(input => ({ ...input, allowOverdraft: over.size > 0 }))));
        setSaved(`${review.inputs.length} transactions imported`); setReview(null);
        void transactionFeedback(review.inputs.at(-1)?.kind ?? 'income', snapshot.profile);
        goToTransactions(review.inputs.at(-1)?.id);
      }) },
    ]);
  };
  return <Page safeTop={false} compact title="Import spreadsheet" maxWidth={1440} action={<InfoButton compact title="Spreadsheet format" message="Open the .xlsx template in Microsoft Excel or Google Sheets. Replace or delete example rows and keep the headings. Use income, expense, or transfer; positive amounts; and exact existing wallet, category and tag names. Separate tags with |. Transfers need Destination Account and, for different currencies, Destination Amount. Use values instead of formulas. Upload the first worksheet as .xlsx or CSV UTF-8, up to 2,000 entries and 5 MB. Imports add new records and skip exact duplicates."/>}>
    <Row style={{gap:8}}><View style={{flex:1}}><Button title="Get Excel template" icon="download-outline" variant="secondary" onPress={() => void run(() => shareImportTemplate(snapshot))} disabled={working || busy}/></View><View style={{flex:1}}><Button title="Choose file" icon="document-text-outline" onPress={() => void pick()} disabled={working || busy} loading={working}/></View></Row>
    <Text style={{color:colors.muted,fontSize:12,lineHeight:16}}>Edit in Excel or Google Sheets, then upload to review.</Text>
    <View style={{gap:8}}>
      {review && <><Text style={{ color: colors.text, fontWeight: '700' }}>{fileName}</Text><Text style={{ color: colors.muted }}>{review.inputs.length} ready · {review.duplicates} duplicates skipped · {review.issues.length} rows to fix</Text>
        {review.issues.slice(0, 30).map((issue, i) => <Text key={i} style={{ color: colors.danger, lineHeight: 19 }}>Row {issue.row}: {issue.message}</Text>)}
        {review.issues.length > 30 && <Text style={{ color: colors.muted }}>Fix these rows and upload again to review the remaining errors.</Text>}
        {review.inputs.slice(0, 20).map((tx, i) => <View key={i} style={{ borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 12, gap: 4 }}><Text style={{ color: colors.text, fontWeight: '600' }}>{tx.title} · {formatMoney(tx.amountMinor, snapshot.accounts.find(a => a.id === tx.accountId)?.currency)}</Text><Text style={{ color: colors.muted }}>{tx.date} · {tx.kind} · {snapshot.accounts.find(a => a.id === tx.accountId)?.name}</Text></View>)}
        {review.inputs.length > 20 && <Text style={{ color: colors.muted }}>Showing the first 20 of {review.inputs.length} entries.</Text>}
        <Button title={`Confirm ${review.inputs.length} transactions`} onPress={confirm} disabled={working || busy || !review.inputs.length || review.issues.length > 0} />
      </>}
    </View><ErrorMessage message={error} /><Toast message={saved} />
  </Page>;
}
