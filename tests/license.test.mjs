/** Apache-2.0 license and package metadata checks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('el paquete declara Apache-2.0 y la licencia está presente', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.license, 'Apache-2.0');
  const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
  assert.match(license, /Apache License/);
  assert.match(license, /Version 2\.0/);
  const notice = readFileSync(new URL('../NOTICE', import.meta.url), 'utf8');
  assert.match(notice, /Backend Simulator/);
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must be pinned to an exact version`);
  }
});
