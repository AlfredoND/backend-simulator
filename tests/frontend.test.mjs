/** Pure micro frontend helpers and i18n/DOM contract checks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { t } from '../web/js/i18n.js';
import {
  buildRequestUrl,
  decodeResponseBody,
  formatBytes,
  formatDuration,
  formatUptime,
  headerRowsToObject,
  headersToRows,
  isValidHttpUrl,
  normalizeBaseUrl,
  prettyPayload,
  statusTone,
  truncateText,
} from '../web/js/lib.js';

test('normaliza bases y construye URLs de petición', () => {
  assert.equal(normalizeBaseUrl(' http://localhost:4000/// '), 'http://localhost:4000');
  assert.equal(normalizeBaseUrl('localhost:4000'), 'http://localhost:4000');
  assert.equal(buildRequestUrl('http://localhost:4000', '/test/echo'), 'http://localhost:4000/test/echo');
  assert.equal(buildRequestUrl('http://localhost:4000/', 'api/v1'), 'http://localhost:4000/api/v1');
  assert.equal(buildRequestUrl('http://localhost:4000', 'https://example.test/x'), 'https://example.test/x');
  assert.equal(isValidHttpUrl('https://localhost:4443'), true);
  assert.equal(isValidHttpUrl('ftp://localhost'), false);
});

test('formatea bytes, duraciones y uptime', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatDuration(42), '42 ms');
  assert.equal(formatDuration(1250), '1.25 s');
  assert.equal(formatUptime(45), '45s');
  assert.equal(formatUptime(125), '2m');
  assert.equal(formatUptime(3725), '1h 2m');
});

test('clasifica estados y normaliza payloads JSON', () => {
  assert.equal(statusTone(204), 'success');
  assert.equal(statusTone(302), 'redirect');
  assert.equal(statusTone(418), 'warning');
  assert.equal(statusTone(503), 'error');
  assert.equal(prettyPayload('{"a":1}', 'application/json'), '{\n  "a": 1\n}');
  assert.equal(prettyPayload('not json', 'text/plain'), 'not json');
});

test('decodifica cuerpos de texto y binarios', () => {
  const text = new TextEncoder().encode('hola');
  const decoded = decodeResponseBody(text, 'text/plain');
  assert.equal(decoded.text, 'hola');
  assert.equal(decoded.binary, false);

  const binary = decodeResponseBody(new Uint8Array([0, 15, 255]), 'application/octet-stream');
  assert.equal(binary.binary, true);
  assert.equal(binary.preview, '00 0f ff');
});

test('convierte headers entre filas y objeto', () => {
  const rows = headersToRows({ 'Content-Type': 'application/json', 'X-Test': 'one' });
  assert.deepEqual(rows, [
    { name: 'Content-Type', value: 'application/json' },
    { name: 'X-Test', value: 'one' },
  ]);
  assert.deepEqual(headerRowsToObject([
    { name: ' Authorization ', value: ' Bearer demo ' },
    { name: '', value: 'ignored' },
  ]), { Authorization: 'Bearer demo' });
});

test('trunca cuerpos grandes', () => {
  const short = truncateText('abc', 10);
  assert.deepEqual(short, { text: 'abc', truncated: false });
  const long = truncateText('abcdefghijklmnop', 10);
  assert.equal(long.truncated, true);
  assert.match(long.text, /6 more characters/);
});

test('las traducciones cubren el HTML y los IDs usados por la UI existen', () => {
  const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-placeholder|-aria-label|-title)?="([^"]+)"/g)].map((match) => match[1]);
  for (const key of new Set(keys)) {
    assert.notEqual(t('es', key), key, `missing Spanish translation: ${key}`);
    assert.notEqual(t('en', key), key, `missing English translation: ${key}`);
  }
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  const referenced = [...main.matchAll(/\$\('#([^']+)'\)/g)].map((match) => match[1]);
  for (const id of referenced) assert.ok(ids.has(id), `missing DOM id: ${id}`);
});
