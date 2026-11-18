# Frozen data mode and restore — Design

**Date:** 2026-11-18
**Status:** Pending approval
**Spanish version:** [2026-11-18-data-mode-design.md](2026-11-18-data-mode-design.md)

## 1. Intent and why

The simulator must support two ways of working with data:

- **Persistent:** changes are applied to the main database and survive restarts.
- **Frozen:** an image of the current state is taken and work happens on a disposable copy. The main database is never modified.

In both modes the user must be able to return to the origin state: in persistent mode, by restoring the seed data; in frozen mode, by discarding changes and returning to the frozen image. The user must also be able to leave frozen mode and recover the untouched persistent database.

The goal is to experiment with the APIs without polluting the working database, with an explicit, protected restore from both the API and the web console.

## 2. Goals

- Switch between persistent and frozen mode at runtime, without restarting the process.
- Capture a consistent snapshot of the persistent database when freezing.
- Isolate every read and write in frozen mode to a disposable copy.
- Restore the frozen image without touching the persistent database.
- Restore seed data in persistent mode.
- Expose state and actions under `/_control` with the control token.
- Add a clear bilingual console panel with confirmations.
- Keep the existing reset and demo-data endpoints.
- Add the Apache-2.0 license, `NOTICE`, and `package.json` metadata.
- Document and test the behavior in Spanish and English.

## 3. Non-goals

- A database per user, session, or request.
- Multiple snapshots or point-in-time history.
- Persisting frozen mode across restarts.
- Read-only freezing: the user must be able to write to the copy.
- Remote backups, encryption at rest, or image retention.
- Changing the authentication model of business APIs.
- Publishing the package to npm.

## 4. Constraints

- Node.js 24, strict TypeScript, `node:sqlite`, no ORM.
- One active instance per process.
- Synchronous SQLite with WAL.
- Existing handlers keep database references; a mode switch must not leave closed connections in use.
- No real secrets or generated files in Git.
- New documentation must have ES/EN versions.
- The selected license is Apache-2.0.

## 5. Approaches considered

### A. Disposable temp-file copy + database facade (chosen)

`Db` becomes a stable facade over the active SQLite connection. It keeps the persistent connection and, while frozen, a separate working connection.

- `freeze`: creates a consistent `VACUUM INTO` snapshot in a private temp directory, copies it to a working file, opens the copy, and switches the active connection.
- `restore` while frozen: opens a fresh copy from the snapshot, switches the active connection, and closes the previous one.
- `unfreeze`: closes the working copy, switches back to the persistent connection, and removes the temp directory.
- `restore` while persistent: runs the existing deterministic seed reset.

Handlers hold the same `Db` facade, not the raw connection. After an `await`, every operation uses the connection that is active at that moment. This prevents an in-flight request from writing to the persistent database after freezing, or to a closed connection after unfreezing.

**Pros:** real isolation, WAL-safe, does not load the whole database into RAM, cheap restore, and the persistent file is never touched while frozen.

**Cost:** uses temporary disk space and `VACUUM INTO` blocks the event loop; acceptable for a local simulator.

### B. In-memory copy

Serialize the database and load it into an in-memory connection.

**Rejected:** `serialize()` of a WAL database requires temporarily changing the journal mode, and the full database occupies RAM. It offers less robustness than a temp file.

### C. Read-only freeze

Block writes and restore with the seeder.

**Rejected:** it does not satisfy the requirement of free rein over the image.

## 6. Detailed design

### 6.1 Lifecycle

The process always starts in persistent mode:

1. Opens `DB_PATH`, applies the schema, and seeds only when empty.
2. The persistent connection stays open for the process lifetime.
3. The active connection points to the persistent one.

`POST /_control/freeze`:

1. Verifies persistent mode; if already frozen, returns `409`.
2. Creates a user-private temp directory (`mkdtemp`).
3. Runs `VACUUM INTO` on the persistent connection to obtain a consistent snapshot.
4. Copies the snapshot to `working.sqlite` and opens it as the working connection.
5. Stores `frozen_at` and the image record count.
6. Switches the active connection to the working copy.

`POST /_control/restore`:

- Persistent: deletes and regenerates every domain with the deterministic seeders.
- Frozen: opens a new copy from the snapshot, switches the active connection, and discards the previous copy. The persistent database is untouched.

`POST /_control/unfreeze`:

1. Verifies frozen mode; otherwise returns `409`.
2. Closes the working connection.
3. Switches the active connection to the persistent one.
4. Removes the temp directory and clears the frozen state.

`POST /_control/reset` and `POST /_control/reset/:domain` remain:

- In persistent mode, they reset the persistent database.
- In frozen mode, they reset the working copy.
- They never touch the persistent database while frozen.

### 6.2 Restarts and failures

- A restart discards frozen mode and returns to the persistent database. This is intentional: the persistent database is the source of truth.
- A failure during `freeze` leaves the persistent connection active and removes partial temp files.
- A failure during frozen `restore` keeps the previous working copy active.
- Shutdown closes every connection and removes the temp directory.
- An abrupt shutdown may leave a temp directory behind; the persistent database remains intact. This is documented as a local limitation.

### 6.3 State and API

`GET /_control/mode` is public, like the statistics:

```json
{
  "data": {
    "mode": "persistent",
    "frozen_at": null,
    "baseline_records": null,
    "active_records": 1234,
    "persistent_records": 1234
  }
}
```

While frozen, `mode` is `"frozen"`, `frozen_at` is ISO-8601, `baseline_records` is the image size, and `active_records` may differ because of working-copy changes.

New endpoints, all requiring `X-Control-Token` except the status query:

| Method | Path | Action |
|---|---|---|
| GET | `/_control/mode` | Public mode status |
| POST | `/_control/freeze` | Captures the image and enables frozen mode |
| POST | `/_control/unfreeze` | Discards the copy and returns to persistent mode |
| POST | `/_control/restore` | Restores the image or seed data depending on mode |

`GET /_control/stats` includes the same mode block. Reset endpoints include `mode` in the response.

Invalid transitions return `409 CONFLICT`; a missing control token returns `401`.

### 6.4 Web console

A "Data mode" panel is added to the overview:

- Status badge: **Persistent** or **Frozen**.
- Explanation of the active mode.
- Control-token field, separate from the Request Lab Bearer token.
- Actions:
  - **Freeze database**: persistent only.
  - **Restore data**: persistent returns to seed data; frozen returns to the image.
  - **Leave frozen mode**: frozen only.
- Confirmation before restoring or discarding.
- Refreshes the overview and statistics after every action.
- Token and transition errors appear as a toast and accessible message.

The control token is stored in `sessionStorage`, not `localStorage`. The visible default is the local simulation token.

### 6.5 OpenAPI and documentation

- New routes are registered with bilingual metadata and added to the OpenAPI translation catalogue.
- Update `README.md`, `README.en.md`, `docs/user-guide.md`, `docs/user-guide.en.md`, `docs/capabilities.md`, `docs/capabilities.en.md`, `docs/frontend.md`, and `docs/frontend.en.md`.
- Add `docs/data-modes.md` and `docs/data-modes.en.md` with the contract, `curl` examples, and limitations.
- Update `PLAN.md` and `PLAN.en.md`.

## 7. `package.json` review

### Current state

- `name`, `version`, `private`, `type`, `description`: correct for a private local application.
- `scripts`: `dev`, `start`, `start:dist`, `build`, `typecheck`, `test`, `certs`.
- `engines.node >= 24`: correct for `node:sqlite` and the test runner.
- Only `devDependencies` (`@types/node`, `tsx`, `typescript`): runtime uses Node built-ins, so there are no production dependencies.
- `package-lock.json` uses lockfile v3; `npm ci --dry-run` is in sync and `npm audit --omit=dev` reports 0 vulnerabilities.
- `start` uses `tsx`, a development dependency. To run the compiled output, use `npm run build && npm run start:dist`.

### Planned adjustments

1. Add `"license": "Apache-2.0"`.
2. Add `LICENSE` with the full Apache-2.0 text and `NOTICE` with the project name and copyright.
3. Replace the POSIX `mkdir -p`/`cp` in the `build` script with a portable Node script (`scripts/copy-schema.mjs`) so the build does not depend on POSIX utilities.
4. Keep `private: true` and do not add `main`, `exports`, or `files`: this is not a publishable library.
5. Do not add `author`, `repository`, or `homepage` without real data; avoid inventing metadata.
6. Document in the README the difference between `npm start` (development with `tsx`) and `npm run start:dist` (compiled).
7. Remove the `^` ranges from `devDependencies` and pin the exact installed versions (`@types/node`, `tsx`, `typescript`), regenerating `package-lock.json`. The lockfile already guarantees reproducibility, but explicit pinning prevents a fresh install from resolving different versions if the lockfile is removed.

## 8. License

**Apache License 2.0** is adopted:

- `LICENSE`: canonical English text.
- `NOTICE`: project attribution and year.
- `package.json`: `"license": "Apache-2.0"`.
- README ES/EN: license section linking to `LICENSE` and `NOTICE`.

Apache-2.0 provides an explicit patent grant and trademark protection while remaining permissive for reuse and commercial use.

## 9. Tests

New integration tests:

1. Initial persistent state.
2. Freeze, write to the copy, and verify the persistent database is unchanged after unfreezing.
3. Restore the frozen image and verify changes disappear.
4. Restore in persistent mode and verify seed data returns.
5. Domain reset while frozen without affecting the persistent database.
6. Invalid transitions (`freeze` while frozen, `unfreeze` while persistent) return `409`.
7. Protected actions without a token return `401`.
8. `GET /_control/mode` and `stats` reflect the mode.
9. OpenAPI contains the routes and English summaries.
10. `package.json` declares Apache-2.0, `LICENSE` and `NOTICE` exist, and documentation links the license.

The existing 65 tests are preserved and the counts and documentation are updated.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| `VACUUM INTO` blocks the event loop | The simulator database is small; it is documented. It can move to async `backup()` if it grows. |
| Temporary disk usage | Removed on unfreeze or shutdown; the directory is private. |
| Abrupt shutdown leaves temp files | The persistent database is untouched; manual cleanup is documented. |
| Handlers hold database references | The `Db` facade always delegates to the active connection, not the raw one. |
| Frozen mode is lost on restart | Intentional and visible in the UI/documentation. |
| License change in an already distributed project | Add `LICENSE`, `NOTICE`, `package.json`, and README; do not rewrite history. |

## 11. Decisions left to the implementer

- Final names of state fields and responses, keeping the contract in this document.
- Exact ES/EN wording.
- Location of the portable schema-copy script.
- Whether the mode panel lives inside the overview or in its own section; inside the overview is preferred to avoid lengthening navigation.

## 12. Acceptance criteria

- Freeze, modify, restore, and unfreeze work from both the API and the UI.
- The persistent database does not change while working in frozen mode.
- Restoring in persistent mode returns seed data.
- Restarting the process returns to the persistent database.
- The control token protects every destructive action.
- Apache-2.0 is declared and documented.
- Typecheck, build, tests, and bilingual documentation pass.
