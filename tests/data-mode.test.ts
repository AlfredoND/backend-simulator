/** Frozen data mode lifecycle and isolation coverage. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../src/db/index.js';
import { loadConfig } from '../src/core/config.js';
import { ensureSeeded } from '../src/db/seed.js';
import { CONTROL_TOKEN, startTestServer, type TestServer } from './helpers.js';

function createDb() {
  const dir = mkdtempSync(join(tmpdir(), 'backend-sim-mode-'));
  const path = join(dir, 'test.sqlite');
  const config = loadConfig({ dbPath: path, logLevel: 'silent' });
  const db = new Db(path);
  db.initSchema();
  ensureSeeded(db, config);
  return { dir, path, config, db };
}

let productCounter = 0;

async function createProduct(server: TestServer, prefix: string): Promise<number> {
  const unique = `${prefix}-${Date.now()}-${++productCounter}`;
  const response = await server.json('POST', '/api/v1/shop/products', {
    body: {
      sku: unique,
      name: `Producto ${unique}`,
      slug: unique.toLowerCase(),
      category_id: 1,
      price_cents: 1000,
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id;
}

test('congela, restaura y descongela sin tocar la base persistente', () => {
  const { dir, db } = createDb();
  try {
    db.run("INSERT INTO pr_labels(name,color) VALUES ('freeze-baseline','#112233')");
    const persistent = db.count('pr_labels');
    const captured = db;
    assert.throws(() => db.unfreeze());
    const frozen = db.freeze();
    assert.equal(frozen.mode, 'frozen');
    assert.equal(db.mode, 'frozen');
    assert.ok(frozen.baseline_records !== null && frozen.baseline_records >= persistent);
    db.run("INSERT INTO pr_labels(name,color) VALUES ('freeze-working','#445566')");
    assert.equal(db.count('pr_labels'), persistent + 1);
    const restored = db.restoreFrozen();
    assert.equal(restored.mode, 'frozen');
    assert.equal(db.count('pr_labels'), persistent);
    db.run("INSERT INTO pr_labels(name,color) VALUES ('freeze-working-2','#778899')");
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

test('un fallo al congelar conserva la conexión persistente activa', () => {
  const { dir, db } = createDb();
  try {
    db.run('DROP TABLE fin_budgets');
    assert.throws(() => db.freeze());
    assert.equal(db.mode, 'persistent');
    assert.ok(db.count('pr_labels') > 0);
    assert.equal(db.get<{ ok: number }>('SELECT 1 AS ok')?.ok, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('control: expone el modo, protege acciones y valida transiciones', async () => {
  const server = await startTestServer();
  const token = { 'X-Control-Token': CONTROL_TOKEN };
  try {
    for (const path of ['freeze', 'unfreeze', 'restore', 'reset/shop', 'reset', 'seed']) {
      assert.equal((await server.json('POST', `/_control/${path}`)).status, 401, `${path} sin token`);
      assert.equal(
        (await server.json('POST', `/_control/${path}`, { headers: { 'X-Control-Token': 'token-incorrecto' } })).status,
        401,
        `${path} con token incorrecto`,
      );
    }
    let res = await server.json('GET', '/_control/mode');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.mode, 'persistent');
    assert.equal(res.body.data.frozen_at, null);
    res = await server.json('POST', '/_control/freeze', { headers: token });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.mode, 'frozen');
    assert.equal((await server.json('POST', '/_control/freeze', { headers: token })).status, 409);
    const stats = await server.json('GET', '/_control/stats');
    assert.equal(stats.body.data.data_mode.mode, 'frozen');
    assert.equal((await server.json('POST', '/_control/unfreeze', { headers: token })).status, 200);
    assert.equal((await server.json('POST', '/_control/unfreeze', { headers: token })).status, 409);
  } finally {
    await server.close();
  }
});

test('control: los cambios congelados no llegan a la base persistente', async () => {
  const server = await startTestServer();
  const token = { 'X-Control-Token': CONTROL_TOKEN };
  try {
    const marker = await createProduct(server, 'PERSIST');
    assert.equal((await server.json('POST', '/_control/freeze', { headers: token })).status, 200);
    const inside = await createProduct(server, 'INSIDE');
    assert.equal((await server.json('POST', '/_control/unfreeze', { headers: token })).status, 200);
    assert.equal((await server.json('GET', `/api/v1/shop/products/${marker}`)).status, 200);
    assert.equal((await server.json('GET', `/api/v1/shop/products/${inside}`)).status, 404);

    assert.equal((await server.json('POST', '/_control/freeze', { headers: token })).status, 200);
    const restored = await createProduct(server, 'RESTORED');
    const restore = await server.json('POST', '/_control/restore', { headers: token });
    assert.equal(restore.status, 200);
    assert.equal(restore.body.data.restored, 'snapshot');
    assert.equal((await server.json('GET', `/api/v1/shop/products/${restored}`)).status, 404);
    assert.equal((await server.json('GET', `/api/v1/shop/products/${marker}`)).status, 200);
    assert.equal((await server.json('POST', '/_control/unfreeze', { headers: token })).status, 200);
  } finally {
    await server.close();
  }
});

test('control: reset y restore aíslan la copia congelada', async () => {
  const server = await startTestServer();
  const token = { 'X-Control-Token': CONTROL_TOKEN };
  try {
    const marker = await createProduct(server, 'ISOLATED');
    assert.equal((await server.json('POST', '/_control/freeze', { headers: token })).status, 200);
    const frozen = await createProduct(server, 'SHOP-COPY');
    const reset = await server.json('POST', '/_control/reset/shop', { headers: token });
    assert.equal(reset.status, 200);
    assert.equal((await server.json('GET', `/api/v1/shop/products/${marker}`)).status, 404);
    assert.equal((await server.json('GET', `/api/v1/shop/products/${frozen}`)).status, 404);
    const restored = await server.json('POST', '/_control/restore', { headers: token });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.data.restored, 'snapshot');
    assert.equal((await server.json('GET', `/api/v1/shop/products/${marker}`)).status, 200);
    assert.equal((await server.json('POST', '/_control/unfreeze', { headers: token })).status, 200);
    assert.equal((await server.json('GET', `/api/v1/shop/products/${marker}`)).status, 200);
    const seed = await server.json('POST', '/_control/restore', { headers: token });
    assert.equal(seed.status, 200);
    assert.equal(seed.body.data.restored, 'seed');
    assert.equal((await server.json('GET', `/api/v1/shop/products/${marker}`)).status, 404);
  } finally {
    await server.close();
  }
});
