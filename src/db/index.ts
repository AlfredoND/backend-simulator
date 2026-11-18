/**
 * @file Thin synchronous SQLite access layer on top of `node:sqlite`.
 *
 * No ORM: table and column names are always internal allowlists and values are
 * bound parameters. WAL improves concurrent reads; `BEGIN IMMEDIATE` serializes
 * write transactions. The schema is idempotent and never removes existing data.
 *
 * `Db` is also a stable facade over the active connection. Frozen mode opens a
 * disposable copy of the persistent database and routes every method through
 * that copy. Handlers keep this object across `await` points, so a mode switch
 * can never leave them writing to the persistent database or a closed handle.
 */
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DOMAIN_TABLES } from './domain-tables.js';

/** Untyped tabular row, shaped by callers before JSON serialization. */
export type Row = Record<string, unknown>;
type SqlValue = string | number | bigint | null | Uint8Array;

/** Active data source selected by the control plane. */
export type DataMode = 'persistent' | 'frozen';

/** Public mode state exposed by `/_control/mode` and statistics. */
export interface DataModeState {
  mode: DataMode;
  frozen_at: string | null;
  baseline_records: number | null;
  active_records: number;
  persistent_records: number;
}

/** Connection-scoped database facade used by routes, seeds and control tools. */
export class Db {
  readonly path: string;
  private readonly persistent: DatabaseSync;
  private active: DatabaseSync;
  private working: DatabaseSync | null = null;
  private freezeDir: string | null = null;
  private snapshotPath: string | null = null;
  private workingPath: string | null = null;
  private frozenAt: string | null = null;
  private baselineRecords: number | null = null;
  private dataMode: DataMode = 'persistent';

  constructor(path: string) {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.persistent = this.open(path);
    this.active = this.persistent;
  }

  /** Opens a connection with the simulator's required PRAGMAs. */
  private open(path: string): DatabaseSync {
    const connection = new DatabaseSync(path);
    connection.exec('PRAGMA foreign_keys = ON;');
    connection.exec('PRAGMA journal_mode = WAL;');
    connection.exec('PRAGMA synchronous = NORMAL;');
    connection.exec('PRAGMA busy_timeout = 5000;');
    return connection;
  }

  /** Active raw handle; internal code and tests should prefer the facade. */
  get raw(): DatabaseSync {
    return this.active;
  }

  /** Current data mode. */
  get mode(): DataMode {
    return this.dataMode;
  }

  /** Returns counts for the active copy and the persistent source. */
  state(): DataModeState {
    return {
      mode: this.dataMode,
      frozen_at: this.frozenAt,
      baseline_records: this.baselineRecords,
      active_records: this.totalRecords(this.active),
      persistent_records: this.totalRecords(this.persistent),
    };
  }

  /**
   * Captures the persistent database into a private temp snapshot and switches
   * the active connection to a disposable copy.
   */
  freeze(): DataModeState {
    if (this.dataMode === 'frozen') throw new Error('La base ya está congelada');
    const dir = mkdtempSync(join(tmpdir(), 'backend-simulator-freeze-'));
    let connection: DatabaseSync | null = null;
    try {
      const snapshot = join(dir, 'baseline.sqlite');
      this.persistent.prepare('VACUUM INTO ?').run(snapshot);
      const work = join(dir, 'working.sqlite');
      copyFileSync(snapshot, work);
      connection = this.open(work);
      this.freezeDir = dir;
      this.snapshotPath = snapshot;
      this.workingPath = work;
      this.working = connection;
      this.active = connection;
      this.frozenAt = new Date().toISOString();
      this.baselineRecords = this.totalRecords(this.persistent);
      this.dataMode = 'frozen';
      return this.state();
    } catch (error) {
      try {
        connection?.close();
      } catch {
        // La conexión pudo fallar antes de abrirse.
      }
      rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  }

  /** Discards the working copy and returns to the persistent database. */
  unfreeze(): DataModeState {
    if (this.dataMode !== 'frozen') throw new Error('La base no está congelada');
    if (this.active !== this.persistent) {
      try {
        this.active.close();
      } catch {
        // La copia pudo cerrarse durante una restauración fallida.
      }
    }
    this.active = this.persistent;
    this.working = null;
    this.cleanupFrozen();
    return this.state();
  }

  /** Recreates the working connection from the frozen snapshot. */
  restoreFrozen(): DataModeState {
    if (this.dataMode !== 'frozen' || !this.freezeDir || !this.snapshotPath) {
      throw new Error('La base no está congelada');
    }
    const nextPath = join(this.freezeDir, `working-${randomUUID()}.sqlite`);
    let next: DatabaseSync;
    try {
      copyFileSync(this.snapshotPath, nextPath);
      next = this.open(nextPath);
    } catch (error) {
      rmSync(nextPath, { force: true });
      throw error;
    }

    const previous = this.active;
    const previousPath = this.workingPath;
    this.active = next;
    this.working = next;
    this.workingPath = nextPath;
    if (previous !== this.persistent) {
      try {
        previous.close();
      } catch {
        // La copia anterior pudo cerrarse durante una restauración fallida.
      }
    }
    if (previousPath) this.removeDatabaseFiles(previousPath);
    return this.state();
  }

  /** Clears frozen metadata and removes the temporary directory. */
  private cleanupFrozen(): void {
    const dir = this.freezeDir;
    this.freezeDir = null;
    this.snapshotPath = null;
    this.workingPath = null;
    this.working = null;
    this.frozenAt = null;
    this.baselineRecords = null;
    this.dataMode = 'persistent';
    if (dir) rmSync(dir, { recursive: true, force: true });
  }

  /** Removes a SQLite database and its WAL sidecars. */
  private removeDatabaseFiles(path: string): void {
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
  }

  /** Sums every business table in a concrete connection. */
  private totalRecords(connection: DatabaseSync): number {
    let total = 0;
    for (const tables of Object.values(DOMAIN_TABLES)) {
      for (const table of tables) {
        const row = connection.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n?: number } | undefined;
        total += Number(row?.n ?? 0);
      }
    }
    return total;
  }

  /** Applies `schema.sql` and records the schema version without reseeding. */
  initSchema(): void {
    const schemaFile = fileURLToPath(new URL('./schema.sql', import.meta.url));
    if (!existsSync(schemaFile)) throw new Error(`No se encontró el esquema en ${schemaFile}`);
    this.active.exec(readFileSync(schemaFile, 'utf8'));
    this.active
      .prepare(
        `INSERT INTO _meta(key, value) VALUES ('schema_version', '1')
       ON CONFLICT(key) DO NOTHING`,
      )
      .run();
  }

  /** Executes internal DDL/multi-statement SQL (never user input). */
  exec(sql: string): void {
    this.active.exec(sql);
  }

  /** Returns one row using positional bound parameters. */
  get<T = Row>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.active.prepare(sql).get(...params) as T | undefined;
  }

  /** Returns all rows using positional bound parameters. */
  all<T = Row>(sql: string, ...params: SqlValue[]): T[] {
    return this.active.prepare(sql).all(...params) as T[];
  }

  /** Executes a mutation and normalizes driver counters. */
  run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number } {
    const result = this.active.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }

  /** Inserts a trusted table name with parameterized values; returns the id. */
  insert(table: string, row: Record<string, SqlValue>): number {
    const columns = Object.keys(row);
    if (columns.length === 0) {
      return Number(this.active.prepare(`INSERT INTO ${table} DEFAULT VALUES`).run().lastInsertRowid);
    }
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
    return Number(this.active.prepare(sql).run(...columns.map((c) => row[c])).lastInsertRowid);
  }

  /** Counts rows in an internal table. */
  count(table: string): number {
    return Number(this.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0);
  }

  /**
   * Runs a synchronous unit of work atomically.
   *
   * `BEGIN IMMEDIATE` reserves the write lock up front; any thrown error rolls
   * back every statement. Nested calls are intentionally unsupported.
   */
  transaction<T>(fn: () => T): T {
    const connection = this.active;
    connection.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      connection.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        connection.exec('ROLLBACK');
      } catch {
        // La transacción ya pudo haber sido revertida por SQLite.
      }
      throw error;
    }
  }

  /** Returns table-level row counts for a known business domain. */
  domainCounts(domain: string): Record<string, number> {
    const tables = DOMAIN_TABLES[domain] ?? [];
    return Object.fromEntries(tables.map((t) => [t, this.count(t)]));
  }

  /** Closes every connection and removes the frozen working directory. */
  close(): void {
    if (this.active !== this.persistent) {
      try {
        this.active.close();
      } catch {
        // La copia ya estaba cerrada.
      }
    }
    this.working = null;
    try {
      this.persistent.close();
    } catch {
      // ya cerrada
    }
    if (this.freezeDir) {
      rmSync(this.freezeDir, { recursive: true, force: true });
      this.freezeDir = null;
    }
  }
}
