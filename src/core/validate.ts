import { validationError } from './errors.js';

type Value = string | number | boolean | null;

export interface FieldOptions {
  required?: boolean;
  nullable?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  enum?: readonly string[];
  pattern?: RegExp;
  email?: boolean;
  default?: unknown;
}

export class Validator {
  private readonly input: Record<string, unknown>;
  private readonly errors: Array<{ field: string; message: string }> = [];
  readonly values: Record<string, unknown> = {};

  constructor(input: unknown, allowed?: string[]) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw validationError([{ field: '$', message: 'El cuerpo debe ser un objeto JSON' }]);
    }
    this.input = input as Record<string, unknown>;
    if (allowed) {
      for (const key of Object.keys(this.input)) {
        if (!allowed.includes(key)) this.errors.push({ field: key, message: 'campo desconocido' });
      }
    }
  }

  private raw(name: string): { present: boolean; value: unknown } {
    return {
      present: Object.prototype.hasOwnProperty.call(this.input, name),
      value: this.input[name],
    };
  }

  private pre(name: string, opts: FieldOptions): { present: boolean; value: unknown } | undefined {
    const { present, value } = this.raw(name);
    if (!present) {
      if (opts.default !== undefined) {
        this.values[name] = opts.default;
        return undefined;
      }
      if (opts.required) this.errors.push({ field: name, message: 'es obligatorio' });
      return undefined;
    }
    if (value === null) {
      if (opts.nullable) {
        this.values[name] = null;
        return undefined;
      }
      this.errors.push({ field: name, message: 'no admite null' });
      return undefined;
    }
    return { present, value };
  }

  string(name: string, opts: FieldOptions = {}): string | undefined {
    const entry = this.pre(name, opts);
    if (!entry) return this.values[name] as string | undefined;
    if (typeof entry.value !== 'string') {
      this.errors.push({ field: name, message: 'debe ser texto' });
      return undefined;
    }
    const value = entry.value;
    const max = opts.maxLength ?? 10_000;
    if (value.length > max) this.errors.push({ field: name, message: `máximo ${max} caracteres` });
    if (opts.required && value.length === 0) this.errors.push({ field: name, message: 'no puede estar vacío' });
    if (opts.min !== undefined && value.length < opts.min) this.errors.push({ field: name, message: `mínimo ${opts.min} caracteres` });
    if (opts.enum && !opts.enum.includes(value)) this.errors.push({ field: name, message: `valor no permitido (${opts.enum.join(', ')})` });
    if (opts.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) this.errors.push({ field: name, message: 'email inválido' });
    if (opts.pattern && !opts.pattern.test(value)) this.errors.push({ field: name, message: 'formato inválido' });
    this.values[name] = value;
    return value;
  }

  integer(name: string, opts: FieldOptions = {}): number | undefined {
    const entry = this.pre(name, opts);
    if (!entry) return this.values[name] as number | undefined;
    if (typeof entry.value !== 'number' || !Number.isInteger(entry.value)) {
      this.errors.push({ field: name, message: 'debe ser un entero' });
      return undefined;
    }
    const value = entry.value;
    if (opts.min !== undefined && value < opts.min) this.errors.push({ field: name, message: `mínimo ${opts.min}` });
    if (opts.max !== undefined && value > opts.max) this.errors.push({ field: name, message: `máximo ${opts.max}` });
    this.values[name] = value;
    return value;
  }

  number(name: string, opts: FieldOptions = {}): number | undefined {
    const entry = this.pre(name, opts);
    if (!entry) return this.values[name] as number | undefined;
    if (typeof entry.value !== 'number' || !Number.isFinite(entry.value)) {
      this.errors.push({ field: name, message: 'debe ser un número' });
      return undefined;
    }
    const value = entry.value;
    if (opts.min !== undefined && value < opts.min) this.errors.push({ field: name, message: `mínimo ${opts.min}` });
    if (opts.max !== undefined && value > opts.max) this.errors.push({ field: name, message: `máximo ${opts.max}` });
    this.values[name] = value;
    return value;
  }

  boolean(name: string, opts: FieldOptions = {}): boolean | undefined {
    const entry = this.pre(name, opts);
    if (!entry) return this.values[name] as boolean | undefined;
    if (typeof entry.value !== 'boolean') {
      this.errors.push({ field: name, message: 'debe ser booleano' });
      return undefined;
    }
    this.values[name] = entry.value;
    return entry.value;
  }

  date(name: string, opts: FieldOptions = {}): string | undefined {
    const value = this.string(name, opts);
    if (value !== undefined && value !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
        this.errors.push({ field: name, message: 'fecha inválida (YYYY-MM-DD)' });
        return undefined;
      }
    }
    return value;
  }

  datetime(name: string, opts: FieldOptions = {}): string | undefined {
    const value = this.string(name, opts);
    if (value !== undefined && value !== null) {
      if (Number.isNaN(Date.parse(value))) {
        this.errors.push({ field: name, message: 'fecha/hora inválida (ISO-8601)' });
        return undefined;
      }
    }
    return value;
  }

  array(name: string, opts: FieldOptions = {}): unknown[] | undefined {
    const entry = this.pre(name, opts);
    if (!entry) return this.values[name] as unknown[] | undefined;
    if (!Array.isArray(entry.value)) {
      this.errors.push({ field: name, message: 'debe ser un array' });
      return undefined;
    }
    this.values[name] = entry.value;
    return entry.value;
  }

  done(): Record<string, unknown> {
    if (this.errors.length > 0) throw validationError(this.errors);
    return this.values;
  }
}

export function asInt(value: Value, field: string): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  throw validationError([{ field, message: 'debe ser un entero' }]);
}
