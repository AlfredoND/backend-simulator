/** Frozen data mode lifecycle and isolation coverage. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../src/db/index.js';
import { loadConfig } from '../src/core/config.js';
import { ensureSeeded } from '../src/db/seed.js';

function createDb() {
  const dir = mkdtempSync(join(tmpdir(), 'backend-sim-mode-'));
  const path = join(dir, 'test.sqlite');
  const config = loadConfig({ dbPath: path, logLevel: 'silent' });
  const db = new Db(path);
  db.initSchema();
  ensureSeeded(db, config);
  return { dir, path, config, db };
}

test('congela, restaura y descongela sin tocar la base persistente', () => {
  const { dir, db } = createDb();
  try {
    db.run("INSERT INTO pr_labels(name,color) VALUES ('freeze-baseline','#112233')");
    const persistent = db.count('pr_labels');
    assert.throws(() => db.unfreeze());
    const frozen = db.freeze();
    assert.equal(frozen.mode, 'frozen');
    assert.equal(db.mode, 'frozen');
    assert.ok(frozen.baseline_records! >= persistent);
    db.run("INSERT INTO pr_labels(name,color) VALUES ('freeze-working','#445566')");
    assert.equal(db.count('pr_labels'), persistent + 1);
    const restored = db.restoreFrozen();
    assert.equal(restored.mode, 'frozen');
    assert.equal(db.count('pr_labels'), persistent);
    db.run("INSERT INTO pr_labels(name,color) VALUES ('freeze-working-2','#778899')");
    const captured = db;
    captured.run("INSERT INTO pr_labels(name,color) VALUES ('captured-before-freeze','#101010')");
    db.unfreeze();
    assert.equal(db.mode, 'persistent');
    assert.equal(db.count('pr_labels'), persistent);
    assert.equal(db.get("SELECT 1 AS x FROM pr_labels WHERE name = 'freeze-baseline'")?.x, 1);
    assert.equal(db.get("SELECT 1 AS x FROM pr_labels WHERE name = 'freeze-working'"), undefined);
    assert.equal(db.get("SELECT 1 AS x FROM pr_labels WHERE name = 'captured-before-freeze'"), undefined);
    captured.run("INSERT INTO pr_labels(name,color) VALUES ('captured-after-unfreeze','#202020')");
    assert.equal(db.get("SELECT 1 AS x FROM pr_labels WHERE name = 'captured-after-unfreeze'")?.x, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('un cierre en congelado deja intacta la base persistente', () => {
  const { dir, path, config, db } = createDb();
  try {
    db.run("INSERT INTO pr_labels(name,color) VALUES ('persist-close','#aabbcc')");
    db.freeze();
    db.run("INSERT INTO pr_labels(name,color) VALUES ('frozen-close','#ddeeff')");
    db.close();
    const reopened = new Db(path);
    try {
      reopened.initSchema();
      assert.equal(ensureSeeded(reopened, config), false);
      assert.equal(reopened.mode, 'persistent');
      assert.equal(reopened.get("SELECT 1 AS x FROM pr_labels WHERE name = 'persist-close'")?.x, 1);
      assert.equal(reopened.get("SELECT 1 AS x FROM pr_labels WHERE name = 'frozen-close'"), undefined);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
