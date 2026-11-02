export type SqlValue = string | number | null;
export interface SqlConnection {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
}
export interface Database extends SqlConnection {
  transaction<T>(work: (tx: SqlConnection) => Promise<T>): Promise<T>;
}
export interface RepositoryDependencies {
  uuid(): string;
  now(): string;
  deviceId: string;
  digest(text: string): Promise<string>;
}
