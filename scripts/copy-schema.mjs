/**
 * @file Copies the SQLite schema next to the compiled database module.
 * Keeps `npm run build` portable across platforms without POSIX `mkdir`/`cp`.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const source = resolve('src/db/schema.sql');
const target = resolve('dist/src/db/schema.sql');
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
