# DC-PLATAFORMA — Instrucciones para Claude Code

Plataforma de seguimiento de tareas periódicas por departamento para DCSMART (~30
personas, 6-7 departamentos: auditoría, reportes, costos, tesorería, rrhh).

**Antes de tocar código, leer:**
- `docs/superpowers/specs/2026-08-08-dc-plataforma-design.md` (resumen rápido)
- `docs/superpowers/plans/2026-08-08-dc-plataforma.md` (plan completo, fase por fase)

## Regla de oro: no tocar `dcsmart` (producción) salvo en la Fase 8

Este proyecto es satélite de `dcsmart` (`C:\DEV_ORIG\01-APPS\dcsmart`), pero **no debe
modificar ese repo hasta la Fase 8 del roadmap**, y solo entonces con confirmación
explícita del usuario — `dcsmart` no tiene entorno de dev separado, cualquier
`prisma db push` ahí impacta producción real de inmediato. Todo el trabajo de las
Fases 0-7 usa un login de desarrollo propio y aislado, sin depender de `dcsmart`.

## Stack

- Backend: Node.js (ESM) + Fastify + Prisma + PostgreSQL (Cloud SQL, base `dc_plataforma`
  en la misma instancia que `dcsmart`: `dc-smart-mvp:us-central1:dcsmart-mvp-insta`)
- Frontend: Vite + React + React Router + Zustand (mismo stack que `dcsmart/frontend`)
- Motor de agenda: **Google Calendar API** — RRULE para recurrencia,
  `extendedProperties.private` para estado, `description` como historial append-only.
  No hay motor de recurrencia propio ni tabla de instancias.
- Kiosko: HTML estático sin build (`kiosko/`), reskinneado con identidad visual
  DCSMART (paleta de `dashboard-rendimiento-general`), con clave privada por
  departamento.

## Estructura

```
DC-PLATAFORMA/
├── CLAUDE.md
├── README.md
├── docs/superpowers/{plans,specs}/   ← documentación de diseño, convención de dcsmart
├── backend/
│   ├── prisma/schema.prisma
│   └── src/{server.js, plugins/{db,gcal}.js, routes/*.js, jobs/}
├── frontend/                          ← app de gestión (checklist, reportes, admin)
└── kiosko/                            ← HTML estático, pantallas por departamento
```

## Convenciones (heredadas de `dcsmart`)

- ESM, async/await, UUID v4 como PK, snake_case en tablas/columnas, `activo` en vez de
  hard-delete, timestamps `created_at`/`updated_at`.
- Sin tabla de roles/permisos propia: el admin de esta plataforma es el rol global
  `super_admin`/`dcsmart` de `dcsmart`, leído desde el ticket SSO — no inventar un
  sistema de permisos nuevo acá.
- `Departamento`/`Tarea`/`TareaAsignacion`/`CumplimientoDiario` son las únicas tablas
  propias con lógica de negocio real; `ExtUser`/`ExtLocal` son cache de solo lectura de
  `dcsmart`, nunca fuente de verdad.

## Antes de cualquier cambio en el schema de `dcsmart` (Fase 8, no antes)

Seguir la misma regla que ya está documentada en `dcsmart/CLAUDE.md`: correr
`prisma migrate diff --from-schema-datasource --to-schema-datamodel` y leer el SQL
generado antes de cualquier `db push` — no hay base de dev separada, es producción.
Confirmar explícitamente con el usuario antes de aplicar.
