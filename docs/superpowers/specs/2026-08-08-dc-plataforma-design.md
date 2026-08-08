# DC-PLATAFORMA — diseño (resumen)

Ver el plan completo en `docs/superpowers/plans/2026-08-08-dc-plataforma.md`. Este doc
es el resumen rápido de decisiones, para no tener que releer todo el plan cada vez.

## Contexto

Seguimiento de tareas periódicas por departamento para DCSMART (~30 personas, 6-7
departamentos). Objetivo: seguimiento de responsabilidades y % de cumplimiento, sin
sobredimensionar el sistema de permisos para un equipo de este tamaño.

## Data model

- **Motor de agenda y estado: Google Calendar API**, no una tabla propia de
  instancias. Un calendario por `Departamento`. Recurrencia = RRULE. Estado
  (`PENDIENTE`/`REALIZADA`/`CANCELADA`, `APROBADA` reservado) = `extendedProperties`.
  Historial = líneas agregadas a `description`.
- Base propia (`dc_plataforma`, Postgres) solo para lo que Calendar no puede dar:
  `ExtUser`/`ExtLocal` (cache de dcsmart), `Departamento` (config: calendarId, Group,
  webhook de Chat, clave de kiosko), `Tarea` (catálogo, departamento fijo),
  `TareaAsignacion` (puntero tarea×local → evento de Calendar), `CumplimientoDiario`
  (snapshot diario para reportes históricos).

## Permisos

Sin RBAC propio. Admin = rol global `super_admin`/`dcsmart` de `dcsmart`, leído del
ticket SSO. Cualquier otro usuario gestiona su propio departamento
(`ExtUser.id_departamento`, viene de `dcsmart.users`) sobre todos sus locales, sin
restricción por local.

## Fuera de alcance (v1)

- Aprobación/doble-check (estado `APROBADA` reservado, no usado).
- Chat bidireccional (solo webhook de una vía).
- RBAC granular por local dentro de un departamento.
- Evidencia/foto al marcar una tarea.
- Variante de recurrencia "día hábil".

## Restricción de secuenciación

Todo se construye y prueba contra un login temporal de desarrollo. El único punto de
contacto con `dcsmart` (producción, sin entorno de dev separado) es la Fase 8: el
ticket SSO + el modelo `Departamento`/columna `User.id_departamento`, agrupados en un
solo cambio al final.
