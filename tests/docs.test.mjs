import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const docs = [
  ...fs.readdirSync(root).filter((name) => name.endsWith('.md')),
  ...fs.readdirSync(path.join(root, 'docs')).filter((name) => name.endsWith('.md')).map((name) => `docs/${name}`),
];

test('toda la documentación Markdown tiene versión en español e inglés', () => {
  const english = docs.filter((file) => file.endsWith('.en.md'));
  const spanish = docs.filter((file) => !file.endsWith('.en.md'));
  for (const file of spanish) {
    const counterpart = file.replace(/\.md$/, '.en.md');
    assert.ok(docs.includes(counterpart), `missing English version for ${file}`);
  }
  for (const file of english) {
    const counterpart = file.replace(/\.en\.md$/, '.md');
    assert.ok(docs.includes(counterpart), `missing Spanish version for ${file}`);
  }
});

test('los enlaces locales de la documentación existen', () => {
  for (const file of docs) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      let target = match[1].split('#')[0];
      if (!target || /^(https?:|mailto:)/.test(target)) continue;
      const resolved = path.resolve(path.dirname(path.join(root, file)), target);
      assert.ok(fs.existsSync(resolved), `${file} links to missing ${target}`);
    }
  }
});

test('cada documento enlaza con su versión en el otro idioma', () => {
  for (const file of docs) {
    const content = fs.readFileSync(path.join(root, file), 'utf8').slice(0, 2_000);
    const counterpart = file.endsWith('.en.md')
      ? path.basename(file).replace(/\.en\.md$/, '.md')
      : path.basename(file).replace(/\.md$/, '.en.md');
    assert.ok(content.includes(counterpart), `${file} does not link to ${counterpart}`);
  }
});
