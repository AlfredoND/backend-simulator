# Data modes: persistent and frozen

[Español](data-modes.md) · [User guide](user-guide.en.md)

## Overview

The simulator can work with the database in two ways:

| Mode | What happens | Restore | Restart |
|---|---|---|---|
| **Persistent** | APIs read and write to `DB_PATH`. | Returns to seed data. | Changes are kept. |
| **Frozen** | Work happens on a disposable copy of an image. | Discards changes and returns to the image. | The persistent database stays intact. |

Frozen mode is useful for demos, destructive tests, or experiments: modify anything you want and the main database is untouched.

## Freeze the database

```bash
curl -s -X POST http://localhost:4000/_control/freeze \
  -H 'X-Control-Token: local-control-token'
```

The response includes the mode, image timestamp, image records, and active copy records:

```json
{
  "data": {
    "mode": "frozen",
    "frozen_at": "2026-11-18T12:00:00.000Z",
    "baseline_records": 4210,
    "active_records": 4210,
    "persistent_records": 4210
  }
}
```

From that point on, `POST /_control/reset`, `POST /_control/seed`, and every business API write to the copy.

## Check the mode

```bash
curl -s http://localhost:4000/_control/mode
```

`GET /_control/mode` is public and requires no token. `GET /_control/stats` includes the same block in `data_mode`.

## Restore

While frozen, restores the original image and discards copy changes:

```bash
curl -s -X POST http://localhost:4000/_control/restore \
  -H 'X-Control-Token: local-control-token'
```

While persistent, regenerates all seed data:

```bash
curl -s -X POST http://localhost:4000/_control/restore \
  -H 'X-Control-Token: local-control-token'
```

The response reports the restore source with `"restored": "snapshot"` or `"restored": "seed"`.

## Leave frozen mode

```bash
curl -s -X POST http://localhost:4000/_control/unfreeze \
  -H 'X-Control-Token: local-control-token'
```

Discards the copy and returns to the persistent database. If you wanted to keep the copy's changes, they will not be there after leaving.

## Reset and demo data

`POST /_control/reset`, `POST /_control/reset/:domain`, and `POST /_control/seed` operate on the active connection:

- In persistent mode, on the main database.
- In frozen mode, on the disposable copy.

They never modify the persistent database while frozen.

## Restarts and failures

- On restart, the server always starts in persistent mode.
- The persistent database is the source of truth.
- An abrupt shutdown may leave a temporary directory on the system; the persistent database remains intact.
- The snapshot is created with `VACUUM INTO` and blocks the event loop while it runs. This is acceptable for the size of this local simulator.
- Only one frozen image is active per process.

## Web console

The **Data mode** panel at `/ui/` allows freezing, restoring, and leaving frozen mode without `curl`. The control token is stored in `sessionStorage` and sent as `X-Control-Token` only for those actions.

## License

The project is distributed under the Apache License 2.0. See [LICENSE](../LICENSE) and [NOTICE](../NOTICE).
