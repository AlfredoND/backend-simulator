# Micro frontend

Idiomas: **Español** | [English](frontend.en.md)

El proyecto incluye un micro frontend estático para operar el simulador desde el navegador. Está escrito con **JavaScript nativo y ES modules**: no usa framework, no tiene dependencias de UI y no necesita un paso de build.

## Qué ofrece

- **Resumen**: salud del backend, uptime, número de registros, dominios y conteo por dominio.
- **Request Lab**: constructor de peticiones HTTP con método, ruta, headers, body, token Bearer, aborto y visualización de estado, tiempo, tamaño, headers y cuerpo.
- **Catálogo de APIs**: endpoints de ejemplo por dominio, con búsqueda y carga directa en el Request Lab.
- **Documentación**: enlaces a OpenAPI (ES/EN) y Swagger UI, credenciales locales, comandos de arranque y límites del entorno.
- **Autenticación**: el token demo `local-admin-token` está precargado y adjunto; puedes borrarlo para comprobar 401.
- **Preferencias**: idioma español/inglés y tema claro/oscuro persistidos en el navegador.
- **API base configurable**: permite usar la UI servida por el backend o servirla por separado.

## Arranque

La UI se sirve desde el mismo backend:

```bash
npm start
# http://localhost:4000/ui/
```

No hay compilación de frontend. El backend sirve los archivos de `web/` mediante `/ui/`:

- `GET /ui` → `308` a `/ui/`.
- `GET /ui/` → `web/index.html`.
- Assets: CSS, JavaScript, SVG.

### Servirla por separado

Al ser archivos estáticos, también puedes servir `web/` con cualquier servidor estático:

```bash
python3 -m http.server 4173 --directory web
# http://localhost:4173/
```

En ese caso, configura la **Base URL de la API** en la interfaz con la dirección del backend, por ejemplo `http://localhost:4000`. El backend ya envía `Access-Control-Allow-Origin: *` para el entorno local.

## Estructura

```text
web/
  index.html          estructura y textos con atributos i18n
  styles.css          tema claro/oscuro y diseño responsive
  favicon.svg
  js/
    main.js           estado de UI, eventos y renderizado
    api.js            cliente fetch para el resumen y el laboratorio
    lib.js            funciones puras: URLs, formato, headers, cuerpos
    i18n.js           diccionario español/inglés
    catalog.js        endpoints de ejemplo y presets
```

## Flujo de datos

1. La UI calcula la URL de la API a partir de la base configurada.
2. `GET /health` y `GET /_control/stats` alimentan el resumen.
3. El Request Lab ejecuta `fetch` con el método, headers, body y Bearer token indicados.
4. La respuesta se muestra sin interpretar el contrato del backend: estado, headers y cuerpo real.
5. El token se guarda solo en `sessionStorage`; tema, idioma y API base se guardan en `localStorage`.
6. Con `AUTH_REQUIRED=true` las peticiones a `/api/v1` necesitan permiso; el token demo se precarga para que el catálogo funcione al abrir la UI.

## Servidor estático del backend

El handler `src/http/static.ts`:

- Sirve únicamente archivos dentro de `UI_DIR` (por defecto `./web`).
- Resuelve rutas reales y bloquea path traversal.
- Limita los métodos a `GET`, `HEAD` y `OPTIONS`.
- Aplica tipos MIME y `Cache-Control: no-cache`.
- Añade una CSP restrictiva a documentos HTML.
- Responde `404` si el directorio no existe o el asset falta.

Configuración:

```dotenv
UI_ENABLED=true
UI_DIR=./web
```

Si `UI_ENABLED=false`, `/ui/` deja de servirse y la raíz del API devuelve `ui: null`.

## Personalización

### Añadir un endpoint al catálogo

Edita `web/js/catalog.js` y añade una entrada con método, ruta, descripciones en español e inglés y, opcionalmente, body y headers:

```js
{
  method: 'GET',
  path: '/api/v1/hr/reports/headcount',
  title: { es: 'Plantilla', en: 'Headcount' },
  description: { es: 'Agregado por departamento.', en: 'Aggregated by department.' }
}
```

### Añadir textos

Añade la clave en `web/js/i18n.js` para `es` y `en`. En HTML usa `data-i18n`, `data-i18n-placeholder` o `data-i18n-aria-label`. El script de prueba comprueba que no falten claves usadas en HTML.

### Cambiar el aspecto

Los tokens de color, radios, tipografía y sombras están en `:root` y `html[data-theme="dark"]` dentro de `web/styles.css`. No hay dependencias externas ni fuentes remotas.

## Seguridad

- No se renderiza HTML recibido: la UI usa `textContent` para cuerpos y datos dinámicos.
- Los tokens se mantienen en `sessionStorage`, no en `localStorage`.
- No se incluyen scripts ni estilos de terceros.
- La CSP del documento permite conexiones HTTP/HTTPS para una API base local configurable.
- El servidor estático bloquea traversal y no lista directorios.
- La UI es solo para entorno local; las credenciales mostradas son de simulación.

## Pruebas

```bash
npm test
npm run typecheck
```

Cobertura específica:

- `tests/ui.test.ts`: estáticos, MIME, CSP, redirect `/ui`, HEAD/OPTIONS, 404, 405 y path traversal.
- `tests/frontend.test.mjs`: funciones puras de URLs, formatos, estados, cuerpos y headers.

La verificación visual se realizó con Chrome headless contra un backend real: resumen, petición autenticada, cambio de idioma y tema.
