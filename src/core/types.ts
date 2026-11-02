export type SyncStatus = 'synced' | 'pending_create' | 'pending_update' | 'pending_delete' | 'sync_error';
export interface RecordMeta {
  id: string;
  ownerId: string | null;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncStatus: SyncStatus;
  serverVersion: number;
}
export interface Profile extends RecordMeta {
  displayName: string;
  currency: 'PHP';
  baseCurrency: string;
  balanceLabel: string;
  avatarUri: string | null;
  tutorialCompleted: boolean;
  transactionSounds: boolean;
  hapticsEnabled: boolean;
  notificationSound: 'default' | 'chime.wav' | 'pop.wav' | 'none';
  appearance: 'system' | 'light' | 'dark';
  hideBalance: boolean;
  autoLockSeconds: number;
  notificationsEnabled: boolean;
  dailySummaryEnabled: boolean;
  homeShortcuts: string[];
  performanceThresholds: number[];
}
export type TransactionKind = 'income' | 'expense' | 'adjustment_credit' | 'adjustment_debit' | 'goal_contribution' | 'transfer';
export interface Transaction extends RecordMeta {
  kind: TransactionKind;
  amountMinor: number;
  title: string;
  date: string;
  categoryId: string | null;
  notes: string;
  notePhotos: string[];
  goalId: string | null;
  voidedAt: string | null;
  accountId: string;
  destinationAccountId: string | null;
  destinationAmountMinor: number | null;
  baseAmountMinor: number;
  tagIds: string[];
}
export interface Category extends RecordMeta { name: string; icon: string; color: string }
export interface Tag extends RecordMeta { name: string; color: string }
export interface Account extends RecordMeta { name: string; type: 'asset' | 'liability'; currency: string; exchangeRate: number; includedInBalance: boolean; icon: string; color: string }
export interface AccountInput { id?: string; name: string; type: 'asset' | 'liability'; currency: string; exchangeRate: number; includedInBalance: boolean; icon?: string; color?: string; openingBalanceMinor?: number }
export interface DeleteAccountOptions { mode: 'exclude' | 'transfer'; destinationAccountId?: string }
export interface CategoryInput { id?: string; name: string; icon?: string; color?: string }
export interface TagInput { id?: string; name: string; color?: string }
export interface Budget extends RecordMeta { month: string; amountMinor: number }
export type GoalStatus = 'active' | 'paused' | 'completed' | 'archived';
export interface Goal extends RecordMeta {
  name: string;
  imageUri: string | null;
  targetMinor: number;
  durationMonths: number;
  startDate: string;
  paymentDay: number;
  status: GoalStatus;
}
export interface GoalContribution extends RecordMeta { goalId: string; transactionId: string; amountMinor: number; date: string }
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';
export interface Reminder extends RecordMeta {
  title: string;
  dueAt: string;
  recurrence: Recurrence;
  monthlyDay: number | null;
  goalId: string | null;
  status: 'active' | 'completed' | 'dismissed';
}
export interface AuditLog {
  id: string;
  type: string;
  group: 'income' | 'expense' | 'goal' | 'system';
  recordId: string;
  timestamp: string;
  before: string | null;
  after: string | null;
  deviceId: string;
}
export interface Snapshot {
  profile: Profile | null;
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
  goals: Goal[];
  contributions: GoalContribution[];
  reminders: Reminder[];
  auditLogs: AuditLog[];
  accounts: Account[];
  tags: Tag[];
}
export interface TransactionInput {
  id?: string;
  kind: Exclude<TransactionKind, 'goal_contribution'>;
  amountMinor: number;
  title: string;
  date: string;
  categoryId?: string | null;
  notes?: string;
  notePhotos?: string[];
  accountId?: string;
  destinationAccountId?: string | null;
  destinationAmountMinor?: number | null;
  tagIds?: string[];
  allowOverdraft?: boolean;
}
export interface GoalInput { id?: string; name: string; imageUri?: string | null; targetMinor: number; durationMonths: number; startDate: string; paymentDay: number }
export interface ReminderInput { id?: string; title: string; dueAt: string; recurrence: Recurrence; goalId?: string | null }
export interface ContributionInput { id?: string; goalId: string; amountMinor: number; date: string; notes?: string; notePhotos?: string[]; accountId?: string }
export interface TransactionQuery { start?: string; end?: string; search?: string; categoryId?: string; kind?: TransactionKind; includeVoided?: boolean; accountId?: string; tagId?: string }
export interface BackupEnvelope { format: 'ftracker-backup'; version: 1 | 2 | 3 | 4; createdAt: string; data: Snapshot; checksum: string }
export type ProfilePatch = Partial<Pick<Profile, 'displayName' | 'appearance' | 'hideBalance' | 'autoLockSeconds' | 'notificationsEnabled' | 'dailySummaryEnabled' | 'homeShortcuts' | 'performanceThresholds' | 'baseCurrency' | 'balanceLabel' | 'avatarUri' | 'tutorialCompleted' | 'transactionSounds' | 'hapticsEnabled' | 'notificationSound'>>;
export type RecordCollection = 'transactions' | 'accounts' | 'categories' | 'tags' | 'goals' | 'reminders';
export interface FinanceRepository {
  getSnapshot(): Promise<Snapshot>;
  /** Indexed identity lookup used by mutation guards without loading the ledger and photos. */
  hasRecord?(collection: RecordCollection, id: string): Promise<boolean>;
  queryTransactions(query: TransactionQuery): Promise<Transaction[]>;
  setup(input: { displayName: string; openingBalanceMinor: number; monthlyBudgetMinor: number; currency?: string; accountName?: string; balanceLabel?: string }): Promise<void>;
  saveAccount(input: AccountInput): Promise<void>;
  deleteAccount(id: string, options?: DeleteAccountOptions): Promise<string | undefined>;
  saveCategory(input: CategoryInput): Promise<void>;
  deleteCategory(id: string): Promise<void>;
  saveTag(input: TagInput): Promise<void>;
  deleteTag(id: string): Promise<void>;
  importTransactions(inputs: TransactionInput[], newTags?: TagInput[]): Promise<void>;
  saveTransaction(input: TransactionInput): Promise<void>;
  voidTransaction(id: string): Promise<void>;
  setBudget(amountMinor: number, month: string): Promise<void>;
  saveGoal(input: GoalInput): Promise<void>;
  setGoalStatus(id: string, status: GoalStatus): Promise<void>;
  contribute(input: ContributionInput): Promise<string>;
  saveReminder(input: ReminderInput): Promise<void>;
  actReminder(id: string, action: 'complete' | 'dismiss' | 'snooze', snoozeUntil?: string): Promise<void>;
  updateProfile(patch: ProfilePatch): Promise<void>;
  logSystem(type: string, before?: unknown, after?: unknown): Promise<void>;
  createBackup(): Promise<BackupEnvelope>;
  restoreBackup(backup: unknown, replaceExisting?: boolean): Promise<void>;
  clearAllData(): Promise<void>;
}
