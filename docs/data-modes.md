# Modos de datos: persistente y congelado

[English](data-modes.en.md) · [Guía de usuario](user-guide.md)

## Resumen

El simulador puede trabajar con la base de dos formas:

| Modo | Qué ocurre | Restauración | Reinicio |
|---|---|---|---|
| **Persistente** | Las APIs leen y escriben en `DB_PATH`. | Vuelve a los datos semilla. | Los cambios se conservan. |
| **Congelado** | Se trabaja sobre una copia descartable de una imagen. | Descarta los cambios y vuelve a la imagen. | La base persistente sigue intacta. |

El modo congelado es útil para demos, pruebas destructivas o experimentos: podés modificar todo lo que quieras y la base principal no se toca.

## Congelar la base

```bash
curl -s -X POST http://localhost:4000/_control/freeze \
  -H 'X-Control-Token: local-control-token'
```

La respuesta incluye el modo, la fecha de la imagen, los registros de la imagen y los registros de la copia activa:

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

A partir de ese momento, `POST /_control/reset`, `POST /_control/seed` y todas las APIs de negocio escriben en la copia.

## Consultar el modo

```bash
curl -s http://localhost:4000/_control/mode
```

`GET /_control/mode` es público y no requiere token. `GET /_control/stats` incluye el mismo bloque en `data_mode`.

## Restaurar

En modo congelado, restaura la imagen original y descarta los cambios de la copia:

```bash
curl -s -X POST http://localhost:4000/_control/restore \
  -H 'X-Control-Token: local-control-token'
```

En modo persistente, regenera todos los datos semilla:

```bash
curl -s -X POST http://localhost:4000/_control/restore \
  -H 'X-Control-Token: local-control-token'
```

La respuesta indica el origen de la restauración con `"restored": "snapshot"` o `"restored": "seed"`.

## Salir del modo congelado

```bash
curl -s -X POST http://localhost:4000/_control/unfreeze \
  -H 'X-Control-Token: local-control-token'
```

Descarta la copia y vuelve a la base persistente. Si querías conservar los cambios de la copia, no los vas a encontrar después de salir.

## Reset y datos demo

`POST /_control/reset`, `POST /_control/reset/:domain` y `POST /_control/seed` operan sobre la conexión activa:

- En persistente, sobre la base principal.
- En congelado, sobre la copia descartable.

Nunca modifican la base persistente mientras el modo sea congelado.

## Reinicio y fallos

- Al reiniciar, el servidor siempre arranca en modo persistente.
- La base persistente es la fuente de verdad.
- Un cierre abrupto puede dejar un directorio temporal en el sistema; la base persistente sigue intacta.
- El snapshot se crea con `VACUUM INTO` y bloquea el event loop mientras se ejecuta. Es aceptable para el tamaño de este simulador local.
- Solo hay una imagen congelada activa por proceso.

## Consola web

El panel **Modo de datos** de `/ui/` permite congelar, restaurar y salir del congelado sin usar `curl`. El token de control se guarda en `sessionStorage` y se envía como `X-Control-Token` solo en esas acciones.

## Licencia

El proyecto se distribuye bajo Apache License 2.0. Consulta [LICENSE](../LICENSE) y [NOTICE](../NOTICE).
