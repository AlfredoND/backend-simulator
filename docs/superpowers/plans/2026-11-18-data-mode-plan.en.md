# Frozen Data Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a frozen data mode with a disposable copy, restore of the image or seed data, web controls, and the Apache-2.0 license.

**Architecture:** `Db` becomes a stable facade over the active connection. Frozen mode creates a `VACUUM INTO` snapshot, opens a temporary copy, and switches the active connection; handlers keep the facade, not the raw connection. Unfreezing closes the copy and returns to the untouched persistent database.

**Tech Stack:** Node.js 24, strict TypeScript, `node:sqlite`, `node:http`, vanilla ES-module frontend, SQLite WAL.

**Spec:** [Data mode design](../specs/2026-11-18-data-mode-design.en.md)

## Global Constraints

- Node.js >= 24, strict TypeScript, `node:sqlite`, no ORM.
- No new runtime dependencies.
- The persistent database must not be modified while frozen.
- Destructive actions require `X-Control-Token`.
- Frozen mode does not survive a restart; the persistent database does.
- Apache-2.0 license with `LICENSE`, `NOTICE`, and `"license": "Apache-2.0"`.
- All new documentation must exist in Spanish and English.
- No secrets, SQLite databases, certificates, or generated files in Git.
- Conventional Commits, split by logical block.

## Review Focus

- **In-flight request during `freeze`:** a captured `Db` reference must keep operating on the active connection, not the persistent one. Test by inserting through a reference captured before freezing and verifying the persistent database is unchanged.
- **In-flight request during `restore`/`unfreeze`:** the facade must not point at a closed connection. Test by restoring and writing again through the same reference.
- **WAL with committed writes before the snapshot:** the image must include them. Test by inserting before `freeze` and verifying the row exists in the copy.
- **Abrupt close while frozen:** the persistent database must remain intact and the next startup must treat it as the source of truth. Test by closing without `unfreeze` and reopening.
- **Reset while frozen:** it must affect only the copy; after unfreezing, the persistent database keeps its data. Test with `/_control/reset/shop` and `unfreeze`.
- **Invalid transitions or missing token:** `freeze` twice, `unfreeze` in persistent mode, and actions without a token must return `409`/`401`. Test over HTTP.

---

### Task 0: Commit the design and plan

**Files:**
- `docs/superpowers/specs/2026-11-18-data-mode-design.md`
- `docs/superpowers/specs/2026-11-18-data-mode-design.en.md`
- `docs/superpowers/plans/2026-11-18-data-mode-plan.md`
- `docs/superpowers/plans/2026-11-18-data-mode-plan.en.md`

- [ ] **Step 1: Commit the approved documentation**

```bash
git add docs/superpowers/specs/2026-11-18-data-mode-design.md docs/superpowers/specs/2026-11-18-data-mode-design.en.md docs/superpowers/plans/2026-11-18-data-mode-plan.md docs/superpowers/plans/2026-11-18-data-mode-plan.en.md
git commit -m "docs: add data mode design and implementation plan"
```

---

### Task 1: Data lifecycle in `Db`

**Files:**
- Modify: `src/db/index.ts`
- Test: `tests/data-mode.test.ts`

**Interfaces:**
- Consumes: current `Db`, `DOMAIN_TABLES`, `node:sqlite`.
- Produces:
  - `export type DataMode = 'persistent' | 'frozen'`
  - `export interface DataModeState { mode: DataMode; frozen_at: string | null; baseline_records: number | null; active_records: number; persistent_records: number }`
  - `Db.mode: DataMode` (getter)
  - `Db.state(): DataModeState`
  - `Db.freeze(): DataModeState`
  - `Db.unfreeze(): DataModeState`
  - `Db.restoreFrozen(): DataModeState`
  - `Db.close()` still closes everything.

- [ ] **Step 1: Write the failing core tests**

Create `tests/data-mode.test.ts` with a helper using `mkdtempSync`, `Db`, `loadConfig`, `ensureSeeded`, and `rmSync`. The tests must be:

```ts
test('freezes, restores and unfreezes without touching the persistent database', () => {
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
});

test('closing while frozen leaves the persistent database intact', () => {
  db.run("INSERT INTO pr_labels(name,color) VALUES ('persist-close','#aabbcc')");
  db.freeze();
  db.run("INSERT INTO pr_labels(name,color) VALUES ('frozen-close','#ddeeff')");
  db.close();
  const reopened = new Db(path);
  reopened.initSchema();
  assert.equal(ensureSeeded(reopened, config), false);
  assert.equal(reopened.mode, 'persistent');
  assert.equal(reopened.get("SELECT 1 AS x FROM pr_labels WHERE name = 'persist-close'")?.x, 1);
  assert.equal(reopened.get("SELECT 1 AS x FROM pr_labels WHERE name = 'frozen-close'"), undefined);
  reopened.close();
});
```

The `captured` reference is taken before `unfreeze`: the `captured-before-freeze` insert must end up in the frozen copy, not the persistent database; `captured-after-unfreeze` must work after unfreezing without using a closed connection.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/data-mode.test.ts`
Expected: FAIL because `freeze`, `unfreeze`, `restoreFrozen`, `state`, or `mode` do not exist.

- [ ] **Step 3: Implement the facade and lifecycle in `src/db/index.ts`**

Turn `raw` into a facade over `this.active`:

- `private readonly persistent: DatabaseSync`, `private active: DatabaseSync`.
- `private open(path): DatabaseSync` applies the current PRAGMAs.
- `get raw()` returns `this.active`; `get mode()` returns `this.dataMode`.
- Every method (`initSchema`, `exec`, `get`, `all`, `run`, `insert`, `transaction`) uses `this.active`.
- `freeze()`:
  - Rejects when already frozen.
  - `mkdtempSync(join(tmpdir(), 'backend-simulator-freeze-'))`.
  - `this.persistent.prepare('VACUUM INTO ?').run(snapshotPath)`.
  - Copies the snapshot to `working.sqlite`, opens it with `open`, and changes `active`.
  - Stores `frozenAt` and `baselineRecords = totalRecords(persistent)`.
  - Cleans the directory on failure.
- `restoreFrozen()`:
  - Rejects when not frozen.
  - Copies the snapshot to `working-${randomUUID()}.sqlite`, opens it, changes `active`, closes the previous copy, and removes its files.
  - If opening fails, keeps the previous copy.
- `unfreeze()`:
  - Rejects when not frozen.
  - Closes `active`, switches back to `persistent`, cleans the directory and frozen state.
- `close()` closes `active` when it differs from `persistent`, closes `persistent`, and removes the temp directory.
- `totalRecords(connection)` sums `COUNT(*)` over every table in `DOMAIN_TABLES`.
- `removeDatabaseFiles(path)` removes `path`, `path-wal`, and `path-shm`.
- Add JSDoc for the facade and isolation decisions.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/data-mode.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/index.ts tests/data-mode.test.ts
git commit -m "feat(db): add frozen data mode lifecycle"
```

---

### Task 2: Control endpoints and OpenAPI contract

**Files:**
- Modify: `src/control/index.ts`
- Modify: `src/http/openapi.ts`
- Modify: `src/http/openapi-i18n.ts`
- Modify: `tests/data-mode.test.ts`
- Modify: `tests/openapi.test.ts`

**Interfaces:**
- Consumes: `Db.mode`, `Db.state()`, `Db.freeze()`, `Db.unfreeze()`, `Db.restoreFrozen()`.
- Produces:
  - `GET /_control/mode` → `{ data: DataModeState }`
  - `POST /_control/freeze` → `{ data: DataModeState }`
  - `POST /_control/unfreeze` → `{ data: DataModeState }`
  - `POST /_control/restore` → `{ data: DataModeState & { restored: 'snapshot' | 'seed' } }`
  - `GET /_control/stats` includes `data_mode: DataModeState`.
  - Reset responses include `mode`.

- [ ] **Step 1: Write the failing API tests**

Add to `tests/data-mode.test.ts`:

```ts
test('control: exposes the mode, protects actions and validates transitions', async () => {
  const server = await startTestServer();
  const token = { 'X-Control-Token': CONTROL_TOKEN };
  let res = await server.json('GET', '/_control/mode');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.mode, 'persistent');
  assert.equal(res.body.data.frozen_at, null);
  assert.equal((await server.json('POST', '/_control/freeze')).status, 401);
  res = await server.json('POST', '/_control/freeze', { headers: token });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.mode, 'frozen');
  assert.equal((await server.json('POST', '/_control/freeze', { headers: token })).status, 409);
  const stats = await server.json('GET', '/_control/stats');
  assert.equal(stats.body.data.data_mode.mode, 'frozen');
  assert.equal((await server.json('POST', '/_control/unfreeze', { headers: token })).status, 200);
  assert.equal((await server.json('POST', '/_control/unfreeze', { headers: token })).status, 409);
  await server.close();
});

test('control: frozen changes do not reach the persistent database', async () => {
  const server = await startTestServer();
  const token = { 'X-Control-Token': CONTROL_TOKEN };
  const marker = await createProduct(server, 'PERSIST');
  assert.equal((await server.json('POST', '/_control/freeze', { headers: token })).status, 200);
  const inside = await createProduct(server, 'INSIDE');
  await server.json('POST', '/_control/unfreeze', { headers: token });
  assert.equal((await server.json('GET', `/api/v1/shop/products/${marker}`)).status, 200);
  assert.equal((await server.json('GET', `/api/v1/shop/products/${inside}`)).status, 404);

  await server.json('POST', '/_control/freeze', { headers: token });
  const restored = await createProduct(server, 'RESTORED');
  const restore = await server.json('POST', '/_control/restore', { headers: token });
  assert.equal(restore.body.data.restored, 'snapshot');
  assert.equal((await server.json('GET', `/api/v1/shop/products/${restored}`)).status, 404);
  assert.equal((await server.json('GET', `/api/v1/shop/products/${marker}`)).status, 200);
  await server.json('POST', '/_control/unfreeze', { headers: token });
  await server.close();
});

test('control: reset and restore isolate the frozen copy', async () => {
  const server = await startTestServer();
  const token = { 'X-Control-Token': CONTROL_TOKEN };
  const marker = await createProduct(server, 'ISOLATED');
  await server.json('POST', '/_control/freeze', { headers: token });
  const frozen = await createProduct(server, 'SHOP-COPY');
  const reset = await server.json('POST', '/_control/reset/shop', { headers: token });
  assert.equal(reset.status, 200);
  assert.equal((await server.json('GET', `/api/v1/shop/products/${marker}`)).status, 404);
  assert.equal((await server.json('GET', `/api/v1/shop/products/${frozen}`)).status, 404);
  const restored = await server.json('POST', '/_control/restore', { headers: token });
  assert.equal(restored.body.data.restored, 'snapshot');
  assert.equal((await server.json('GET', `/api/v1/shop/products/${marker}`)).status, 200);
  await server.json('POST', '/_control/unfreeze', { headers: token });
  assert.equal((await server.json('GET', `/api/v1/shop/products/${marker}`)).status, 200);
  const seed = await server.json('POST', '/_control/restore', { headers: token });
  assert.equal(seed.body.data.restored, 'seed');
  assert.equal((await server.json('GET', `/api/v1/shop/products/${marker}`)).status, 404);
  await server.close();
});
```

Add a `createProduct(server, prefix): Promise<number>` helper that sends `POST /api/v1/shop/products` with unique `sku`, `name`, `slug`, and `category_id: 1`, and returns `body.data.id`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/data-mode.test.ts`
Expected: FAIL with 404 for `/_control/mode` and `/_control/freeze`.

- [ ] **Step 3: Implement the control routes**

In `src/control/index.ts`:

- `stats()` adds `data_mode: db.state()`.
- `GET /_control/mode` is public, tag `Control`.
- `POST /_control/freeze`: requires token; if `db.mode === 'frozen'` throws `conflict('The database is already frozen')`; otherwise calls `db.freeze()`.
- `POST /_control/unfreeze`: requires token; if not frozen throws `conflict('The database is not frozen')`; otherwise calls `db.unfreeze()`.
- `POST /_control/restore`: requires token; while frozen uses `db.restoreFrozen()` and adds `restored: 'snapshot'`; in persistent mode uses `resetAll(db, config)` and adds `restored: 'seed'`.
- Existing reset responses add `mode: db.mode` to `data`.
- `GET /_control/config` adds `data_mode: db.mode`.
- OpenAPI metadata uses `summary`, `summaryEn`, `tag: 'Control'`, and `security: [{ controlToken: [] }]` on POST routes.
  - `Estado del modo de datos` / `Data mode status`
  - `Congela la base actual en una copia descartable` / `Freeze the current database into a disposable copy`
  - `Descarta la copia congelada y vuelve a la base persistente` / `Discard the frozen copy and return to the persistent database`
  - `Restaura la imagen congelada o los datos semilla` / `Restore the frozen image or seed data`
- Update `TAG_DESCRIPTIONS.Control` to `Estadísticas, reseteo, modo de datos y datos adicionales.` and `TAG_DESCRIPTIONS_EN.Control` to `Statistics, reset, data mode and extra data.`.

- [ ] **Step 4: Add OpenAPI assertions**

In `tests/openapi.test.ts`, inside the first test or a new one, verify:

```ts
assert.ok(es.body.paths['/_control/mode'].get);
assert.ok(es.body.paths['/_control/freeze'].post);
assert.equal(enOps['GET /_control/mode'].summary, 'Data mode status');
assert.equal(enOps['POST /_control/freeze'].summary, 'Freeze the current database into a disposable copy');
assert.equal(en.body.tags.find((tag: any) => tag.name === 'Control').description, 'Statistics, reset, data mode and extra data.');
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --import tsx --test tests/data-mode.test.ts tests/openapi.test.ts`
Expected: PASS (5 data tests + existing OpenAPI tests).

- [ ] **Step 6: Commit**

```bash
git add src/control/index.ts src/http/openapi.ts src/http/openapi-i18n.ts tests/data-mode.test.ts tests/openapi.test.ts
git commit -m "feat(control): expose data mode endpoints"
```

---

### Task 3: Data mode panel in the console

**Files:**
- Modify: `web/index.html`
- Modify: `web/styles.css`
- Modify: `web/js/api.js`
- Modify: `web/js/i18n.js`
- Modify: `web/js/main.js`
- Test: `tests/frontend.test.mjs`

**Interfaces:**
- Consumes: `GET /_control/mode`, `POST /_control/freeze|unfreeze|restore` with `X-Control-Token`.
- Produces: `controlRequest(baseUrl, path, { method, token, signal })` in `web/js/api.js`.
- DOM IDs: `mode-badge`, `mode-description`, `control-token`, `mode-freeze`, `mode-restore`, `mode-unfreeze`, `mode-message`.

- [ ] **Step 1: Write the failing UI contract test**

Add to `tests/frontend.test.mjs`:

```js
test('the console exposes the data mode controls', () => {
  const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  for (const id of ['mode-badge', 'mode-description', 'control-token', 'mode-freeze', 'mode-restore', 'mode-unfreeze', 'mode-message']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const key of ['mode.title', 'mode.hint', 'mode.freeze', 'mode.restore', 'mode.unfreeze', 'mode.persistentHint', 'mode.frozenHint']) {
    assert.notEqual(t('es', key), key);
    assert.notEqual(t('en', key), key);
  }
  assert.match(main, /controlRequest/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/frontend.test.mjs`
Expected: FAIL because the IDs and translations are missing.

- [ ] **Step 3: Add the panel and translations**

In `web/index.html`, inside `.hero-panel` after `#domain-grid`, add the panel with:

- `mode.title` heading.
- `#mode-badge`.
- `#mode-description`.
- `#control-token` input with initial value `local-control-token`.
- `#mode-freeze`, `#mode-restore`, `#mode-unfreeze` buttons.
- `#mode-message` with `role="status"` and `aria-live="polite"`.

Add ES/EN keys in `web/js/i18n.js` for title, hint, badge, descriptions, token, buttons, confirmations, success, and error. Every `data-i18n` key in the HTML must exist for the existing test.

- [ ] **Step 4: Implement the client and controller**

In `web/js/api.js` add:

```js
export async function controlRequest(baseUrl, path, { method = 'POST', token = '', signal } = {}) {
  const result = await performRequest({
    baseUrl, path, method,
    headers: { 'X-Control-Token': token },
    attachAuth: false,
    signal,
  });
  let body = null;
  try { body = result.text ? JSON.parse(result.text) : null; } catch { body = { raw: result.text }; }
  return { ...result, body };
}
```

In `web/js/main.js`:

- Import `controlRequest`.
- `controlToken` from `sessionStorage` with fallback `local-control-token`; `mode` and `modeBusy` state.
- `renderMode()` updates badge, description, visible buttons, and message.
- `refreshOverview()` also fetches `/_control/mode` and calls `renderMode()`.
- `runModeAction(action)` validates the token, confirms restore/unfreeze, calls the endpoint, shows a toast, and refreshes the overview.
- Store the control token in `sessionStorage` on input.
- `updateStaticLanguage()` re-renders the mode.
- `initialize()` loads the token into the input.

Styles in `web/styles.css`: persistent/frozen badge, panel, token row, actions, and responsive rules.

- [ ] **Step 5: Run tests and syntax check**

Run: `node --import tsx --test tests/frontend.test.mjs tests/ui.test.ts`
Expected: PASS. Also run `node --check web/js/main.js`; it must exit cleanly.

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/styles.css web/js/api.js web/js/i18n.js web/js/main.js tests/frontend.test.mjs
git commit -m "feat(web): add data mode console controls"
```

---

### Task 4: Apache-2.0 license and `package.json` review

**Files:**
- Create: `LICENSE`
- Create: `NOTICE`
- Create: `scripts/copy-schema.mjs`
- Create: `tests/license.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `"license": "Apache-2.0"`, canonical `LICENSE`, `NOTICE` attribution, portable build, and exact development versions.
- Consumes: `src/db/schema.sql`, `dist/src/db/schema.sql`.

- [ ] **Step 1: Write the failing license test**

```js
test('the package declares Apache-2.0 and the license is present', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.license, 'Apache-2.0');
  const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
  assert.match(license, /Apache License/);
  assert.match(license, /Version 2\.0/);
  const notice = readFileSync(new URL('../NOTICE', import.meta.url), 'utf8');
  assert.match(notice, /Backend Simulator/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/license.test.mjs`
Expected: FAIL because `LICENSE` and the `license` field do not exist.

- [ ] **Step 3: Add the license and portable build**

- Download the canonical Apache-2.0 text to `LICENSE`:

```bash
curl -fsSL https://www.apache.org/licenses/LICENSE-2.0.txt -o LICENSE
```

- Create `NOTICE` with:
  - `Backend Simulator`
  - `Copyright 2026 Backend Simulator contributors`
  - A line stating the project is distributed under Apache-2.0.
- Create `scripts/copy-schema.mjs` with `mkdirSync(dirname(target), { recursive: true })` and `copyFileSync(source, target)`.
- In `package.json`:
  - Add `"license": "Apache-2.0"`.
  - Change `build` to `"tsc -p tsconfig.json && node scripts/copy-schema.mjs"`.
  - Do not add `author`, `repository`, `homepage`, `main`, `exports`, or `files` without real data.

- [ ] **Step 4: Run tests and build**

Run:
```bash
node --import tsx --test tests/license.test.mjs
npm run build
```
Expected: PASS and `dist/src/db/schema.sql` exists.

- [ ] **Step 5: Commit license and portable build**

```bash
git add LICENSE NOTICE scripts/copy-schema.mjs tests/license.test.mjs package.json
git commit -m "chore: adopt Apache-2.0 and portable build"
```

- [ ] **Step 6: Add failing exact-version assertions**

Add to the license test:

```js
for (const [name, version] of Object.entries(pkg.devDependencies)) {
  assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must be pinned to an exact version`);
}
```

Run: `node --import tsx --test tests/license.test.mjs`
Expected: FAIL because `@types/node`, `tsx`, and `typescript` use `^`.

- [ ] **Step 7: Pin the installed development versions**

Run with the currently installed versions:

```bash
npm install --save-dev --save-exact @types/node@24.19.2 tsx@4.23.15 typescript@5.9.3
```

This must leave `package.json` with:

```json
"devDependencies": {
  "@types/node": "24.19.2",
  "tsx": "4.23.15",
  "typescript": "5.9.3"
}
```

Verify that `package-lock.json` was updated and that `npm ci --dry-run` is in sync.

- [ ] **Step 8: Run tests, lockfile check and build**

Run:
```bash
node --import tsx --test tests/license.test.mjs
npm ci --dry-run
npm run build
```
Expected: PASS, lockfile in sync, build OK.

- [ ] **Step 9: Commit pinned dependencies**

```bash
git add package.json package-lock.json tests/license.test.mjs
git commit -m "chore(deps): pin development dependency versions"
```

---

### Task 5: Bilingual documentation

**Files:**
- Create: `docs/data-modes.md`
- Create: `docs/data-modes.en.md`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/user-guide.md`
- Modify: `docs/user-guide.en.md`
- Modify: `docs/capabilities.md`
- Modify: `docs/capabilities.en.md`
- Modify: `docs/frontend.md`
- Modify: `docs/frontend.en.md`
- Modify: `PLAN.md`
- Modify: `PLAN.en.md`

**Interfaces:**
- Consumes: endpoints and UI from Tasks 2–4.
- Produces: user-facing contract and license references.

- [ ] **Step 1: Write `docs/data-modes.md` and its English pair**

Include:

- Persistent/frozen table.
- What freeze, restore, and leave mean.
- `curl` examples for `mode`, `freeze`, `restore`, `unfreeze`.
- Clarification: while frozen, `/_control/reset` affects only the copy.
- Restart: returns to persistent; the persistent database is untouched.
- Limitations: synchronous snapshot, OS temp files, one snapshot.
- Links to the other language and the user guide.

- [ ] **Step 2: Update README and guides**

- README ES/EN: persistence section with both modes, restore, restart, and the Apache-2.0 license.
- User guide ES/EN: add the new endpoints to the control section and a freeze → modify → restore → leave flow.
- Capabilities ES/EN: new data mode row and updated test count.
- Frontend ES/EN: mode panel, control token, and states.
- PLAN ES/EN: delivery status and tests.

The expected count is **72 tests** (65 current + 2 data + 3 API + 1 UI + 1 license). If `npm test` reports another number, update the documents to the real number before committing.

- [ ] **Step 3: Run documentation tests**

Run: `node --import tsx --test tests/docs.test.mjs`
Expected: PASS; every ES/EN pair and local link exists.

- [ ] **Step 4: Commit**

```bash
git add README.md README.en.md PLAN.md PLAN.en.md docs/data-modes.md docs/data-modes.en.md docs/user-guide.md docs/user-guide.en.md docs/capabilities.md docs/capabilities.en.md docs/frontend.md docs/frontend.en.md
git commit -m "docs: document data modes and Apache-2.0 license"
```

---

### Task 6: Final verification

**Files:** none; verification only.

- [ ] **Step 1: Run static and automated checks**

```bash
npm run typecheck
npm test
npm run build
node --check web/js/main.js
```

Expected: typecheck OK, **72/72 tests**, build OK.

- [ ] **Step 2: Verify the browser panel**

Start the server with a temporary database and open `/ui/` in headless Chrome. Verify:

- The badge shows `Persistent`.
- The panel lists the actions and the control token is preloaded.
- With the local token, `Freeze database` changes the badge to `Frozen`.
- Create a product and `Restore data` removes it.
- `Leave frozen mode` returns to `Persistent`.

- [ ] **Step 3: Verify the persistent database is untouched**

With the server frozen, create a product, unfreeze, and query it: it must return `404`. Repeat with `restore` and confirm the documented behavior.

- [ ] **Step 4: Check Git state**

```bash
git status --short
git log --oneline -8
```

Expected: clean tree and conventional commits per block. Do not create an empty commit.
