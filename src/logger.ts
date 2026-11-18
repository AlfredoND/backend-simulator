import type { LogLevel } from './config.js';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

export function createLogger(level: LogLevel): Logger {
  const threshold = ORDER[level] ?? 20;
  const emit = (lvl: Exclude<LogLevel, 'silent'>, msg: string, meta?: unknown) => {
    if (ORDER[lvl] < threshold) return;
    const line: Record<string, unknown> = {
      time: new Date().toISOString(),
      level: lvl,
      msg,
    };
    if (meta !== undefined) line.meta = meta;
    const out = lvl === 'error' || lvl === 'warn' ? console.error : console.log;
    out(JSON.stringify(line));
  };
  return {
    debug: (m, x) => emit('debug', m, x),
    info: (m, x) => emit('info', m, x),
    warn: (m, x) => emit('warn', m, x),
    error: (m, x) => emit('error', m, x),
  };
}
