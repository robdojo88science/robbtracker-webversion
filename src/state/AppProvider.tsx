import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import type { FinanceRepository, Snapshot } from '../core/types';
import { getRepository } from '../data/expo';
import { reconcileNotifications } from '../platform/notifications';
import { BrandMark } from '../ui/BrandMark';
import * as SplashScreen from 'expo-splash-screen';
import { ActionPinProvider, useActionPin } from './ActionPinProvider';
import { CommittedResetError, protectRepository } from '../core/protectedRepository';
import { actionPin } from '../platform/actionPin';
import { clearAISettings, cleanupLegacyOnlineAI } from '../platform/ai';
import { createBackgroundResumeGate, createSnapshotRefresh } from '../core/snapshotRefresh';
import { notificationInputKey } from '../platform/notificationInputs';
import { coordinateRepository } from '../platform/repositoryLock';

interface AppContextValue {
  snapshot: Snapshot;
  repo: FinanceRepository;
  refresh(): Promise<void>;
  mutate(work: () => Promise<void>): Promise<void>;
  busy: boolean;
  error: string | null;
  notificationError: string | null;
}
const AppContext = createContext<AppContextValue | null>(null);
const message = (error: unknown) => error instanceof Error ? error.message : 'Could not open your local tracker. Please try again.';

export function AppProvider({ children }: { children: React.ReactNode }) {
  return <ActionPinProvider><AppDataProvider>{children}</AppDataProvider></ActionPinProvider>;
}
function AppDataProvider({ children }: { children: React.ReactNode }) {
  const { authorize } = useActionPin();
  const [repo, setRepo] = useState<FinanceRepository | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [busyCount, setBusyCount] = useState(0);
  const [notificationEpoch, setNotificationEpoch] = useState(0);
  const mounted = useRef(true);
  const activeMutations = useRef(0), notificationGeneration = useRef(0), initializationGeneration = useRef(0);
  const refreshController = useRef<ReturnType<typeof createSnapshotRefresh<Snapshot>> | null>(null);
  useEffect(() => {
    if (!repo) return;
    // Each effect setup owns a new controller, including StrictMode's cleanup/setup replay.
    const controller = createSnapshotRefresh(() => repo.getSnapshot(), saved => {
      if (mounted.current && refreshController.current === controller) { setSnapshot(saved); setError(null); }
    });
    refreshController.current = controller;
    return () => {
      if (refreshController.current === controller) refreshController.current = null;
      controller.dispose();
    };
  }, [repo]);

  const initialize = useCallback(async () => {
    const generation = ++initializationGeneration.current;
    setLoading(true); setError(null);
    try {
      const raw = await getRepository();
      if (!mounted.current || generation !== initializationGeneration.current) return;
      const repository = coordinateRepository(protectRepository(raw, authorize, async () => {
        const results = await Promise.allSettled([actionPin.clearAfterTrackerReset(), clearAISettings()]);
        if (results.some(result => result.status === 'rejected')) throw new Error('Secure settings cleanup needs another try.');
      }));
      const saved = await repository.getSnapshot();
      if (mounted.current && generation === initializationGeneration.current) { setRepo(repository); setSnapshot(saved); }
    } catch (reason) { if (mounted.current && generation === initializationGeneration.current) setError(message(reason)); }
    finally { if (mounted.current && generation === initializationGeneration.current) setLoading(false); }
  }, [authorize]);
  useEffect(() => {
    mounted.current = true;
    // Obsolete credentials are deleted independently; secure-storage retries never delay local records.
    void cleanupLegacyOnlineAI().catch(() => {});
    void initialize();
    return () => { mounted.current = false; initializationGeneration.current++; };
  }, [initialize]);

  const refresh = useCallback(async () => {
    await refreshController.current?.request();
  }, []);
  const mutate = useCallback(async (work: () => Promise<void>) => {
    const controller = refreshController.current;
    activeMutations.current++; setBusyCount(count => count + 1);
    let committed = false;
    try {
      await work();
      committed = true;
      await controller?.request(true);
    } catch (reason) {
      if (reason instanceof CommittedResetError) {
        // SQLite has already committed. Show onboarding instead of retaining a stale ledger.
        try { await controller?.request(true); } catch { /* The explicit committed-reset error stays truthful. */ }
        if (mounted.current) setError(reason.message);
        Alert.alert('Tracker records reset', reason.message);
        throw reason;
      }
      // Keep the last successfully read data available. The caller displays
      // this operation's error inline and retains its form inputs for retry.
      const failure = committed ? new Error('Saved on this device. The screen could not refresh; reopen this view to read your saved records.') : reason;
      if (mounted.current) setError(message(failure));
      throw failure;
    } finally { activeMutations.current--; if (mounted.current) setBusyCount(count => Math.max(0, count - 1)); }
  }, []);

  const schedule = useCallback((saved: Snapshot, generation: number) => {
    void reconcileNotifications(saved.reminders, saved.profile?.notificationsEnabled ?? false, saved.profile?.notificationSound ?? 'default',saved)
      .then(result => {
        if (!mounted.current || generation !== notificationGeneration.current) return;
        setNotificationError(saved.profile?.notificationsEnabled && !result.permissionGranted
          ? 'Allow notifications to receive reminders and the daily summary. Your records are saved.'
          : result.truncated ? 'Upcoming alerts are scheduled. Open the app regularly to keep later alerts ready.' : null);
      })
      .catch(() => { if (mounted.current && generation === notificationGeneration.current) setNotificationError('Reminders are saved. Notification scheduling needs another try; reopen the app or check device settings.'); });
  }, []);
  const notificationKey = useMemo(() => snapshot ? notificationInputKey(snapshot) : '', [snapshot, notificationEpoch]);
  const latestSnapshot = useRef(snapshot); latestSnapshot.current = snapshot;
  useEffect(() => {
    const generation = ++notificationGeneration.current;
    // Let save/navigation finish first, and collapse a burst of changes into one native reconciliation.
    const timer = setTimeout(() => { if (latestSnapshot.current) schedule(latestSnapshot.current, generation); }, 200);
    return () => { clearTimeout(timer); notificationGeneration.current++; };
  }, [notificationKey, notificationEpoch, schedule]);
  useEffect(() => {
    const resumedFromBackground = createBackgroundResumeGate(AppState.currentState);
    const subscription = AppState.addEventListener('change', state => {
      if (!resumedFromBackground(state)) return;
      setNotificationEpoch(value => value + 1);
      void cleanupLegacyOnlineAI().catch(() => {});
      // PIN/system sheets use inactive -> active and do not change the database.
      // A pending mutation already performs its own required read after committing.
      if (!activeMutations.current) void refresh().catch(reason => { if (mounted.current) setError(message(reason)); });
    });
    return () => subscription.remove();
  }, [refresh]);

  if (loading) return <View style={styles.center}><BrandMark size={96} /><Text style={styles.brand}>Robb Tracker</Text><ActivityIndicator color="#007DFE" size="large" /><Text style={styles.help}>Opening your local tracker…</Text></View>;
  if (!repo || !snapshot) return <View onLayout={() => { void SplashScreen.hideAsync().catch(() => {}); }} style={styles.center}><Text style={styles.brand}>Your tracker needs attention</Text><Text accessibilityRole="alert" style={styles.help}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void initialize()} style={styles.button}><Text style={styles.buttonText}>Try opening again</Text></Pressable><Text style={styles.help}>Your saved records have not been reset.</Text></View>;
  return <AppContext.Provider value={{ snapshot, repo, refresh, mutate, busy: busyCount > 0, error, notificationError }}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider.');
  return value;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F4F8FF', padding: 32, gap: 20 },
  brand: { color: '#0057E7', fontSize: 26, fontWeight: '800', textAlign: 'center' },
  help: { color: '#61738F', fontSize: 16, textAlign: 'center', maxWidth: 440 },
  button: { backgroundColor: '#007DFE', borderRadius: 3, paddingHorizontal: 24, paddingVertical: 16, minHeight: 48 },
  buttonText: { color: 'white', fontWeight: '700', fontSize: 16 },
});
