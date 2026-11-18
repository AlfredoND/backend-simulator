# Modo de datos congelado — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Añadir un modo de datos congelado con copia descartable, restauración de la imagen o de los datos semilla, controles web y licencia Apache-2.0.

**Architecture:** `Db` se convierte en una fachada estable sobre una conexión activa. El modo congelado crea un snapshot `VACUUM INTO`, abre una copia temporal y cambia la conexión activa; los handlers conservan la fachada, no la conexión cruda. Al descongelar se cierra la copia y se vuelve a la base persistente intacta.

**Tech Stack:** Node.js 24, TypeScript estricto, `node:sqlite`, `node:http`, frontend vanilla ES modules, SQLite WAL.

**Spec:** [Diseño del modo de datos](../specs/2026-11-18-data-mode-design.md)

> **Estado de ejecución:** completado y verificado el 2026-11-18.

## Global Constraints

- Node.js >= 24, TypeScript estricto, `node:sqlite`, sin ORM.
- Sin dependencias de runtime nuevas.
- La base persistente no debe modificarse mientras el modo sea congelado.
- Las acciones destructivas requieren `X-Control-Token`.
- El modo congelado no sobrevive a un reinicio; la base persistente sí.
- Licencia Apache-2.0 con `LICENSE`, `NOTICE` y `"license": "Apache-2.0"`.
- Toda documentación nueva debe existir en español e inglés.
- No incluir secretos, bases SQLite, certificados ni archivos generados en Git.
- Commits Conventional Commits, separados por bloque lógico.

## Review Focus

- **Petición en vuelo durante `freeze`:** una referencia capturada a `Db` debe seguir operando sobre la conexión activa, no sobre la persistente. Se prueba insertando a través de una referencia capturada antes de congelar y verificando que la persistente no cambia.
- **Petición en vuelo durante `restore`/`unfreeze`:** la fachada no debe apuntar a una conexión cerrada. Se prueba restaurando y escribiendo de nuevo con la misma referencia.
- **WAL con escrituras confirmadas antes del snapshot:** la imagen debe incluir esos datos. Se prueba insertando antes de `freeze` y verificando que el dato existe en la copia.
- **Cierre abrupto en congelado:** la persistente debe quedar intacta y el siguiente arranque debe verla como fuente de verdad. Se prueba cerrando sin `unfreeze` y reabriendo.
- **Reset dentro de congelado:** debe afectar solo la copia; al descongelar, la persistente conserva sus datos. Se prueba con `/_control/reset/shop` y `unfreeze`.
- **Transiciones inválidas o token ausente:** `freeze` dos veces, `unfreeze` en persistente y acciones sin token deben devolver `409`/`401`. Se prueba por HTTP.

---

### Task 0: Commit del diseño y el plan

**Files:**
- `docs/superpowers/specs/2026-11-18-data-mode-design.md`
- `docs/superpowers/specs/2026-11-18-data-mode-design.en.md`
- `docs/superpowers/plans/2026-11-18-data-mode-plan.md`
- `docs/superpowers/plans/2026-11-18-data-mode-plan.en.md`

- [x] **Step 1: Commit the approved documentation**

```bash
git add docs/superpowers/specs/2026-11-18-data-mode-design.md docs/superpowers/specs/2026-11-18-data-mode-design.en.md docs/superpowers/plans/2026-11-18-data-mode-plan.md docs/superpowers/plans/2026-11-18-data-mode-plan.en.md
git commit -m "docs: add data mode design and implementation plan"
```

---

### Task 1: Ciclo de vida de datos en `Db`

**Files:**
- Modify: `src/db/index.ts`
- Test: `tests/data-mode.test.ts`

**Interfaces:**
- Consumes: `Db` actual, `DOMAIN_TABLES`, `node:sqlite`.
- Produces:
  - `export type DataMode = 'persistent' | 'frozen'`
  - `export interface DataModeState { mode: DataMode; frozen_at: string | null; baseline_records: number | null; active_records: number; persistent_records: number }`
  - `Db.mode: DataMode` (getter)
  - `Db.state(): DataModeState`
  - `Db.freeze(): DataModeState`
  - `Db.unfreeze(): DataModeState`
  - `Db.restoreFrozen(): DataModeState`
  - `Db.close()` sigue cerrando todo.

- [x] **Step 1: Write the failing core tests**

Crea `tests/data-mode.test.ts` con un helper que use `mkdtempSync`, `Db`, `loadConfig`, `ensureSeeded` y `rmSync`. Los tests deben ser:

```ts
test('congela, restaura y descongela sin tocar la base persistente', () => {
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

test('un cierre en congelado deja intacta la base persistente', () => {
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

La referencia `captured` se toma antes de `unfreeze`: el insert `captured-before-freeze` debe terminar en la copia congelada, no en la persistente; `captured-after-unfreeze` debe funcionar después de descongelar sin usar una conexión cerrada.

- [x] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/data-mode.test.ts`
Expected: FAIL porque `freeze`, `unfreeze`, `restoreFrozen`, `state` o `mode` no existen.

- [x] **Step 3: Implement the facade and lifecycle in `src/db/index.ts`**

Convierte `raw` en una fachada sobre `this.active`:

- `private readonly persistent: DatabaseSync`, `private active: DatabaseSync`.
- `private open(path): DatabaseSync` aplica los PRAGMAs actuales.
- `get raw()` devuelve `this.active`; `get mode()` devuelve `this.dataMode`.
- Todos los métodos (`initSchema`, `exec`, `get`, `all`, `run`, `insert`, `transaction`) usan `this.active`.
- `freeze()`:
  - Rechaza si ya está congelada.
  - `mkdtempSync(join(tmpdir(), 'backend-simulator-freeze-'))`.
  - `this.persistent.prepare('VACUUM INTO ?').run(snapshotPath)`.
  - Copia el snapshot a `working.sqlite`, ábrelo con `open`, cambia `active`.
  - Guarda `frozenAt` y `baselineRecords = totalRecords(persistent)`.
  - Limpia el directorio si falla.
- `restoreFrozen()`:
  - Rechaza si no está congelada.
  - Copia el snapshot a `working-${randomUUID()}.sqlite`, abre la copia, cambia `active`, cierra la anterior y elimina sus archivos.
  - Si falla la apertura, conserva la copia anterior.
- `unfreeze()`:
  - Rechaza si no está congelada.
  - Cierra `active`, vuelve a `persistent`, limpia el directorio y el estado congelado.
- `close()` cierra `active` si es distinta de `persistent`, cierra `persistent` y elimina el directorio temporal.
- `totalRecords(connection)` suma `COUNT(*)` de todas las tablas de `DOMAIN_TABLES`.
- `removeDatabaseFiles(path)` elimina `path`, `path-wal` y `path-shm`.
- JSDoc de la fachada y de las decisiones de aislamiento.

- [x] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/data-mode.test.ts`
Expected: PASS (2 tests).

- [x] **Step 5: Commit**

```bash
git add src/db/index.ts tests/data-mode.test.ts
git commit -m "feat(db): add frozen data mode lifecycle"
```

---

### Task 2: Endpoints de control y contrato OpenAPI

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
  - `GET /_control/stats` incluye `data_mode: DataModeState`.
  - Los resets incluyen `mode` en la respuesta.

- [x] **Step 1: Write the failing API tests**

Añade a `tests/data-mode.test.ts`:

```ts
test('control: expone el modo, protege acciones y valida transiciones', async () => {
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

test('control: los cambios congelados no llegan a la base persistente', async () => {
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

test('control: reset y restore aíslan la copia congelada', async () => {
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

Añade un helper `createProduct(server, prefix): Promise<number>` que haga `POST /api/v1/shop/products` con `sku`, `name`, `slug` únicos y `category_id: 1`, y devuelva `body.data.id`.

- [x] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/data-mode.test.ts`
Expected: FAIL con 404 en `/_control/mode` y `/_control/freeze`.

- [x] **Step 3: Implement the control routes**

En `src/control/index.ts`:

- `stats()` añade `data_mode: db.state()`.
- `GET /_control/mode` público, tag `Control`.
- `POST /_control/freeze`: exige token; si `db.mode === 'frozen'` lanza `conflict('La base ya está congelada')`; si no, `db.freeze()`.
- `POST /_control/unfreeze`: exige token; si no está congelada lanza `conflict('La base no está congelada')`; si sí, `db.unfreeze()`.
- `POST /_control/restore`: exige token; en congelado usa `db.restoreFrozen()` y añade `restored: 'snapshot'`; en persistente usa `resetAll(db, config)` y añade `restored: 'seed'`.
- Los resets existentes añaden `mode: db.mode` a `data`.
- `GET /_control/config` añade `data_mode: db.mode`.
- Metadatos OpenAPI con `summary`, `summaryEn`, `tag: 'Control'` y `security: [{ controlToken: [] }]` en los POST.
  - `Estado del modo de datos` / `Data mode status`
  - `Congela la base actual en una copia descartable` / `Freeze the current database into a disposable copy`
  - `Descarta la copia congelada y vuelve a la base persistente` / `Discard the frozen copy and return to the persistent database`
  - `Restaura la imagen congelada o los datos semilla` / `Restore the frozen image or seed data`
- Actualiza `TAG_DESCRIPTIONS.Control` a `Estadísticas, reseteo, modo de datos y datos adicionales.` y `TAG_DESCRIPTIONS_EN.Control` a `Statistics, reset, data mode and extra data.`.

- [x] **Step 4: Add OpenAPI assertions**

En `tests/openapi.test.ts`, dentro del primer test o en uno nuevo, verifica:

```ts
assert.ok(es.body.paths['/_control/mode'].get);
assert.ok(es.body.paths['/_control/freeze'].post);
assert.equal(enOps['GET /_control/mode'].summary, 'Data mode status');
assert.equal(enOps['POST /_control/freeze'].summary, 'Freeze the current database into a disposable copy');
assert.equal(en.body.tags.find((tag: any) => tag.name === 'Control').description, 'Statistics, reset, data mode and extra data.');
```

- [x] **Step 5: Run tests to verify they pass**

Run: `node --import tsx --test tests/data-mode.test.ts tests/openapi.test.ts`
Expected: PASS (5 tests de datos + pruebas OpenAPI existentes).

- [x] **Step 6: Commit**

```bash
git add src/control/index.ts src/http/openapi.ts src/http/openapi-i18n.ts tests/data-mode.test.ts tests/openapi.test.ts
git commit -m "feat(control): expose data mode endpoints"
```

---

### Task 3: Panel de modo de datos en la consola

**Files:**
- Modify: `web/index.html`
- Modify: `web/styles.css`
- Modify: `web/js/api.js`
- Modify: `web/js/i18n.js`
- Modify: `web/js/main.js`
- Test: `tests/frontend.test.mjs`

**Interfaces:**
- Consumes: `GET /_control/mode`, `POST /_control/freeze|unfreeze|restore` with `X-Control-Token`.
- Produces: `controlRequest(baseUrl, path, { method, token, signal })` en `web/js/api.js`.
- DOM IDs: `mode-badge`, `mode-description`, `control-token`, `mode-freeze`, `mode-restore`, `mode-unfreeze`, `mode-message`.

- [x] **Step 1: Write the failing UI contract test**

Añade a `tests/frontend.test.mjs`:

```js
test('la consola expone los controles del modo de datos', () => {
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

- [x] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/frontend.test.mjs`
Expected: FAIL porque faltan los IDs y las traducciones.

- [x] **Step 3: Add the panel and translations**

En `web/index.html`, dentro de `.hero-panel` y después de `#domain-grid`, añade el panel con:

- Título `mode.title`.
- Badge `#mode-badge`.
- Descripción `#mode-description`.
- Input `#control-token` con valor inicial `local-control-token`.
- Botones `#mode-freeze`, `#mode-restore`, `#mode-unfreeze`.
- Mensaje `#mode-message` con `role="status"` y `aria-live="polite"`.

Añade claves ES/EN en `web/js/i18n.js` para título, hint, badge, descripciones, token, botones, confirmaciones, éxito y error. Las claves `data-i18n` del HTML deben existir para que pase el test existente.

- [x] **Step 4: Implement the client and controller**

En `web/js/api.js` añade:

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

En `web/js/main.js`:

- Importa `controlRequest`.
- Estado `controlToken` desde `sessionStorage` con fallback `local-control-token`; estado `mode` y `modeBusy`.
- `renderMode()` actualiza badge, descripción, botones visibles y mensaje.
- `refreshOverview()` consulta también `/_control/mode` y llama a `renderMode()`.
- `runModeAction(action)` valida token, pide confirmación para restore/unfreeze, llama al endpoint, muestra toast y refresca el resumen.
- Guarda el token de control en `sessionStorage` al escribir.
- `updateStaticLanguage()` vuelve a renderizar el modo.
- En `initialize()`, carga el token en el input.

Estilos en `web/styles.css`: badge persistente/congelado, panel, fila de token, acciones y responsive.

- [x] **Step 5: Run tests and syntax check**

Run: `node --import tsx --test tests/frontend.test.mjs tests/ui.test.ts`
Expected: PASS. Ejecuta también `node --check web/js/main.js`; debe salir sin errores.

- [x] **Step 6: Commit**

```bash
git add web/index.html web/styles.css web/js/api.js web/js/i18n.js web/js/main.js tests/frontend.test.mjs
git commit -m "feat(web): add data mode console controls"
```

---

### Task 4: Licencia Apache-2.0 y revisión de `package.json`

**Files:**
- Create: `LICENSE`
- Create: `NOTICE`
- Create: `scripts/copy-schema.mjs`
- Create: `tests/license.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `"license": "Apache-2.0"`, `LICENSE` canónico, `NOTICE` con atribución, build portable y versiones de desarrollo exactas.
- Consumes: `src/db/schema.sql`, `dist/src/db/schema.sql`.

- [x] **Step 1: Write the failing license test**

```js
test('el paquete declara Apache-2.0 y la licencia está presente', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.license, 'Apache-2.0');
  const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
  assert.match(license, /Apache License/);
  assert.match(license, /Version 2\.0/);
  const notice = readFileSync(new URL('../NOTICE', import.meta.url), 'utf8');
  assert.match(notice, /Backend Simulator/);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/license.test.mjs`
Expected: FAIL porque no existe `LICENSE` ni el campo `license`.

- [x] **Step 3: Add the license and portable build**

- Descarga el texto oficial de Apache-2.0 a `LICENSE`:

```bash
curl -fsSL https://www.apache.org/licenses/LICENSE-2.0.txt -o LICENSE
```

- Crea `NOTICE` con:
  - `Backend Simulator`
  - `Copyright 2026 Backend Simulator contributors`
  - Una línea indicando que el proyecto se distribuye bajo Apache-2.0.
- Crea `scripts/copy-schema.mjs` con `mkdirSync(dirname(target), { recursive: true })` y `copyFileSync(source, target)`.
- En `package.json`:
  - Añade `"license": "Apache-2.0"`.
  - Cambia `build` a `"tsc -p tsconfig.json && node scripts/copy-schema.mjs"`.
  - No añadas `author`, `repository`, `homepage`, `main`, `exports` ni `files` sin datos reales.

- [x] **Step 4: Run tests and build**

Run:
```bash
node --import tsx --test tests/license.test.mjs
npm run build
```
Expected: PASS y `dist/src/db/schema.sql` existe.

- [x] **Step 5: Commit license and portable build**

```bash
git add LICENSE NOTICE scripts/copy-schema.mjs tests/license.test.mjs package.json
git commit -m "chore: adopt Apache-2.0 and portable build"
```

- [x] **Step 6: Add failing exact-version assertions**

Añade al test de licencia:

```js
for (const [name, version] of Object.entries(pkg.devDependencies)) {
  assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must be pinned to an exact version`);
}
```

Run: `node --import tsx --test tests/license.test.mjs`
Expected: FAIL porque `@types/node`, `tsx` y `typescript` usan `^`.

- [x] **Step 7: Pin the installed development versions**

Ejecuta con las versiones instaladas actualmente:

```bash
npm install --save-dev --save-exact @types/node@24.19.2 tsx@4.23.15 typescript@5.9.3
```

Esto debe dejar en `package.json`:

```json
"devDependencies": {
  "@types/node": "24.19.2",
  "tsx": "4.23.15",
  "typescript": "5.9.3"
}
```

Verifica que `package-lock.json` quedó actualizado y que `npm ci --dry-run` está sincronizado.

- [x] **Step 8: Run tests, lockfile check and build**

Run:
```bash
node --import tsx --test tests/license.test.mjs
npm ci --dry-run
npm run build
```
Expected: PASS, lockfile sincronizado y build correcto.

- [x] **Step 9: Commit pinned dependencies**

```bash
git add package.json package-lock.json tests/license.test.mjs
git commit -m "chore(deps): pin development dependency versions"
```

---

### Task 5: Políticas de calidad de código

**Files:**
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Create: `.editorconfig`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.github/workflows/ci.yml`
- Modify: archivos de `src/`, `tests/`, `web/js/` y `scripts/` que lint o formato requieran.

**Interfaces:**
- Produces:
  - `npm run lint`
  - `npm run format`
  - `npm run format:check`
  - `npm run check` → typecheck + lint + format:check + test
- Consumes: configuración TypeScript existente y código actual.

- [x] **Step 1: Install exact quality tooling**

```bash
npm install --save-dev --save-exact \
  eslint@10.15.0 @eslint/js@10.0.1 typescript-eslint@8.73.0 \
  prettier@3.10.1 eslint-config-prettier@10.1.8 globals@17.14.0
```

Verifica que las seis dependencias queden sin `^` en `package.json`.

- [x] **Step 2: Create ESLint, Prettier and EditorConfig policies**

`eslint.config.js`:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'data/**', 'certs/**', '.superpowers/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['web/js/**/*.js'],
    languageOptions: { globals: globals.browser },
    rules: { eqeqeq: ['error', 'always'], 'no-var': 'error', 'prefer-const': 'error' },
  },
  {
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['**/*.mjs', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
```

`.prettierrc.json`:

```json
{
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "printWidth": 120
}
```

`.prettierignore`:

```text
node_modules/
dist/
data/
certs/
.superpowers/
package-lock.json
LICENSE
NOTICE
docs/
README.md
README.en.md
PLAN.md
PLAN.en.md
web/index.html
```

`.editorconfig`:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
```

- [x] **Step 3: Add quality scripts**

En `package.json` añade:

```json
"lint": "eslint .",
"format": "prettier --write .",
"format:check": "prettier --check .",
"check": "npm run typecheck && npm run lint && npm run format:check && npm test"
```

- [x] **Step 4: Run lint and fix real findings**

Run: `npm run lint`
Expected: PASS o lista de hallazgos concretos. Corrige el código; no desactives reglas salvo `no-explicit-any` en tests.

- [x] **Step 5: Add CI quality gates**

En `.github/workflows/ci.yml`, después de `Typecheck`, añade:

```yaml
      - name: Lint
        run: npm run lint
      - name: Format check
        run: npm run format:check
```

- [x] **Step 6: Format the code**

Run:
```bash
npm run format
npm run format:check
```
Expected: PASS. Revisa el diff para asegurar que no se reformatearon documentos, HTML, lockfile ni material legal.

- [x] **Step 7: Run the complete quality gate**

Run:
```bash
npm run check
npm run build
```
Expected: typecheck OK, lint OK, format OK, **73/73 tests**, build OK.

- [x] **Step 8: Commit tooling and formatting**

```bash
git add eslint.config.js .prettierrc.json .prettierignore .editorconfig package.json package-lock.json .github/workflows/ci.yml
git commit -m "chore(quality): add lint and format policies"

git add src tests web/js scripts
git commit -m "style: format source and tests with Prettier"
```

---

### Task 6: Documentación bilingüe

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
- Consumes: endpoints and UI from Tasks 2–5.
- Produces: user-facing contract, quality commands and license references.

- [x] **Step 1: Write `docs/data-modes.md` and its English pair**

Incluye:

- Tabla persistente/congelado.
- Qué significa congelar, restaurar y salir.
- Ejemplos `curl` para `mode`, `freeze`, `restore`, `unfreeze`.
- Aclaración: en congelado, `/_control/reset` afecta solo a la copia.
- Reinicio: vuelve a persistente; la base persistente no se toca.
- Limitaciones: snapshot síncrono, temporales en el sistema, un solo snapshot.
- Enlaces al otro idioma y a la guía de usuario.

- [x] **Step 2: Update README and guides**

- README ES/EN: sección de persistencia con los dos modos, restauración, reinicio y licencia Apache-2.0.
- User guide ES/EN: añade los endpoints nuevos a la sección de control y un ejemplo de flujo congelar → modificar → restaurar → salir.
- Capabilities ES/EN: nueva fila de modo de datos y actualiza el conteo de pruebas.
- Frontend ES/EN: panel de modo, token de control y estados.
- README ES/EN: comandos `npm run lint`, `npm run format:check` y `npm run check`.
- PLAN ES/EN: estado de entrega, calidad y pruebas.

El conteo esperado es **73 pruebas** (65 actuales + 2 de datos + 3 de API + 1 de UI + 1 de licencia + 1 de regresión de freeze). Si `npm test` reporta otro número, actualiza los documentos al número real antes de commitear.

- [x] **Step 3: Run documentation tests**

Run: `node --import tsx --test tests/docs.test.mjs`
Expected: PASS; todos los pares ES/EN y enlaces locales existen.

- [x] **Step 4: Commit**

```bash
git add README.md README.en.md PLAN.md PLAN.en.md docs/data-modes.md docs/data-modes.en.md docs/user-guide.md docs/user-guide.en.md docs/capabilities.md docs/capabilities.en.md docs/frontend.md docs/frontend.en.md
git commit -m "docs: document data modes and Apache-2.0 license"
```

---

### Task 7: Verificación final

**Files:** ninguno; solo verificación.

- [x] **Step 1: Run static and automated checks**

```bash
npm run check
npm run build
node --check web/js/main.js
```

Expected: typecheck, lint y formato OK; **73/73 tests**; build OK.

- [x] **Step 2: Verify the browser panel**

Arranca el servidor con una base temporal y abre `/ui/` en Chrome headless. Comprueba:

- El badge muestra `Persistente`.
- El panel lista las acciones y el token de control está precargado.
- Con el token local, `Congelar base` cambia el badge a `Congelado`.
- Crear un producto y `Restaurar datos` lo elimina.
- `Salir del congelado` vuelve a `Persistente`.

- [x] **Step 3: Verify the persistent database is untouched**

Con el servidor en congelado, crea un producto, descongela y consulta el producto: debe devolver `404`. Repite el flujo con `restore` y confirma el comportamiento documentado.

- [x] **Step 4: Check Git state**

```bash
git status --short
git log --oneline -8
```

Expected: árbol limpio y commits convencionales por bloque. No crear un commit vacío.
