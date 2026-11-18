/**
 * @file Thin synchronous SQLite access layer on top of `node:sqlite`.
 *
 * No ORM: table and column names are always internal allowlists and values are
 * bound parameters. WAL improves concurrent reads; `BEGIN IMMEDIATE` serializes
 * write transactions. The schema is idempotent and never removes existing data.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMAIN_TABLES } from './domain-tables.js';

/** Untyped tabular row, shaped by callers before JSON serialization. */
export type Row = Record<string, unknown>;
type SqlValue = string | number | bigint | null | Uint8Array;

/** Connection-scoped database facade used by routes, seeds and control tools. */
export class Db {
  readonly raw: DatabaseSync;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA synchronous = NORMAL;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
  }

  /** Applies `schema.sql` and records the schema version without reseeding. */
  initSchema(): void {
    const schemaFile = fileURLToPath(new URL('./schema.sql', import.meta.url));
    if (!existsSync(schemaFile)) throw new Error(`No se encontró el esquema en ${schemaFile}`);
    this.raw.exec(readFileSync(schemaFile, 'utf8'));
    this.raw.prepare(
      `INSERT INTO _meta(key, value) VALUES ('schema_version', '1')
       ON CONFLICT(key) DO NOTHING`,
    ).run();
  }

  /** Executes internal DDL/multi-statement SQL (never user input). */
  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** Returns one row using positional bound parameters. */
  get<T = Row>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  /** Returns all rows using positional bound parameters. */
  all<T = Row>(sql: string, ...params: SqlValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  /** Executes a mutation and normalizes driver counters. */
  run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number } {
    const result = this.raw.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }

  /** Inserts a trusted table name with parameterized values; returns the id. */
  insert(table: string, row: Record<string, SqlValue>): number {
    const columns = Object.keys(row);
    if (columns.length === 0) {
      return Number(this.raw.prepare(`INSERT INTO ${table} DEFAULT VALUES`).run().lastInsertRowid);
    }
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
    return Number(this.raw.prepare(sql).run(...columns.map((c) => row[c])).lastInsertRowid);
  }

  /** Counts rows in an internal table. */
  count(table: string): number {
    return Number((this.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0));
  }

  /**
   * Runs a synchronous unit of work atomically.
   *
   * `BEGIN IMMEDIATE` reserves the write lock up front; any thrown error rolls
   * back every statement. Nested calls are intentionally unsupported.
   */
  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.raw.exec('ROLLBACK');
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

  close(): void {
    try {
      this.raw.close();
    } catch {
      // ya cerrada
    }
  }
}
