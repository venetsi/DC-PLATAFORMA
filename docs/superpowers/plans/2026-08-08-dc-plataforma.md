# Plataforma de seguimiento de tareas periódicas por departamento — DCSMART

## Contexto

DCSMART (equipo de ~30 personas repartido en 6-7 departamentos: auditoría, reportes,
costos, tesorería, rrhh — extensible) necesita una plataforma de **seguimiento de
responsabilidades**: qué tareas periódicas le tocan a cada departamento, quién las hizo
y cuándo, y cuánto se está cumpliendo. **Objetivo explícito del usuario: no
sobredimensionar** — este plan prioriza lo mínimo que resuelve seguimiento real de
tareas y responsabilidades por sobre construir un sistema de permisos/aprobación
elaborado que un equipo de este tamaño no necesita todavía.

Hoy no existe nada de esto en el sistema principal `dcsmart`: no hay concepto de
"departamento" (la tabla `apps` es el grupo/cadena gastronómica — tenant, no
departamento interno), no hay motor de recurrencia (solo un flag manual
`Pago.periodico` sin scheduling), y no hay checklist de ningún tipo. Se investigó a
fondo el repo real de `dcsmart` (`C:\DEV_ORIG\01-APPS\dcsmart`) y sus apps satélite
(`dcsmart-auditoria`, `dashboard-rendimiento-general`, `DCBI/dcsmart-analytics`) para
anclar cada decisión a patrones ya probados en producción.

**Decisiones tomadas con el usuario (varias rondas de revisión):**
- **Check simple en v1, no doble check todavía**: un usuario marca una tarea como
  "realizada" y eso alcanza — **no hay paso de aprobación activo por ahora**. El modelo
  de datos deja el estado `APROBADA` reservado para cuando se active esa función más
  adelante (Fase 9), pero la UI/flujo de v1 no la usa: "realizada" ya es terminal.
- **Seguimiento de cumplimiento SÍ es un objetivo central**, no un "nice to have":
  pendientes y % de cumplimiento por departamento, con historial — esto llevó a incluir
  un snapshot diario propio (ver más abajo) en vez de dejarlo como mejora futura.
- **Cualquier persona de un departamento ve y gestiona las tareas de TODOS los locales
  de su departamento** — no hace falta restringir por local dentro de un departamento
  (se descartó una tabla de "responsable acotado a ciertos locales").
- **El departamento de cada usuario vive en la tabla de usuarios de `dcsmart`** (no en
  una tabla propia de esta plataforma), para que quede disponible para todo el
  ecosistema DCSMART, no solo para esta app. Esto se concilia con el pedido de no tocar
  `dcsmart` hasta el final: los dos cambios que necesita `dcsmart` (el ticket SSO y el
  campo de departamento) se agrupan en una única fase final, no se adelanta ninguno.
- Pantallas: **kiosko con clave privada por departamento** (no público/abierto) + vista
  web con login.
- Arquitectura: app nueva y separada (`DC-PLATAFORMA`), con su propia base de datos
  para lo que es específico de esta plataforma (agenda, catálogo de tareas), pero
  identidad/departamento se leen de `dcsmart`.
- **Motor de agenda: Google Calendar API, reemplazo total** — recurrencia y estado
  (`PENDIENTE`/`REALIZADA`/`CANCELADA` activos en v1; `APROBADA` reservado) viven en
  Google Calendar vía `extendedProperties`, no en una tabla propia de instancias.
- **Filosofía Google-first confirmada**: evaluar qué resuelve nativamente Google
  Workspace Business (ya lo usa DCSMART) antes de construir un equivalente propio.
  Aplicada a Calendar (motor de agenda), descartada para Tasks (sin recurrencia, sin
  metadata custom, sin listas compartibles), aplicada a Groups (compartir el Calendar
  de cada departamento) y Chat (avisos de una vía).

**Riesgos aceptados con "Calendar como motor"** (ya evaluados, siguen vigentes):
- Cada check es una llamada a una API externa en el camino crítico — si Calendar tiene
  un problema o el service account pierde acceso, se cae la operación real.
- RRULE describe puntos de recurrencia, no ventanas ("de 1 al 10 de cada mes" no es un
  solo patrón nativo) — sigue haciendo falta una capa de traducción en la UI.
- El reporting histórico agregado no es una query SQL nativa contra Calendar — **este
  con ahora está mitigado**, no solo aceptado: se agrega un snapshot diario propio (ver
  "Seguimiento de cumplimiento" más abajo) precisamente porque el usuario confirmó que
  este dato le importa de verdad.

(Ya no aplica como riesgo: los permisos "gruesos" de Calendar por calendario dejaron de
ser un problema — el modelo real es "todo el departamento ve/gestiona todos sus
locales", que es exactamente el nivel de granularidad que un calendario por
departamento ya da de forma nativa.)

## Estrategia de secuenciación: no tocar `dcsmart` (producción) hasta el final

Pedido explícito del usuario: avanzar con toda la plataforma nueva sin tocar nada de
`dcsmart` — el único sistema de este plan que ya está en producción real, compartido
entre `dev` y `master` en el mismo backend, sin base de dev separada (ver
`dcsmart_repo_infra_hazards` en memoria).

**Los dos únicos cambios que este plan necesita en `dcsmart` se agrupan en una sola
fase final** (confirmado con el usuario — ver pregunta resuelta sobre dónde vive el
departamento):
1. `POST /api/auth/tareas-ticket` (aditivo, calcado de `costos-ticket`).
2. Un modelo nuevo `Departamento` (id, nombre, slug, activo) + columna nullable
   `User.id_departamento`, más un campo para elegir departamento en la pantalla de
   Usuarios que `dcsmart` ya tiene — aditivo también, no modifica ninguna tabla/ruta
   existente.

**Cómo se logra sin bloquear el resto del trabajo — login temporal de desarrollo:**
mientras no exista lo anterior, `DC-PLATAFORMA` arranca con un mecanismo de auth de
desarrollo propio y aislado (usuario semilla + login simple) que no depende de
`dcsmart`, y un catálogo de departamentos sembrado a mano para probar. Esto permite
construir y probar de punta a punta todo lo demás — modelo de datos, Calendar/Groups/
Chat, backend, frontend, kiosko, importación del Excel — sin haber tocado producción.
Migrar al final es un cambio acotado a la capa de identidad, no un rediseño.

## Arquitectura general

Nuevo repo **`DC-PLATAFORMA`**, con escritura real (marcar tareas) que se traduce en
escrituras a la API de Google Calendar, no a una tabla propia de instancias.

```
dcsmart (existente)          DC-PLATAFORMA (nuevo)                  Google Calendar
┌──────────────────┐         ┌───────────────────────────┐          ┌──────────────────┐
│ Postgres          │ ticket │ Postgres propia (liviana):  │ Calendar │ 1 calendario por  │
│ users (+depto),    │◄──SSO─┤ ExtUser/ExtLocal (cache),    │───API───►│ departamento,      │
│ locales, apps...   │        │ Departamento (config),       │ (motor  │ eventos recurrentes │
│                    │        │ Tarea (catálogo),             │  real)  │ (RRULE) +           │
│ + POST /tareas-    │        │ TareaAsignacion (puntero),   │          │ extendedProperties  │
│   ticket            │        │ CumplimientoDiario (snapshot)│          │ = estado            │
└──────────────────┘         └───────────────────────────┘          └──────────────────┘
        Sidebar: botón "Tareas" ────────┘ abre /sso?ticket=...
```

Identidad y permisos, resuelto sin construir un RBAC propio: **el rol de admin de
`DC-PLATAFORMA` es directamente el rol global `super_admin`/`dcsmart` que ya existe en
`dcsmart`** (viaja en el ticket SSO, mismo patrón que `costos-ticket` ya usa para saber
si alguien es super_admin). No hace falta una tabla de roles propia ni una pantalla de
"asignar admin" en `DC-PLATAFORMA`. Cualquier otro usuario autenticado gestiona las
tareas de su propio departamento (`ExtUser.id_departamento`, sincronizado desde
`dcsmart`), sobre todos los locales — no hace falta restricción por local.

## Validación contra un caso real (`DCSMART ESTRUCTURA.xlsx`)

El usuario compartió un ejemplo real de cómo piensa esta estructura, con dos tablas:
- **Catálogo** `TAREA → DEPARTAMENTO`: lista maestra de tipos de tarea (CCSS, P&L, CMV,
  SUELDOS, AUDITORIA, TAREA1..16) con su departamento responsable.
- **Asignación** `LOCAL, TAREA, FECHA, PERIODO, USUARIO, DEPARTAMENTO`: una fila por
  combinación local+tarea.

El departamento de una tarea es fijo (viene del catálogo). La columna USUARIO es real:
**responsable por defecto opcional** — la mayoría de las filas no lo tienen (lo hace
cualquier persona del departamento), pero puede fijarse una persona puntual para una
tarea específica.

El hallazgo que cambia el modelo: la misma tarea tiene **fecha y periodicidad
distintas en cada local** — ej. "P&L" es "de 1 al 10, DE CADA MES" en Local1 pero "día
15, MENSUAL" en Local2. Por eso la recurrencia no puede vivir en el catálogo `Tarea`
(compartido) — vive en la asignación tarea×local: cada combinación es su **propio
evento recurrente** en Google Calendar. También aparecen filas "fecha a asignar"
(vinculada a un local pero sin agenda definida todavía).

## Google Calendar como motor: cómo se representa la agenda y el estado

Validado contra la documentación real de la API:

- **RRULE (RFC 5545) cubre los patrones del ejemplo**: diaria (`FREQ=DAILY`), semanal
  por día específico (`FREQ=WEEKLY;BYDAY=TH`), mensual por día fijo
  (`FREQ=MONTHLY;BYMONTHDAY=15`), cada N meses (`INTERVAL=3` = trimestral, `6` =
  semestral, `FREQ=YEARLY` = anual). **Límite real**: RRULE describe puntos, no
  ventanas — "de 1 al 10" se resuelve guardando el RRULE sobre el día de
  **vencimiento** (10) y dejando "desde el día 1" como información secundaria en la UI.
- **`vigencia_desde`/`vigencia_hasta`/`hora_limite` no necesitan columnas propias**:
  son el `start`, el `UNTIL` de la recurrencia, y el `end.dateTime` del evento.
- **`extendedProperties.private`** (hasta 300 props/32 KB por evento) guarda el estado:
  ```json
  {
    "id_asignacion": "<uuid>",
    "id_departamento": "<uuid>",
    "id_local_ext": "<uuid o vacío>",
    "asignado_a": "<email opcional>",
    "estado": "PENDIENTE | REALIZADA | CANCELADA",
    "realizada_por": "<email>", "realizada_en": "<iso timestamp>"
  }
  ```
  (`APROBADA`, `revisada_por`, `revisada_en` quedan reservados en el diseño para
  cuando se active la aprobación en Fase 9 — no se usan en v1.) Filtrables en
  `events.list` vía `privateExtendedProperty=estado=PENDIENTE` — así se arman
  "pendientes" y "vencidas" sin tabla propia para el estado del día.
- **`description` como historial**: cada transición agrega una línea legible en vez de
  sobrescribir — el historial queda visible incluso abriendo el evento en Calendar.
- **Marcar una fecha puntual sin afectar el resto de la serie**: `events.patch` sobre
  el **id de la instancia expandida** (`events.list(singleEvents=true)`), no el evento
  maestro — crea una excepción puntual. **Es la pieza de la que depende toda la
  arquitectura — spike de validación obligatorio en Fase 1 antes de construir nada más
  encima de este supuesto.**
- **Editar la agenda con instancias futuras ya generadas**: `events.patch` sobre el
  `recurrence` del maestro — Calendar re-expande el futuro y preserva las excepciones
  ya modificadas. Reemplaza lo que en un motor propio sería lógica de materialización a
  mano.
- **No hace falta job de materialización**: Calendar expande al vuelo en cada
  `events.list(timeMin, timeMax, singleEvents=true)`.
- **Cuotas**: 10.000 req/min por proyecto, 600 req/min por usuario, 1.000.000/día — muy
  por encima de lo que un equipo de 30 personas / 6-7 departamentos puede generar.
- **Un calendario por Departamento** (no por local): se crea automáticamente al dar de
  alta un departamento (ver "Sync de Departamento" más abajo), propiedad del service
  account. Cada evento lleva `id_local_ext` en `extendedProperties` para filtrar por
  local dentro del departamento.
- **`asignado_a` va como `extendedProperty`, no como `attendee`**: usar invitados
  nativos de Calendar dispararía emails de invitación de Google por cada tarea.

## Seguimiento de cumplimiento (pendientes y % de cumplimiento)

Confirmado como objetivo central, no accesorio. Un job diario liviano (parte del mismo
Cloud Scheduler que la reconciliación) recorre, por cada `Departamento` activo,
`events.list` del día que termina y escribe una fila de snapshot:

```prisma
model CumplimientoDiario {
  id               String   @id @default(uuid())
  id_departamento  String
  id_local_ext     String?           // null = agregado a nivel departamento completo
  fecha            DateTime @db.Date
  total_tareas     Int
  realizadas       Int
  vencidas_sin_hacer Int
  created_at       DateTime @default(now())
  departamento Departamento @relation(fields: [id_departamento], references: [id])
  @@unique([id_departamento, id_local_ext, fecha])
  @@map("cumplimiento_diario")
}
```

Esto da, con una query SQL simple contra la propia base (no contra Calendar), "%
cumplimiento del mes" y series históricas por departamento/local — sin tener que
recorrer meses de eventos de Calendar cada vez que alguien abre un reporte. El estado
de **hoy** (pendientes ahora mismo) sigue siendo una lectura en vivo de Calendar, como
ya estaba diseñado — el snapshot es solo para lo histórico/agregado.

## Sync de identidad y departamento (reemplaza lo que antes era `SectorMiembro`)

Ya no existe una tabla propia de membresía a departamento — viene de `dcsmart`:

- El ticket SSO (`tareas-ticket`) incluye `id_departamento`/`departamento_slug` del
  usuario logueado, y si es `super_admin`/`dcsmart` (rol global), además el **catálogo
  completo de departamentos** — mismo patrón que `costos-ticket` ya usa para mandarle a
  un `super_admin` todos los locales de una.
- Al recibir el ticket, `DC-PLATAFORMA` hace upsert de `ExtUser` (con su
  `id_departamento`) y, para cada departamento nuevo que ve por primera vez, crea
  automáticamente su fila `Departamento` + Calendar + (más adelante) Group/webhook —
  "sync perezoso" en vez de una pantalla de administración de departamentos propia.
- Esto elimina la necesidad de `/admin/sectores` y `/admin/usuarios` en `DC-PLATAFORMA`
  — de eso se encarga la pantalla de Usuarios que `dcsmart` ya tiene, con el nuevo
  campo de departamento agregado ahí (Fase 8).

## Google Groups: compartir el Calendar de cada departamento con sus miembros

Objetivo puntual: que cada persona vea la agenda de su departamento en su propio
Google Calendar, sin permiso de edición directa (la edición de estado sigue siendo
exclusiva de la plataforma, para no corromper `extendedProperties`/`description`).

- Al crear un `Departamento` (sync perezoso desde el ticket), el backend crea también
  un Google Group (`depto-<slug>@dcsmart.app`) y comparte el Calendar con ese Group en
  rol **`reader`** (nunca `writer`).
- La membresía del Group se sincroniza **desde `dcsmart` hacia el Group**, nunca al
  revés — la fuente de verdad de "quién está en qué departamento" es `dcsmart.users`.
- **Requiere domain-wide delegation** sobre `dcsmart.app` — grant más amplio que el de
  Calendar por sí solo. Necesita autorización explícita del super-admin de Workspace
  antes de esta fase (no bloquea las fases anteriores).
- Nota operativa: tras crear un Group hay que esperar ~1 minuto antes de poder
  agregarle el primer miembro.

## Google Chat: notificaciones de una vía por departamento

Vía **webhook entrante** (no una app de Chat completa, no hace falta interactividad).
Cada Space de Chat de un departamento tiene un webhook configurado una vez (requiere
que un admin de Workspace habilite esa opción) guardado en `Departamento.chat_webhook_url`.

Un job cada 1h escanea `estado=PENDIENTE` vencidas y postea un aviso simple. Límite de
la API: 1 request/segundo por Space — a esta escala no es un problema, pero el envío
debe ser en serie, no en paralelo, si hay varios avisos en la misma corrida.

Responder/aprobar desde Chat requeriría una app de Chat completa — queda para Fase 9,
junto con la aprobación real.

## Modelo de datos propio (`DC-PLATAFORMA/backend/prisma/schema.prisma`)

Base nueva **`dc_plataforma`**, misma instancia Cloud SQL existente. Convenciones
heredadas de `dcsmart`: UUID v4, snake_case, `activo` en vez de hard-delete.

```prisma
model ExtUser {          // cache de users de dcsmart, poblado desde el ticket SSO
  id              String   @id            // mismo UUID que dcsmart.users.id
  email           String
  nombre          String
  id_departamento String?                 // sincronizado desde dcsmart.users.id_departamento
  activo          Boolean  @default(true)
  synced_at       DateTime @default(now())
  @@map("ext_users")
}

model ExtLocal {         // cache de locales de dcsmart, idem
  id         String   @id
  nombre     String
  grupo      String?              // nombre de la App/marca en dcsmart, informativo
  activo     Boolean  @default(true)
  synced_at  DateTime @default(now())
  @@map("ext_locales")
}

// Cache del catálogo Departamento de dcsmart + configuración propia de esta
// plataforma (Calendar/Group/Chat/kiosko) que no tiene sentido guardar en dcsmart.
model Departamento {
  id                 String   @id            // mismo id que dcsmart.departamentos.id
  nombre             String
  slug               String   @unique
  id_calendar_google String?  @unique      // calendarId, creado automáticamente al ver el depto por primera vez
  email_group_google String?  @unique      // "depto-<slug>@dcsmart.app"
  chat_webhook_url   String?               // secreto — nunca exponer en respuestas de API públicas
  kiosko_key         String?  @unique      // clave privada de acceso a la pantalla kiosko de este departamento
  activo             Boolean  @default(true)
  synced_at          DateTime @default(now())
  tareas             Tarea[]
  cumplimiento       CumplimientoDiario[]
  @@map("departamentos")
}

// --- Catálogo de tipos de tarea (tabla "TAREA → DEPARTAMENTO" del ejemplo) ---
model Tarea {
  id              String   @id @default(uuid())
  id_departamento String                   // fijo por tarea
  nombre          String   @unique         // "CCSS", "P&L", "CMV", "AUDITORIA"...
  descripcion     String?
  activa          Boolean  @default(true)
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
  departamento Departamento      @relation(fields: [id_departamento], references: [id])
  asignaciones TareaAsignacion[]
  @@index([id_departamento, activa])
  @@map("tareas")
}

// --- Puntero tarea×local hacia Google Calendar — no guarda recurrencia ni estado,
// eso vive 100% en el evento de Calendar. Solo existe para: (a) saber qué
// combinaciones (tarea,local) están planeadas aunque todavía no tengan agenda
// definida, y (b) resolver id_tarea/id_local_ext -> id de evento en Calendar. ---
model TareaAsignacion {
  id                String   @id @default(uuid())
  id_tarea          String
  id_local_ext      String?          // null = tarea de alcance EMPRESA (sin local específico)
  id_calendar_event String?          // id del evento maestro recurrente en Calendar; null = "fecha a asignar"
  activa            Boolean  @default(true)
  created_at        DateTime @default(now())
  updated_at        DateTime @updatedAt
  tarea Tarea     @relation(fields: [id_tarea], references: [id])
  local ExtLocal? @relation(fields: [id_local_ext], references: [id])
  @@unique([id_tarea, id_local_ext])
  @@index([id_local_ext])
  @@map("tarea_asignaciones")
}

model CumplimientoDiario {
  id                 String   @id @default(uuid())
  id_departamento    String
  id_local_ext       String?           // null = agregado a nivel departamento completo
  fecha              DateTime @db.Date
  total_tareas       Int
  realizadas         Int
  vencidas_sin_hacer Int
  created_at         DateTime @default(now())
  departamento Departamento @relation(fields: [id_departamento], references: [id])
  @@unique([id_departamento, id_local_ext, fecha])
  @@map("cumplimiento_diario")
}
```

Comparado con el diseño previo: desaparecen `TareaInstancia`, `TareaInstanciaEvento`,
`MaterializacionRun`, `RecurrenciaTipo`+JSON de recurrencia (todo eso lo tiene Calendar)
y también `SectorMiembro`/`RolSector`/`SectorMiembroLocal` (la membresía a departamento
y el rol de admin ahora se leen de `dcsmart`, no se administran acá). Se agrega
`CumplimientoDiario` (nuevo, por el pedido de seguimiento de cumplimiento) y
`Departamento` gana columnas de configuración propia de esta plataforma.

## Reconciliación y jobs periódicos

Un solo Cloud Scheduler + Cloud Run Job (`dc-plataforma-jobs`) con varias tareas:

1. **Cierre de recurrencia al desactivar un local**: `events.patch` agregando `UNTIL`
   a las `TareaAsignacion` de ese local (nunca `events.delete`, para no perder
   historial).
2. **Snapshot diario de cumplimiento** (ver sección de arriba) — corre una vez al día.
3. **Avisos de Chat** (tareas vencidas) — corre cada 1h.
4. **Sync masivo de `ExtUser`/`ExtLocal`** si más adelante se habilita un endpoint
   interno de solo lectura en `dcsmart` (no bloqueante — el sync oportunista en cada
   login ya cubre el caso principal).

## Integración con `dcsmart` (Fase final, agrupada — ver Roadmap)

Los dos únicos cambios en el repo `dcsmart`, hechos juntos al final, en una sola rama
`DEV-XX-tareas-departamento`, ambos aditivos:

1. `POST /api/auth/tareas-ticket` (calcado de `costos-ticket`,
   `backend/src/routes/auth.js:363-453`) — payload `{ email, nombre, id_departamento,
   departamento_slug, locales, ...(esGlobal ? { departamentos: [...] } : {}) }`.
2. Modelo `Departamento` (id, nombre, slug, activo) + columna nullable
   `User.id_departamento` en `schema.prisma`, con un selector de departamento agregado
   a la pantalla de Usuarios existente de `dcsmart` — **requiere `prisma db push`
   contra la base de producción compartida (no hay entorno de dev separado): revisar
   el SQL generado con `prisma migrate diff` y confirmar explícitamente con el usuario
   antes de aplicar**, siguiendo la regla ya documentada en `dcsmart_repo_infra_hazards`.

## Backend — rutas (`DC-PLATAFORMA/backend/src/routes/`)

```
auth.js         POST /sso · GET /me · POST /logout
departamentos.js GET / (lista cacheada, sync perezoso al recibir el ticket)
tareas.js       CRUD Tarea (catálogo — solo admin global, rol reusado de dcsmart)
asignaciones.js CRUD TareaAsignacion — crear/editar agenda llama a calendar.events.insert/patch (RRULE)
                 · POST /importar (bulk desde CSV/Excel)
instancias.js   GET /hoy · GET ?departamento&local&estado · POST /:instanceId/marcar
                 (endpoints /aprobar y /rechazar quedan en el código, sin exponer en la UI de v1)
reportes.js     GET /cumplimiento?departamento=&desde=&hasta=  (lee CumplimientoDiario)
tv.js           GET /resumen?departamento=&key=<clave del departamento> (kiosko)
plugins/gcal.js cliente de Google Calendar API (service account, scope calendar), con backoff exponencial
```

## Frontend de gestión (`DC-PLATAFORMA/frontend`, Vite+React+React Router+Zustand — mismo stack que dcsmart)

| Ruta | Quién | Contenido |
|---|---|---|
| `/sso` | pública | canjea el ticket, sin layout |
| `/` | cualquier usuario con departamento asignado | "Mi checklist de hoy": instancias de hoy de mi departamento, botón marcar realizada |
| `/reportes` | cualquier usuario de un departamento (su propio departamento) o admin global (todos) | % cumplimiento y pendientes, histórico via `CumplimientoDiario` |
| `/admin/tareas` | admin global (rol `super_admin`/`dcsmart` de dcsmart) | CRUD del catálogo de Tarea |
| `/admin/agenda` | admin global | **Vista matriz local×tarea** (igual al ejemplo del usuario): definir periodicidad/día por combinación, responsable opcional, filtro "sin agenda definida"; importar/exportar CSV-Excel |

Ya no hacen falta `/admin/sectores` ni `/admin/usuarios` — departamento y admin se
resuelven desde `dcsmart`.

## Pantallas kiosko (agenda por departamento, con clave privada)

**Cambio respecto al diseño previo**: no es una pantalla abierta/pública — cada
departamento tiene su propia clave de acceso (`Departamento.kiosko_key`), como barrera
de seguridad liviana. La URL de la pantalla de un departamento incluye su clave (ej.
`https://dc-plataforma-tv.web.app/?depto=tesoreria&key=<clave>`); el backend valida esa
clave contra `Departamento.kiosko_key` antes de responder `GET /api/tv/resumen` — así,
si se filtra la clave de un departamento, no compromete a los demás.

Se mantiene del diseño original:
- Librería de calendario open-source (ej. **FullCalendar**) reskinneada 100% con
  identidad visual DCSMART (fondo oscuro, dorado/teal, Montserrat — paleta de
  `dashboard-rendimiento-general`), no el iframe embed de Google.
- HTML dentro del mismo repo (`DC-PLATAFORMA/kiosko/`), no un repo aparte.
- Patrón de resiliencia: caché en `localStorage`, badge "Sin conexión", doble red de
  recarga (`setInterval` + `<meta http-equiv="refresh">`).
- Polling cada 2 min, backoff a 30s si falla.

## Infraestructura y deploy

| Recurso | Valor |
|---|---|
| Repo | `DC-PLATAFORMA` (nuevo; la carpeta vacía `PANTALLAS OFICINA` creada el mismo día no se usa como repo — confirmar con el usuario si era para esto) |
| Cloud Run backend | `dc-plataforma-api`, `us-central1`, proyecto `dc-smart-mvp` |
| Service account (Calendar) | `dc-plataforma-api@dc-smart-mvp.iam...`, roles GCP mínimos: `cloudsql.client` + `secretmanager.secretAccessor`; scope `https://www.googleapis.com/auth/calendar`, dueño de los calendarios que crea — no requiere domain-wide delegation |
| Service account (Groups) | mismo o dedicado, **con domain-wide delegation** sobre `dcsmart.app` — requiere autorización explícita del super-admin de Workspace antes de esa fase |
| Base de datos | nueva base lógica `dc_plataforma` en la instancia **existente** `dc-smart-mvp:us-central1:dcsmart-mvp-insta`, rol Postgres dedicado `dc_plataforma_app` |
| Firebase Hosting | 2 sites nuevos: `dc-plataforma` (gestión) y `dc-plataforma-tv` (kiosko) |
| Secretos nuevos | `dc-plataforma-database-url`, `dc-plataforma-jwt-secret`; credencial del service account de Calendar/Groups (preferir Workload Identity) |
| Secreto reusado | `internal-shared-secret` (ya existe) |
| Cambio en repo `dcsmart` | Fase final agrupada — ver "Integración con dcsmart" |
| Config manual única vez | Admin Console de Workspace: (a) domain-wide delegation para Groups, (b) permiso de webhooks de Chat |
| Cloud Scheduler | `dc-plataforma-jobs` — reconciliación (6h), snapshot de cumplimiento (diario), avisos de Chat (1h) |
| CI/CD | arrancar manual (`infra/*.sh`, patrón `dcsmart-auditoria`) — graduar a GitHub Actions antes de rollout general |

## Roadmap por fases

Ordenado para que **todo lo que toca `dcsmart` quede en una sola fase final** (Fase 8)
— las fases 0 a 7 son 100% independientes de `dcsmart`, usando el login temporal.

0. **Crear el repo `DC-PLATAFORMA` en GitHub** (privado), estructura inicial
   (`backend/`, `frontend/`, `kiosko/`, `.gitignore`, `README.md`).
1. **Spike de validación técnica de Calendar (1-2 días)**: crear una serie recurrente
   de prueba, listar instancias, parchear `extendedProperties`+`description` en una
   sola instancia, confirmar que el resto no se afecta, y confirmar el comportamiento
   de editar el `recurrence` del maestro con instancias futuras ya generadas.
2. **Infra base propia**: DB `dc_plataforma` + rol Postgres, service account (scope
   Calendar), login temporal de desarrollo, catálogo de departamentos sembrado a mano.
3. **Backend core**: Departamento (config)/Tarea/TareaAsignacion + integración con
   Calendar (`plugins/gcal.js`) + check de "marcar realizada" + snapshot diario de
   cumplimiento.
4. **Carga inicial**: importación masiva de la matriz local×tarea desde
   `DCSMART ESTRUCTURA.xlsx`.
5. **Frontend de gestión**: checklist diario, reportes de cumplimiento, vista matriz
   de administración de agenda — probado end-to-end con el login temporal.
6. **Pantallas kiosko** con FullCalendar estilo DCSMART, clave privada por
   departamento.
7. **Google Groups + Chat**: requiere primero habilitar domain-wide delegation en el
   Admin Console — sync de Group por departamento, ACL `reader`, avisos de Chat.
8. **Integración con `dcsmart` — al final, único punto de contacto con producción**:
   rama `DEV-XX-tareas-departamento`, agrega el endpoint `tareas-ticket` + el modelo
   `Departamento`/columna `User.id_departamento` + selector en la pantalla de Usuarios
   existente + ítem de Sidebar. PR revisado a `dev`, `prisma migrate diff` revisado
   antes de cualquier `db push`, confirmación explícita antes de aplicar. Reemplaza el
   login temporal de la Fase 2 por el ticket real.
9. **Futuro, no bloqueante**: activar aprobación real (doble check, cola de
   aprobación — el estado `APROBADA` ya está reservado en el diseño para esto), Chat
   bidireccional, evidencia/foto al marcar realizada, variante "día hábil" de
   recurrencia, integración con automatizaciones n8n existentes.

## Decisiones abiertas (no bloquean el arranque)

- Umbral horario exacto para considerar una tarea "vencida" (¿varía por departamento?).
- Confirmar si la carpeta vacía `PANTALLAS OFICINA` era un placeholder para este
  proyecto o para otra cosa.
- Mecanismo exacto del login temporal de desarrollo de la Fase 2 — detalle menor, no
  bloquea nada más.
- Formato exacto de la plantilla de importación masiva y qué pasa con valores no
  parseables ("fecha a asignar") al importar.
- ¿Quién es super-admin de Workspace en DCSMART y puede autorizar la domain-wide
  delegation para Groups? Bloquea el arranque de la Fase 7, no de las anteriores.
- Confirmar que la organización de Workspace permite agregar webhooks de Chat.
- Cuándo activar la aprobación real (Fase 9) — no es parte de este plan todavía, el
  usuario decidirá cuándo tiene sentido prenderla.

## Verificación

- **Spike de Fase 1**: confirmar en un calendario de prueba real que parchear una
  instancia no afecta al resto de la serie, y que editar el RRULE del maestro
  re-expande solo las instancias futuras sin tocar las ya modificadas.
- Backend: tests con `node --test` mockeando el cliente de Calendar, sobre: creación de
  evento recurrente desde una `TareaAsignacion`, parseo de `privateExtendedProperty`
  para armar "pendientes"/"vencidas", cierre de recurrencia al desactivar un local, y
  cálculo del snapshot diario de `CumplimientoDiario`.
- Integración con dcsmart (al final): probar el flujo completo `tareas-ticket` →
  `/sso` → `/me` con un usuario `super_admin` real, y confirmar que el campo
  `departamento` recién agregado no rompe `GET /api/auth/my-apps` (advertencia
  documentada en el propio `CLAUDE.md` de dcsmart sobre columnas nuevas en modelos
  existentes).
- Frontend: correr la app y el kiosko, marcar una tarea como realizada, confirmar que
  el semáforo del kiosko cambia dentro del intervalo de polling (2 min), y que el
  reporte de `/reportes` refleja el snapshot del día siguiente.
- Cortar la red mientras el kiosko está abierto y confirmar que muestra "Sin conexión"
  con datos cacheados, recuperándose solo al reconectar.
- Probar el acceso al kiosko con la clave de un departamento distinto y confirmar que
  no se puede ver la agenda de otro departamento.
