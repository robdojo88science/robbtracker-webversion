import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export const PIN_ITERATIONS = 210_000;
export const RECOVERY_QUESTIONS = [
  { id: 'first-school', label: 'What was the name of your first school?' },
  { id: 'childhood-friend', label: 'What was your childhood best friend’s first name?' },
  { id: 'first-pet', label: 'What was the name of your first pet?' },
  { id: 'birth-city', label: 'In which city or town were you born?' },
  { id: 'favorite-teacher', label: 'What was your favorite teacher’s surname?' },
  { id: 'childhood-street', label: 'What street did you live on as a child?' },
  { id: 'first-concert', label: 'Who performed at your first concert?' },
  { id: 'family-nickname', label: 'What was your childhood family nickname?' },
  { id: 'parents-meet', label: 'Where did your parents first meet?' },
] as const;
export interface RecoveryAnswer { questionId: string; answer: string }
interface SecretHash { salt: string; hash: string }
interface SecurityRecord {
  version: 1 | 2;
  pinLength?: 4;
  algorithm: 'pbkdf2-sha256';
  iterations: number;
  pin: SecretHash;
  recovery: [SecretHash & { questionId: string }, SecretHash & { questionId: string }];
  failedAttempts: number;
  lockedUntil: number;
}
export interface ActionPinState { hasPin: boolean; pinLength: 4 | 6; questionIds: string[]; lockedUntil: number }
export interface ActionPinDependencies {
  storageAvailable(): Promise<boolean>;
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
  randomBytes(length: number): Promise<Uint8Array>;
  now(): number;
  /** Optional native PBKDF2 implementation; parameters and stored credentials remain identical. */
  derive?(value: string, saltHex: string, iterations: number): Promise<Uint8Array>;
}
export function normalizeRecoveryAnswer(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}
const questionIds = new Set<string>(RECOVERY_QUESTIONS.map(question => question.id));
function isPin(pin: unknown, length: 4 | 6): pin is string { return typeof pin === 'string' && pin.length === length && /^\d+$/.test(pin); }
function validatePin(pin: string): void { if (!isPin(pin, 4)) throw new Error('Choose a PIN with exactly 4 digits.'); }
function pinLength(record: SecurityRecord | null): 4 | 6 { return record?.version === 1 ? 6 : 4; }
function answers(input: RecoveryAnswer[]): RecoveryAnswer[] {
  if (!Array.isArray(input) || input.length !== 2) throw new Error('Choose two different recovery questions.');
  const normalized = Array.from(input).map(item => {
    if (!item || typeof item !== 'object' || !questionIds.has(item.questionId) || typeof item.answer !== 'string') throw new Error('Choose an available recovery question and enter its answer.');
    const answer = normalizeRecoveryAnswer(item.answer);
    if (answer.length < 2 || answer.length > 120) throw new Error('Each recovery answer must contain 2 to 120 characters.');
    return { questionId: item.questionId, answer };
  });
  if (normalized[0].questionId === normalized[1].questionId) throw new Error('Choose two different recovery questions.');
  return normalized;
}
function recoveryAttempts(input: RecoveryAnswer[], record: SecurityRecord): RecoveryAnswer[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 2) throw new Error('Answer at least one of your saved recovery questions.');
  const known = new Set(record.recovery.map(item => item.questionId)), seen = new Set<string>();
  const normalized = Array.from(input).map(item => {
    if (!item || typeof item !== 'object' || !known.has(item.questionId) || seen.has(item.questionId) || typeof item.answer !== 'string') throw new Error('Use each saved recovery question at most once.');
    seen.add(item.questionId);
    const answer = normalizeRecoveryAnswer(item.answer);
    if (answer.length > 120) throw new Error('Recovery answers must contain at most 120 characters.');
    return { questionId: item.questionId, answer };
  }).filter(item => item.answer.length >= 2);
  if (!normalized.length) throw new Error('Answer at least one of your saved recovery questions.');
  return normalized;
}
function equal(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ (right[i] ?? 0);
  return difference === 0;
}
const derive = (value: string, salt: string): Promise<Uint8Array> => pbkdf2Async(sha256, utf8ToBytes(value), hexToBytes(salt), { c: PIN_ITERATIONS, dkLen: 32, asyncTick: 10 });

/** Credentials never enter the finance repository, backups, audit history, or navigation params. */
export function createActionPinService(deps: ActionPinDependencies) {
  const deriveSecret = async (value: string, salt: string): Promise<Uint8Array> => {
    const result = await (deps.derive ? deps.derive(value, salt, PIN_ITERATIONS) : derive(value, salt));
    if (!(result instanceof Uint8Array) || result.length !== 32) throw new Error('Your action PIN could not be verified. Please try again.');
    return result;
  };
  let pending: Promise<unknown> = Promise.resolve();
  const serial = <T,>(work: () => Promise<T>): Promise<T> => {
    const next = pending.then(work, work); pending = next.catch(() => undefined); return next;
  };
  const save = (record: SecurityRecord) => deps.write(JSON.stringify(record));
  async function read(): Promise<SecurityRecord | null> {
    if (!(await deps.storageAvailable())) throw new Error('Secure storage is unavailable. Unlock your phone and try again.');
    const raw = await deps.read(); if (raw === null) return null;
    let record: SecurityRecord;
    try { record = JSON.parse(raw) as SecurityRecord; } catch { throw new Error('Your action PIN could not be read. The protected action is blocked.'); }
    const validHash = (secret: SecretHash | undefined) => !!secret && typeof secret.salt === 'string' && secret.salt.length === 64 && /^[0-9a-f]{64}$/.test(secret.salt) && typeof secret.hash === 'string' && secret.hash.length === 64 && /^[0-9a-f]{64}$/.test(secret.hash);
    if (!record || ![1,2].includes(record.version) || (record.version === 1 ? record.pinLength !== undefined : record.pinLength !== 4) || record.algorithm !== 'pbkdf2-sha256' || record.iterations !== PIN_ITERATIONS || !validHash(record.pin)
      || !Array.isArray(record.recovery) || record.recovery.length !== 2 || Array.from(record.recovery).some(item => !validHash(item) || !questionIds.has(item.questionId)) || record.recovery[0].questionId === record.recovery[1].questionId
      || !Number.isSafeInteger(record.failedAttempts) || record.failedAttempts < 0 || record.failedAttempts > 1_000_000 || !Number.isSafeInteger(record.lockedUntil) || record.lockedUntil < 0) {
      throw new Error('Your action PIN could not be verified. The protected action is blocked.');
    }
    return record;
  }
  async function secret(value: string): Promise<SecretHash> {
    const random = await deps.randomBytes(32); if (random.length !== 32) throw new Error('A secure PIN could not be created. Try again.');
    const salt = bytesToHex(random); return { salt, hash: bytesToHex(await deriveSecret(value, salt)) };
  }
  async function beginAttempt(record: SecurityRecord): Promise<void> {
    if (record.lockedUntil > deps.now()) throw new Error(`Too many attempts. Try again in ${Math.ceil((record.lockedUntil - deps.now()) / 1000)} seconds.`);
    const failedAttempts = Math.min(1_000_000, record.failedAttempts + 1);
    const seconds = failedAttempts < 5 ? 0 : Math.min(900, 30 * 2 ** Math.min(5, failedAttempts - 5));
    // Persist the attempt before hashing so closing the app cannot erase a failed attempt.
    await save({ ...record, failedAttempts, lockedUntil: seconds ? deps.now() + seconds * 1000 : 0 });
  }
  async function checkPin(record: SecurityRecord, pin: string, resetOnSuccess = true): Promise<boolean> {
    await beginAttempt(record);
    const correct = isPin(pin, pinLength(record)) && equal(await deriveSecret(pin, record.pin.salt), hexToBytes(record.pin.hash));
    if (correct && resetOnSuccess) await save({ ...record, failedAttempts: 0, lockedUntil: 0 });
    return correct;
  }
  async function requireRecord(): Promise<SecurityRecord> { const record = await read(); if (!record) throw new Error('Set up an action PIN and two recovery questions first.'); return record; }
  async function recoverySecrets(input: RecoveryAnswer[]): Promise<SecurityRecord['recovery']> {
    const normalized = answers(input);
    const first = { questionId: normalized[0].questionId, ...await secret(normalized[0].answer) };
    const second = { questionId: normalized[1].questionId, ...await secret(normalized[1].answer) };
    return [first, second];
  }
  return {
    getState: (): Promise<ActionPinState> => serial(async () => { const record = await read(); return { hasPin: !!record, pinLength: pinLength(record), questionIds: record?.recovery.map(item => item.questionId) ?? [], lockedUntil: record?.lockedUntil ?? 0 }; }),
    setup: (pin: string, recovery: RecoveryAnswer[]): Promise<void> => serial(async () => {
      validatePin(pin); answers(recovery);
      if (await read()) throw new Error('An action PIN already exists. Use Change PIN or Forgot PIN.');
      await save({ version: 2, pinLength: 4, algorithm: 'pbkdf2-sha256', iterations: PIN_ITERATIONS, pin: await secret(pin), recovery: await recoverySecrets(recovery), failedAttempts: 0, lockedUntil: 0 });
    }),
    verifyPin: (pin: string): Promise<boolean> => serial(async () => checkPin(await requireRecord(), pin)),
    changePin: (currentPin: string, newPin: string): Promise<void> => serial(async () => {
      validatePin(newPin); const record = await requireRecord(); if (!(await checkPin(record, currentPin, false))) throw new Error('The current PIN is incorrect.');
      await save({ ...record, version: 2, pinLength: 4, pin: await secret(newPin), failedAttempts: 0, lockedUntil: 0 });
    }),
    recoverPin: (input: RecoveryAnswer[], newPin: string): Promise<void> => serial(async () => {
      validatePin(newPin); const record = await requireRecord(); await beginAttempt(record);
      const normalized = recoveryAttempts(input, record);
      let correct = false;
      for (const supplied of normalized) {
        const stored = record.recovery.find(item => item.questionId === supplied.questionId)!;
        const hash = await deriveSecret(supplied.answer, stored.salt);
        if (equal(hash, hexToBytes(stored.hash))) { correct = true; break; }
      }
      if (!correct) throw new Error('Neither recovery answer matches. Try either saved answer again.');
      await save({ ...record, version: 2, pinLength: 4, pin: await secret(newPin), failedAttempts: 0, lockedUntil: 0 });
    }),
    updateRecovery: (currentPin: string, input: RecoveryAnswer[]): Promise<void> => serial(async () => {
      answers(input); const record = await requireRecord(); if (!(await checkPin(record, currentPin, false))) throw new Error('The current PIN is incorrect.');
      await save({ ...record, recovery: await recoverySecrets(input), failedAttempts: 0, lockedUntil: 0 });
    }),
    /** Called by the protected repository only after SQLite reset succeeds. */
    clearAfterTrackerReset: (): Promise<void> => serial(async () => { await read(); await deps.remove(); }),
  };
}
export type ActionPinService = ReturnType<typeof createActionPinService>;
