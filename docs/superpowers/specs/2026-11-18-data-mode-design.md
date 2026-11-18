# Modo de datos congelado y restauración — Diseño

**Fecha:** 2026-11-18
**Estado:** Aprobado e implementado
**Versión en inglés:** [2026-11-18-data-mode-design.en.md](2026-11-18-data-mode-design.en.md)

## 1. Intención y motivo

El simulador debe permitir dos formas de trabajar con los datos:

- **Persistente:** las modificaciones se aplican a la base principal y sobreviven a los reinicios.
- **Congelado:** se toma una imagen del estado actual y se trabaja sobre una copia descartable. La base principal no se modifica.

En ambos modos el usuario debe poder volver al estado de origen: en persistente, restaurando los datos semilla; en congelado, descartando los cambios y volviendo a la imagen congelada. También debe poder salir del modo congelado y recuperar la base persistente intacta.

El objetivo es experimentar con las APIs sin miedo a contaminar la base de trabajo, y ofrecer una restauración explícita y protegida desde la API y la consola web.

## 2. Objetivos

- Cambiar entre modo persistente y congelado en caliente, sin reiniciar el proceso.
- Crear la imagen congelada como una foto consistente de la base persistente en el momento de activar el modo.
- Aislar todas las lecturas y escrituras del modo congelado en una copia descartable.
- Restaurar la imagen congelada sin tocar la base persistente.
- Restaurar los datos semilla en modo persistente.
- Exponer estado y acciones en `/_control` con el token de control.
- Añadir un panel claro en la consola web, bilingüe y con confirmaciones.
- Mantener los endpoints actuales de reset y datos demo.
- Incorporar licencia Apache-2.0, `NOTICE` y metadatos en `package.json`.
- Documentar y probar el comportamiento en español e inglés.

## 3. No objetivos

- Una base por usuario, por sesión o por petición.
- Historial de múltiples snapshots o viaje en el tiempo.
- Persistir el modo congelado entre reinicios.
- Congelado de solo lectura: el usuario debe poder escribir en la copia.
- Backups remotos, cifrado en reposo o retención de imágenes.
- Cambiar el modelo de autenticación de las APIs de negocio.
- Publicar el paquete en npm.

## 4. Restricciones

- Node.js 24, TypeScript estricto, `node:sqlite`, sin ORM.
- Una sola instancia activa por proceso.
- SQLite síncrono y WAL.
- Los handlers existentes conservan referencias a la base; el cambio de modo no debe dejar conexiones cerradas en uso.
- No se deben introducir secretos reales ni archivos generados en Git.
- La documentación nueva debe tener versión ES/EN.
- La licencia elegida es Apache-2.0.

## 5. Enfoques considerados

### A. Copia descartable en archivo temporal + fachada de base (elegido)

La clase `Db` pasa a ser una fachada estable sobre una conexión activa. Mantiene la conexión persistente y, cuando se congela, una conexión de trabajo separada.

- `freeze`: crea un snapshot consistente con `VACUUM INTO` en un directorio temporal privado, copia el snapshot a un archivo de trabajo, abre la copia y cambia la conexión activa.
- `restore` en congelado: abre una copia nueva desde el snapshot, cambia la conexión activa y cierra la anterior.
- `unfreeze`: cierra la copia de trabajo, vuelve a la conexión persistente y elimina el directorio temporal.
- `restore` en persistente: ejecuta el reseteo semilla existente.

Los handlers guardan la misma fachada `Db`, no la conexión cruda. Después de un `await`, cualquier operación usa la conexión activa del momento. Eso evita que una petición en vuelo escriba en la base persistente después de congelar, o en una conexión cerrada después de descongelar.

**Ventajas:** aislamiento real, robusto con WAL, no carga toda la base en RAM, restaurar es barato y el archivo persistente nunca se toca en congelado.

**Coste:** usa disco temporal y el snapshot bloquea el event loop durante `VACUUM INTO`; aceptable para un simulador local.

### B. Copia en memoria

Se serializa la base y se carga en una conexión en memoria.

**Descartado:** `serialize()` de una base en WAL requiere cambiar temporalmente el journal mode y el tamaño completo queda en RAM. Aporta menos robustez que el archivo temporal.

### C. Congelado de solo lectura

Se bloquean las escrituras y se restaura con el seeder.

**Descartado:** no cumple el requisito de “libre disposición” sobre la imagen.

## 6. Diseño detallado

### 6.1 Ciclo de vida

El proceso arranca siempre en modo persistente:

1. Abre `DB_PATH`, aplica el esquema y siembra solo si está vacío.
2. La conexión persistente permanece abierta durante toda la vida del proceso.
3. La conexión activa apunta a la persistente.

`POST /_control/freeze`:

1. Verifica que el modo sea persistente; si ya está congelado responde `409`.
2. Crea un directorio temporal con permisos de usuario (`mkdtemp`).
3. Ejecuta `VACUUM INTO` sobre la conexión persistente para obtener un snapshot consistente.
4. Copia el snapshot a `working.sqlite` y lo abre como conexión de trabajo.
5. Guarda `frozen_at` y el conteo de registros de la imagen.
6. Cambia la conexión activa a la copia de trabajo.

`POST /_control/restore`:

- En persistente: borra y regenera todos los dominios con los seeders deterministas.
- En congelado: abre una copia nueva desde el snapshot, cambia la conexión activa y descarta la copia anterior. La base persistente no se toca.

`POST /_control/unfreeze`:

1. Verifica que el modo sea congelado; si no, responde `409`.
2. Cierra la conexión de trabajo.
3. Cambia la conexión activa a la persistente.
4. Elimina el directorio temporal y limpia el estado congelado.

`POST /_control/reset` y `POST /_control/reset/:domain` se mantienen:

- En persistente, resetean la base persistente.
- En congelado, resetean la copia de trabajo.
- Nunca tocan la base persistente cuando el modo es congelado.

### 6.2 Reinicios y fallos

- Un reinicio descarta el modo congelado y vuelve a la base persistente. Es intencional: la base persistente es la fuente de verdad.
- Un fallo durante `freeze` deja la conexión persistente activa y elimina los temporales parciales.
- Un fallo durante `restore` en congelado mantiene la copia anterior activa.
- Al cerrar el proceso se cierran todas las conexiones y se elimina el directorio temporal.
- Un cierre abrupto puede dejar un directorio temporal en el sistema; la base persistente sigue intacta. Se documenta como limitación local.

### 6.3 Estado y API

`GET /_control/mode` es público, igual que las estadísticas:

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

En congelado, `mode` es `"frozen"`, `frozen_at` es ISO-8601, `baseline_records` es el tamaño de la imagen y `active_records` puede diferir por los cambios de la copia.

Endpoints nuevos, todos con `X-Control-Token` salvo la consulta de estado:

| Método | Ruta | Acción |
|---|---|---|
| GET | `/_control/mode` | Estado público del modo |
| POST | `/_control/freeze` | Crea la imagen y activa el congelado |
| POST | `/_control/unfreeze` | Descarta la copia y vuelve a persistente |
| POST | `/_control/restore` | Restaura la imagen o los datos semilla según el modo |

`GET /_control/stats` incorpora el mismo bloque de modo. Los endpoints de reset añaden `mode` en la respuesta.

Transiciones inválidas devuelven `409 CONFLICT`; la falta de token de control devuelve `401`.

### 6.4 Consola web

Se añade un panel “Modo de datos” en el resumen:

- Badge de estado: **Persistente** o **Congelado**.
- Texto explicativo del modo activo.
- Campo de token de control, separado del Bearer token del Request Lab.
- Acciones:
  - **Congelar base**: solo en persistente.
  - **Restaurar datos**: en persistente vuelve a los datos semilla; en congelado vuelve a la imagen.
  - **Salir del congelado**: solo en congelado.
- Confirmación antes de restaurar o descartar.
- Actualización del resumen y de las estadísticas después de cada acción.
- Errores de token o transición mostrados como toast y mensaje accesible.

El token de control se guarda en `sessionStorage`, no en `localStorage`. El valor por defecto visible es el token local de simulación.

### 6.5 OpenAPI y documentación

- Las rutas nuevas se registran con metadatos bilingües y se añaden al catálogo de traducciones OpenAPI.
- Se actualizan `README.md`, `README.en.md`, `docs/user-guide.md`, `docs/user-guide.en.md`, `docs/capabilities.md`, `docs/capabilities.en.md`, `docs/frontend.md` y `docs/frontend.en.md`.
- Se añade `docs/data-modes.md` y `docs/data-modes.en.md` con el contrato, ejemplos `curl` y limitaciones.
- Se actualiza `PLAN.md` y `PLAN.en.md`.

## 7. Revisión de `package.json`

### Estado actual

- `name`, `version`, `private`, `type`, `description`: correctos para una aplicación local privada.
- `scripts`: `dev`, `start`, `start:dist`, `build`, `typecheck`, `test`, `certs`.
- `engines.node >= 24`: correcto por `node:sqlite` y el runner de pruebas.
- Solo hay `devDependencies` (`@types/node`, `tsx`, `typescript`): el runtime usa módulos nativos de Node, así que no hay dependencias de producción.
- `package-lock.json` usa lockfile v3; `npm ci --dry-run` está sincronizado y `npm audit --omit=dev` reporta 0 vulnerabilidades.
- `start` usa `tsx`, que es una dependencia de desarrollo. Para ejecutar compilado hay que usar `npm run build && npm run start:dist`.

### Ajustes previstos

1. Añadir `"license": "Apache-2.0"`.
2. Añadir `LICENSE` con el texto completo de Apache-2.0 y `NOTICE` con el nombre del proyecto y el copyright.
3. Sustituir el `mkdir -p`/`cp` del script `build` por un script Node portable (`scripts/copy-schema.mjs`) para que el build no dependa de utilidades POSIX.
4. Mantener `private: true` y no añadir `main`, `exports` ni `files`: no es una librería publicable.
5. No añadir `author`, `repository` ni `homepage` sin datos reales; evitamos inventar metadatos.
6. Documentar en README la diferencia entre `npm start` (desarrollo con `tsx`) y `npm run start:dist` (compilado).
7. Quitar los rangos `^` de `devDependencies` y fijar las versiones exactas instaladas (`@types/node`, `tsx`, `typescript`), regenerando `package-lock.json`. El lockfile ya garantiza reproducibilidad, pero el pinning explícito evita que una nueva instalación resuelva versiones distintas si se borra el lockfile.

### 7.1 Políticas de calidad de código

El proyecto no tiene linting ni formato automatizado. Se añaden:

- **ESLint 10** con flat config y `typescript-eslint` recomendado.
- **Prettier 3** para formato consistente.
- **EditorConfig** para espacios, UTF-8 y fin de línea.
- Reglas: `eqeqeq`, `prefer-const`, `no-var`, variables no usadas y `no-explicit-any` desactivado solo en tests.
- Scripts: `lint`, `format`, `format:check` y `check` (typecheck + lint + formato + tests).
- CI ejecuta lint y verificación de formato además de typecheck, tests y build.
- Dependencias de calidad fijadas a versiones exactas, sin `^`.
- Prettier ignora documentación, HTML, lockfile, artefactos y material legal para no reescribir textos bilingües ni archivos generados.

## 8. Licencia

Se adopta **Apache License 2.0**:

- `LICENSE`: texto canónico en inglés.
- `NOTICE`: atribución del proyecto y año.
- `package.json`: `"license": "Apache-2.0"`.
- README ES/EN: sección de licencia que enlaza a `LICENSE` y `NOTICE`.

Apache-2.0 aporta concesión explícita de patentes y protección de marcas, y sigue siendo permisiva para reutilización y uso comercial.

## 9. Pruebas

Nuevas pruebas de integración:

1. Estado inicial persistente.
2. Congelar, escribir en la copia, verificar que la base persistente no cambia al descongelar.
3. Restaurar la imagen congelada y comprobar que los cambios desaparecen.
4. Restaurar en persistente y comprobar que vuelven los datos semilla.
5. Reset de dominio en congelado sin afectar la base persistente.
6. Transiciones inválidas (`freeze` congelado, `unfreeze` persistente) devuelven `409`.
7. Acciones protegidas sin token devuelven `401`.
8. `GET /_control/mode` y `stats` reflejan el modo.
9. OpenAPI contiene las rutas y resúmenes en inglés.
10. `package.json` declara Apache-2.0, existen `LICENSE` y `NOTICE`, y la documentación enlaza la licencia.

La suite final es de 73 pruebas: 65 existentes más las nuevas de datos, API, UI, licencia y regresión de fallo al congelar.

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| `VACUUM INTO` bloquea el event loop | La base del simulador es pequeña; se documenta. Se puede migrar a `backup()` asíncrono si crece. |
| Uso de disco temporal | Se elimina al descongelar o cerrar; el directorio es privado. |
| Cierre abrupto deja temporales | La base persistente no se toca; se documenta la limpieza manual. |
| Handlers con referencias a la base | La fachada `Db` delega siempre en la conexión activa, no en la conexión cruda. |
| El modo congelado se pierde al reiniciar | Es intencional y visible en la UI/documentación. |
| Cambio de licencia en un proyecto ya distribuido | Se añade `LICENSE`, `NOTICE`, `package.json` y README; no se reescribe el historial. |

## 11. Decisiones pendientes del implementador

- Nombres finales de los campos de estado y respuestas, manteniendo el contrato de este documento.
- Redacción exacta de los textos ES/EN.
- Ubicación del script portable de copia del esquema.
- Si el panel de modo va dentro del resumen o en una sección propia; se prefiere dentro del resumen para no alargar la navegación.

## 12. Criterio de aceptación

- Se puede congelar, modificar, restaurar y descongelar desde la API y la UI.
- La base persistente no cambia mientras se trabaja en congelado.
- Restaurar en persistente devuelve los datos semilla.
- Reiniciar el proceso vuelve a la base persistente.
- El token de control protege todas las acciones destructivas.
- Apache-2.0 está declarada y documentada.
- Typecheck, build, pruebas y documentación bilingüe pasan.
