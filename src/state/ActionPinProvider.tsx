import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { actionPin } from '../platform/actionPin';
import { ActionPinDialog, type PinDialogMode, type PinDialogRequest } from '../ui/ActionPinDialog';

interface ActionPinContextValue {
  authorize(reason: string): Promise<void>;
  configure(): Promise<void>;
  changePin(): Promise<void>;
  recoverPin(): Promise<void>;
  manageRecovery(): Promise<void>;
}
const Context = createContext<ActionPinContextValue | null>(null);
let setupHost: (() => Promise<void>) | null = null;
/** Await this during onboarding. No PIN prompt is shown just for launching the app. */
export function configureActionPin(): Promise<void> { return setupHost ? setupHost() : Promise.reject(new Error('PIN setup is not ready. Please try again.')); }
export function ActionPinProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<PinDialogRequest | null>(null);
  const nextId = useRef(0), pending = useRef<Promise<unknown>>(Promise.resolve()), active = useRef(true);
  const completion = useRef<{ resolve(): void; reject(reason: Error): void } | null>(null);
  const present = useCallback((mode: PinDialogMode, reason?: string): Promise<void> => {
    const work = async () => {
      if (!active.current) throw new Error('PIN confirmation was cancelled.');
      // The dialog reads secure state once and switches existing setup requests to authorization.
      await new Promise<void>((resolve, reject) => { completion.current = { resolve, reject }; setRequest({ id: ++nextId.current, mode, reason }); });
    };
    const next = pending.current.then(work, work); pending.current = next.catch(() => undefined); return next;
  }, []);
  const configure = useCallback(() => present('setup'), [present]);
  useEffect(() => { active.current = true; setupHost = configure; return () => { active.current = false; if (setupHost === configure) setupHost = null; completion.current?.reject(new Error('PIN confirmation was cancelled.')); completion.current = null; }; }, [configure]);
  const value = useMemo<ActionPinContextValue>(() => ({ configure, authorize: reason => present('authorize', reason), changePin: () => present('change-pin'), recoverPin: () => present('recover'), manageRecovery: () => present('recovery') }), [configure, present]);
  const finish = (success: boolean) => { const done = completion.current; completion.current = null; setRequest(null); if (success) done?.resolve(); else done?.reject(new Error('Action cancelled. Your records were not changed.')); };
  return <Context.Provider value={value}>{children}{request && <ActionPinDialog key={request.id} request={request} service={actionPin} onSuccess={() => finish(true)} onCancel={() => finish(false)} />}</Context.Provider>;
}
export function useActionPin(): ActionPinContextValue { const value = useContext(Context); if (!value) throw new Error('Action PIN provider is unavailable.'); return value; }
