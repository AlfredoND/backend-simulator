# Micro frontend

Languages: [Español](frontend.md) | **English**

The project includes a static micro frontend for operating the simulator from a browser. It is written with **vanilla JavaScript and ES modules**: no UI framework, no UI dependencies and no build step.

## Features

- **Overview**: backend health, uptime, record count, domains and per-domain counts.
- **Request Lab**: HTTP request builder with method, path, headers, body, Bearer token, abort and response status, time, size, headers and body.
- **API catalog**: sample endpoints by domain, searchable and loadable into the Request Lab.
- **Documentation**: OpenAPI (ES/EN) and Swagger UI links, local credentials, startup commands and environment limits.
- **Authentication**: the `local-admin-token` demo token is preloaded and attached; clear it to check 401 responses.
- **Preferences**: Spanish/English language and light/dark theme persisted in the browser.
- **Configurable API base**: use the UI served by the backend or serve it separately.

## Running

The UI is served by the same backend:

```bash
npm start
# http://localhost:4000/ui/
```

There is no frontend build. The backend serves files from `web/` under `/ui/`:

- `GET /ui` → `308` to `/ui/`.
- `GET /ui/` → `web/index.html`.
- Assets: CSS, JavaScript, SVG.

### Serving it separately

Because it is static, you can serve `web/` with any static server:

```bash
python3 -m http.server 4173 --directory web
# http://localhost:4173/
```

In that case, set the **API base URL** in the interface to the backend address, for example `http://localhost:4000`. The backend already sends `Access-Control-Allow-Origin: *` for the local environment.

## Structure

```text
web/
  index.html          structure and i18n-tagged text
  styles.css          light/dark theme and responsive layout
  favicon.svg
  js/
    main.js           UI state, events and rendering
    api.js            fetch client for the overview and laboratory
    lib.js            pure helpers: URLs, formatting, headers, bodies
    i18n.js           Spanish/English dictionary
    catalog.js        sample endpoints and presets
```

## Data flow

1. The UI builds the API URL from the configured base.
2. `GET /health` and `GET /_control/stats` populate the overview.
3. The Request Lab runs `fetch` with the selected method, headers, body and Bearer token.
4. The response is displayed without interpreting the backend contract: status, headers and the real body.
5. The token is stored only in `sessionStorage`; theme, language and API base are stored in `localStorage`.
6. With `AUTH_REQUIRED=true`, `/api/v1` requests need permission; the demo token is preloaded so the catalog works when the UI opens.

## Backend static server

The `src/http/static.ts` handler:

- Serves only files inside `UI_DIR` (default `./web`).
- Resolves real paths and blocks path traversal.
- Restricts methods to `GET`, `HEAD` and `OPTIONS`.
- Applies MIME types and `Cache-Control: no-cache`.
- Adds a restrictive CSP to HTML documents.
- Returns `404` when the directory is missing or an asset does not exist.

Configuration:

```dotenv
UI_ENABLED=true
UI_DIR=./web
```

If `UI_ENABLED=false`, `/ui/` is no longer served and the API root returns `ui: null`.

## Customization

### Add a catalog endpoint

Edit `web/js/catalog.js` and add an entry with method, path, Spanish and English descriptions and, optionally, body and headers:

```js
{
  method: 'GET',
  path: '/api/v1/hr/reports/headcount',
  title: { es: 'Plantilla', en: 'Headcount' },
  description: { es: 'Agregado por departamento.', en: 'Aggregated by department.' }
}
```

### Add text

Add the key in `web/js/i18n.js` for both `es` and `en`. In HTML use `data-i18n`, `data-i18n-placeholder` or `data-i18n-aria-label`. The test script verifies that HTML keys are not missing.

### Change the look

Color tokens, radii, typography and shadows live in `:root` and `html[data-theme="dark"]` inside `web/styles.css`. There are no external dependencies or remote fonts.

## Security

- Received HTML is never rendered: the UI uses `textContent` for bodies and dynamic data.
- Tokens stay in `sessionStorage`, not `localStorage`.
- No third-party scripts or styles are included.
- The document CSP allows HTTP/HTTPS connections for a configurable local API base.
- The static server blocks traversal and does not list directories.
- The UI is for local environments only; displayed credentials are simulation values.

## Tests

```bash
npm test
npm run typecheck
```

Specific coverage:

- `tests/ui.test.ts`: static assets, MIME, CSP, `/ui` redirect, HEAD/OPTIONS, 404, 405 and path traversal.
- `tests/frontend.test.mjs`: pure URL, formatting, status, body and header helpers.

Visual verification was performed with headless Chrome against a real backend: overview, authenticated request, language switch and theme switch.
