# DC-PLATAFORMA

Plataforma de seguimiento de tareas periódicas por departamento para DCSMART (equipo
de ~30 personas, 6-7 departamentos: auditoría, reportes, costos, tesorería, rrhh —
extensible). Cada departamento tiene un checklist de tareas recurrentes; Google
Calendar es el motor real de agenda y estado (ver `docs/superpowers/specs/`).

Ver `CLAUDE.md` para la guía de construcción completa y
`docs/superpowers/plans/2026-08-08-dc-plataforma.md` para el plan de implementación
detallado, fase por fase.

## Stack

- Backend: Node.js (ESM) + Fastify + Prisma + PostgreSQL (Cloud SQL, misma instancia
  que `dcsmart`)
- Frontend: Vite + React + React Router + Zustand
- Motor de agenda: Google Calendar API (RRULE + `extendedProperties`)
- Kiosko: HTML estático (`kiosko/`), sin build, estilo visual DCSMART

## Estado

En desarrollo — ver el plan para el roadmap por fases. La integración con `dcsmart`
(producción) es deliberadamente la última fase, no la primera.
