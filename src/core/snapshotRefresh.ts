/** Coalesce reads while keeping every committed write ahead of the snapshot it awaits. */
export function createSnapshotRefresh<T>(read: () => Promise<T>, publish: (value: T) => void) {
  let revision = 0, running = false, disposed = false;
  type Waiter = { resolve(): void; reject(reason: unknown): void };
  let waiters: Waiter[] = [];
  const settle = (pending: Waiter[], reason?: { error: unknown }) => {
    for (const waiter of pending) { if (reason) waiter.reject(reason.error); else waiter.resolve(); }
  };
  async function drain() {
    while (!disposed && waiters.length) {
      const readingRevision = revision;
      try {
        const saved = await read();
        if (disposed) break;
        // A write committed after this read began. Never publish or reuse its older result.
        if (readingRevision !== revision) continue;
        const ready = waiters; waiters = [];
        try { publish(saved); settle(ready); } catch (error) { settle(ready, { error }); }
      } catch (error) {
        if (disposed) break;
        if (readingRevision !== revision) continue;
        const failed = waiters; waiters = []; settle(failed, { error });
      }
    }
    running = false;
  }
  return {
    request(afterCommit = false): Promise<void> {
      if (disposed) return Promise.reject(new Error('This tracker view is closed.'));
      if (afterCommit) revision++;
      const result = new Promise<void>((resolve, reject) => { waiters.push({ resolve, reject }); });
      if (!running) { running = true; void drain(); }
      return result;
    },
    dispose() {
      disposed = true;
      const pending = waiters; waiters = [];
      settle(pending, { error: new Error('This tracker view is closed.') });
    },
  };
}

/** iOS may pass through inactive on its way back from background; system sheets do not. */
export function createBackgroundResumeGate(initialState: string | null | undefined) {
  let backgrounded = initialState === 'background';
  return (state: string): boolean => {
    if (state === 'background') backgrounded = true;
    if (state !== 'active' || !backgrounded) return false;
    backgrounded = false;
    return true;
  };
}
