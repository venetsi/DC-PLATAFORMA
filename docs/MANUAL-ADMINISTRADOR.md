# Manual del administrador — DC-PLATAFORMA

Guía técnica de las operaciones de back-office que solo hace un administrador:
entrar, dar de alta departamentos, cargar el catálogo de tareas y su agenda,
administrar repositorios de documentos, y las dos o tres cosas que hoy **no
tienen pantalla** y hay que hacer por API directa.

> **Cómo se relaciona con los otros dos documentos del proyecto:**
> - [`MANUAL-DE-USO.md`](./MANUAL-DE-USO.md) — el día a día de cualquier
>   usuario (marcar tareas, Mis tareas, comandos de Chat). Este manual no lo
>   repite; asume que ya lo leíste.
> - [`CONFIGURAR-CHAT-APP.md`](./CONFIGURAR-CHAT-APP.md) — la puesta a punto
>   *una sola vez* de la Chat App en la consola de Google Cloud (APIs, Spaces,
>   credenciales). Esto de acá es lo que se hace *todos los días o todas las
>   semanas* ya con todo configurado.
>
> Verificado contra el código real el **2026-09-21** (incluye confirmación
> por `git log` de que el archivo de comandos de Chat no cambió desde el
> 2026-09-19, misma fecha que `CONFIGURAR-CHAT-APP.md`).

---

## 1. Cómo entrar como administrador

| | |
|---|---|
| **Plataforma (frontend)** | `https://dc-plataforma.web.app` |
| **API (backend)** | `https://dc-plataforma-api-288069746644.us-central1.run.app` — normalmente no se llama directo, el frontend pasa por `/api/**` del mismo dominio |

Hoy conviven dos formas de entrar. Ninguna pide contraseña — el "login" es
solo resolver **quién sos** y con qué permisos.

### A. Entrada real: desde dcsmart (SSO)

1. Desde el sistema principal de dcsmart, click en **"Tareas"** en el menú
   lateral. Abre `https://dc-plataforma.web.app/sso?ticket=<jwt>` en una
   pestaña nueva.
2. Ese `ticket` es de un solo uso y expira en ~60 segundos — no se puede
   copiar y reusar. La pantalla `/sso` lo canjea automáticamente por tu
   sesión en DC-PLATAFORMA.
3. En ese intercambio la plataforma recibe tu email, tu nombre, tu
   departamento (texto libre de dcsmart), **si sos super admin de dcsmart**, y
   el catálogo completo de locales — y sincroniza todo eso en su propia base
   en el momento (ver [§3](#3-cómo-se-crean-los-departamentos)).

### B. Login temporal por email (todavía activo, va a desaparecer)

`https://dc-plataforma.web.app/login` — escribís tu email, sin contraseña.
El propio código lo marca como *"Login temporal de desarrollo (Fase 2-6)"*:
existe mientras no está terminada la integración con dcsmart y se va a
reemplazar por el SSO real de arriba. Dos condiciones para que funcione,
ambas variables de entorno del backend:

- `ALLOW_DEV_LOGIN=true` (si no, la ruta responde 404).
- El email tiene que estar en `DEV_LOGIN_ALLOWLIST` **y** ya existir como
  usuario en la base (no crea usuarios nuevos).

No pide crear el departamento ni nada — si el usuario ya está sembrado,
entra directo con los permisos que ya tenga cargados.

### Cómo se decide si sos administrador

No hay pantalla de roles ni tabla de permisos propia en DC-PLATAFORMA. Todo
se resuelve con una sola función, `esAdminGlobal(usuario)`:

```js
return !!usuario?.es_admin_global || usuario?.email === 'admin@dcsmart.app'
```

- **`es_admin_global`** es una columna que **solo se escribe en un lugar**:
  al canjear el ticket SSO, copiando literalmente el `es_super_admin` que
  trajo el ticket de dcsmart. **DC-PLATAFORMA no decide esto por sí mismo.**
- El segundo camino (`admin@dcsmart.app`) es un atajo del código que hoy
  funciona aunque el login temporal esté apagado. Es un riesgo de seguridad
  y se va a quitar antes de producción completa: no lo uses.

**Para hacer a alguien administrador global, hoy la operación se hace en
dcsmart** (marcarlo `super_admin`/`dcsmart` en la pantalla de Usuarios de
*ese* sistema) — el cambio llega a DC-PLATAFORMA recién la próxima vez que
esa persona entra por `/sso`. No existe ningún botón ni endpoint en
DC-PLATAFORMA para promoverlo desde acá; la única alternativa es un
`UPDATE` manual por SQL directo contra Postgres, y es la base compartida con
producción — usarlo solo si de verdad no se puede esperar al próximo login
SSO de esa persona.

**"Admin de departamento" no es un rol que exista** — es simplemente
*tener un departamento asignado* (`id_departamento` no nulo). Con eso alcanza
para entrar a **Tareas** y gestionar el catálogo de tu propio departamento;
no te da nada más. La tabla siguiente es la que manda en la práctica:

| | Admin global | Usuario con departamento | Usuario sin departamento |
|---|---|---|---|
| Ver Calendario / Mis tareas / Reportes | ✅ | ✅ (lo propio) | Pantalla "Sin asignación" |
| Entrar a **Tareas** (`/admin/tareas`) | ✅, cualquier departamento | ✅, solo el propio | ❌ |
| Crear departamentos | ✅ | ❌ | ❌ |
| Desactivar / eliminar tareas | ✅ | ❌ (solo crear/editar las propias) | ❌ |
| Entrar a **Documentos** (`/admin/repositorios`) | ✅ | ❌ | ❌ |
| Comando `/departamentos` en Chat | ✅ | ❌ | ❌ |

---

## 2. Llamar a la API directamente (curl)

Hace falta para un par de operaciones que **no tienen pantalla** (ver
§3 y el apéndice). El token de tu propia sesión funciona tal cual como
Bearer — es el mismo JWT que devuelve el login, sin transformarlo.

**Opción 1 — sesión ya abierta en el navegador (sirve en cualquier
entorno):** F12 → pestaña Aplicación/Almacenamiento → Local Storage →
`dc-plataforma.web.app` → copiá el valor del token guardado ahí (es el mismo
que el frontend manda como `Authorization: Bearer <token>` en cada request).

**No uses el login temporal por email para conseguir el token.** Se va a
apagar en producción porque no pide contraseña. Usá siempre la Opción 1.

Con el token en mano, cualquier llamada se hace así:

```bash
curl -X POST https://dc-plataforma.web.app/api/departamentos \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Marketing"}'
```

> La cookie de sesión (`dc_plataforma_token`) que también se setea al
> loguearte **no sirve para curl en producción** — el rewrite de Firebase
> Hosting hacia Cloud Run no reenvía el header `Cookie`, solo `Authorization`.

---

## 3. Cómo se crean los departamentos

Tres caminos, y valen los tres a la vez:

**a) Solos, la primera vez que alguien de ese equipo entra por SSO real.**
El texto libre `departamento` que trae el ticket de dcsmart se convierte en
slug; si no existe un `Departamento` con ese slug, se crea automáticamente
con Calendar, Group y clave de kiosko reales (ver abajo). No hace falta que
un admin lo dé de alta antes.

**b) A mano, desde la card "Crear departamento"** arriba del todo en
**Tareas** (`/admin/tareas`) — solo la ve un admin global. Un input con el
nombre y botón **Crear**. Sirve para precrear un departamento antes de que
nadie de ese equipo haya entrado todavía.

**c) Por API directa**, `POST /api/departamentos { "nombre": "..." }` (ver
§2) — es literalmente lo que dispara el botón de (b); usalo si preferís
scriptearlo o si estás automatizando una carga inicial.

En los tres casos, dar de alta un departamento **no es un simple INSERT**:
dispara integraciones reales contra Google Workspace —

1. Si no tiene `id_calendar_google`: crea un Calendar nuevo (`DC-PLATAFORMA —
   <nombre>`) y, en el mismo paso, genera la `kiosko_key` (32 caracteres
   hex, al azar).
2. Si no tiene `email_group_google`: crea el Google Group (tolera que ya
   exista) y le da acceso de lectura al Calendar del paso 1.

Es **idempotente y retomable**: si el paso 2 falla (Directory caído, etc.),
el departamento queda persistido con Calendar y `kiosko_key` ya armados pero
sin Group — la próxima vez que se llame a esta misma función para ese slug,
solo reintenta lo que falta.

### Campos de un departamento

| Campo | Qué es |
|---|---|
| `nombre`, `slug` | el slug se genera solo (minúsculas, sin acentos ni símbolos) |
| `id_calendar_google` | Calendar dedicado del departamento |
| `email_group_google` | Group con acceso de lectura a ese Calendar |
| `kiosko_key` | clave de acceso a la pantalla de oficina — **ver la advertencia de abajo** |
| `chat_webhook_url` | webhook de Chat (mecanismo viejo, reemplazado por `chat_space_name` si hay Space vinculado) |
| `chat_space_name` | se completa solo al agregar la app a un Space, **no se carga a mano** — ver `/vincular` en `MANUAL-DE-USO.md` |
| `dias_aviso_departamento` / `dias_aviso_direccion` | umbrales de escalamiento; `null` = usa el default global |
| `activo` | soft-delete |

### ⚠️ Guardá la `kiosko_key` en el momento de crear el departamento

**No hay ninguna pantalla que la vuelva a mostrar después.** El único
momento en que viaja por la API es en la respuesta del `POST
/api/departamentos` que lo crea — el `GET` normal la excluye a propósito por
ser un secreto. Si la perdiste, la única forma de recuperarla es una consulta
directa a Postgres:

```sql
SELECT slug, kiosko_key FROM "Departamento" WHERE slug = 'finanzas';
```

Con eso armás el link del kiosko (ver §6).

### Configurar avisos de un departamento

Desde la card **"Avisos por departamento"**, arriba del catálogo en
**Tareas** (`/admin/tareas`, solo admin global): una fila por departamento
con el webhook de Chat (el campo siempre arranca vacío y es *write-only* —
dejarlo en blanco significa "no lo toques"; hay un botón **"Quitar
webhook"** aparte para borrarlo a propósito) y los dos umbrales de
escalamiento, con un botón **Guardar** por fila.

Por API es el mismo endpoint que usa esa pantalla, útil para scriptear una
carga inicial:

```bash
curl -X PATCH https://dc-plataforma.web.app/api/departamentos/<id>/notificaciones \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"dias_aviso_departamento": 2, "dias_aviso_direccion": 5}'
```

`chat_webhook_url` se valida a que el host sea exactamente
`chat.googleapis.com` — cualquier otra cosa devuelve 400. En la práctica, si
el departamento ya tiene un Space vinculado (`/vincular` desde Chat), **ese
gana** y el webhook queda solo como rollback.

---

## 4. Catálogo de tareas y agenda — pantalla Tareas (`/admin/tareas`)

Entra cualquier admin global, o cualquier usuario con departamento propio
(acotado a gestionar solo el suyo). **Es una sola pantalla** — la vieja
`/admin/agenda` separada ya no existe: la agenda de una tarea se abre
*inline*, en el mismo renglón de la tabla, con el botón **"Definir
agenda"** (pasa a decir **"Cerrar agenda"** mientras está abierto). Solo un
panel de agenda puede estar abierto a la vez.

### Crear una tarea (el tipo, no todavía cuándo pasa)

Formulario de dos campos, nada más:

1. Texto, placeholder **"Nombre (ej. CMV)"**.
2. Si sos admin global: select **"Departamento..."** (elegís cualquiera). Si
   sos de un departamento: no hay select, queda fijo el tuyo.
3. Botón **Crear**.

El catálogo se muestra agrupado por departamento, y debajo de cada tarea ya
se ve a qué locales/grupos está asignada, sin tener que abrir la agenda.

### Definir la agenda de una asignación

Dentro del panel "Definir agenda":

1. **Agregar asignación** — elegís el alcance:
   - **Toda la empresa** (default, sin local).
   - **Por grupo** — crea una asignación por cada local activo del grupo.
   - **Local específico**.
2. **Compartir con otros departamentos** (checkbox por cada uno, aparece
   solo si hay más de uno): un solo evento de Calendar, visible para todos
   los tildados. Se marca **antes** de darle a Agregar — no es una acción
   aparte.
3. Ya creada la asignación, aparece su card con la recurrencia:
   - **Diaria** / **Semanal** (checkboxes Lun a Dom) / **Cada N meses**
     (intervalo + día del mes) / **Una vez** (fecha puntual).
   - **Desde** (vigencia).
   - **Responsable** — select opcional, default "Sin responsable fijo".
     Si el responsable cargado ya no pertenece al departamento, se sigue
     mostrando con la etiqueta *"(fuera del depto.)"* en vez de perderse.
   - Botón **Agendar** (o **Actualizar** si ya tenía evento de Calendar).
   - Aviso fijo: *"Se agenda por 12 meses y se renueva automáticamente
     mientras la tarea siga activa."*

Badge de estado de cada asignación: verde **"Agendada"**, amarillo **"Sin
agenda definida"**.

### Dependencias ("espera a")

Debajo de cada asignación, botón **"+ Depende de otra tarea"** abre tres
selects en cascada: **Departamento** → **Tarea** (de ese departamento) →
**Local** (en realidad la asignación puntual del prerrequisito). Botón
**Agregar**; queda listado en **"Espera a:"** con una `×` para sacarlo.

- El sistema rechaza ciclos (409, si A ya depende de B no podés hacer que B
  dependa de A) y auto-dependencia (400).
- **Avisa, no bloquea**: se puede marcar la tarea igual aunque el
  prerrequisito no esté hecho — solo queda anotado el aviso.

### Desactivar y eliminar (solo admin global)

- **Desactivar** — soft-delete, cierra la agenda hacia adelante en Calendar
  sin borrar historial. Pide confirmación.
- **Eliminar definitivamente** — solo disponible sobre tareas ya
  desactivadas. Pide escribir literalmente `ELIMINAR` en el prompt de
  confirmación. Borra en cascada: eventos de Calendar (propios y
  compartidos), asignaciones, dependencias en los dos sentidos, y la tarea.
  **No se puede deshacer.**

---

## 5. Repositorios de documentos y `/buscar` (Gemini) — pantalla Documentos (`/admin/repositorios`)

Solo admin global. Acá se cargan los documentos que `/buscar` usa para
responder preguntas en Chat — ver el detalle de uso desde Chat en
`MANUAL-DE-USO.md`. Resumen operativo para quien administra:

- Un **Repositorio** tiene nombre propio y se asigna a **cero, uno o varios
  departamentos** a la vez (así dos equipos pueden compartir la misma
  fuente) — sin ninguno asignado, es general y lo ve cualquier Space.
- **Documentos sueltos** (`MANUAL`): subís un archivo (`.txt`, `.md`,
  `.pdf`) o pegás una URL, uno por uno. La indexación en Gemini es
  asincrónica — un documento recién subido queda **"Indexando…"** un rato
  antes de estar disponible para `/buscar`.
- **Carpeta de Google Drive** (`DRIVE_FOLDER`): pegás el link de la carpeta;
  el botón **"Resincronizar"** importa todo lo de adentro (Docs, Sheets,
  Slides, y sueltos `.txt`/`.md`/`.pdf`). **No es automático** — hay que
  volver a apretarlo para traer archivos nuevos. No baja subcarpetas, y de
  un Sheet solo lee la primera hoja.
- `/buscar` responde **solo** con lo que esté en esos documentos —
  system prompt con guardrails explícitos: nunca completa con conocimiento
  general, nunca inventa, y un texto de "no encontré esa información" fijo
  en el código (no lo redacta el modelo) para que ese caso puntual nunca
  varíe ni alucine. Resiste instrucciones que alguien intente colar dentro
  de la pregunta misma.

---

## 6. Pantalla de oficina — kiosko (sin login)

HTML estático, pensado para quedar fijo en una TV/monitor, se actualiza
solo cada 2 minutos (con reintento a los 30s si falla, y una recarga
completa de página forzada cada hora como red de seguridad).

**Formato exacto del link:**

```
https://dc-plataforma-tv.web.app/?depto=<slug>&key=<kiosko_key>
```

- `depto` es el **slug** del departamento (no el id).
- `key` es la `kiosko_key` de ese departamento — ver §3 sobre dónde
  conseguirla (solo aparece una vez, al crear el departamento).

Sin esos dos parámetros, la pantalla muestra directamente *"Falta ?depto= y
?key= en la URL"*, sin llamar a nada.

Qué muestra: semáforo del día (🔴 hay vencidas / 🟡 hay pendientes sin
vencer / 🟢 todo al día, calculado solo con las tareas de **hoy**),
contadores de pendientes/realizadas/vencidas, columna de atrasadas (hasta 30
días), la semana actual agrupada por local, un adelanto de la semana
siguiente, clima, y reloj en vivo. Si se corta la conexión sigue mostrando
el último dato cacheado con aviso de "sin conexión".

---

## 7. Reportes de cumplimiento

Ruta `/reportes` — ojo, **no está restringida a admin**: cualquier usuario
logueado con departamento entra y ve el suyo. La diferencia es:

- **Admin global**: ve una grilla con **los 11 departamentos** a la vez;
  click en una tarjeta despliega debajo la tabla día por día de ese
  departamento.
- **Resto**: ve directo el suyo, sin poder elegir otro (el backend lo
  fuerza aunque alguien manipule la URL — 403 si pide otro departamento).

El número se calcula por un job diario contra una tabla de snapshots (no
recalcula en vivo contra Calendar como sí hace el kiosko) — el día de hoy
recién aparece completo al día siguiente.

**Filtros**: tanto en la vista propia como en el detalle expandido de un
admin hay un select de **local** y campos **Desde**/**Hasta** arriba de la
tabla — se puede acotar a un local puntual, a un rango de fechas, o
ambos a la vez. Sin nada elegido, muestra el departamento completo en el
período por defecto, igual que antes.

---

## 8. Comandos de Google Chat — referencia completa

Verificado exacto contra el código de hoy (sin cambios desde el
2026-09-19). El detalle de uso de cada uno está en `MANUAL-DE-USO.md`; esta
es la tabla de referencia rápida para quien administra:

| Comando | Alias | Tipo | Qué hace |
|---|---|---|---|
| `/hoy` | `/tareas` | rápido | Tareas que vencen hoy |
| `/atrasadas` | `/vencidas` | rápido | Lo que quedó sin hacer |
| `/mias` | | rápido | Las tuyas + las del equipo sin responsable |
| `/ayuda` | `/help` | rápido | Lista de comandos |
| `/resumen` | `/estado` | rápido | Pendientes, atrasadas y % de cumplimiento |
| `/equipo` | | rápido | Quién tiene qué y cuánto atraso |
| `/departamentos` | | rápido, **solo admin** | Panorama de los 11 — ver abajo |
| `/vincular` | | barra + diálogo, **solo admin** | Checkbox de qué depto(s) cubre este Space |
| `/desvincular` | | barra | Deja de cubrir departamentos en este Space |
| `/marcar` | `/hecha` | barra | Da una tarea por hecha |
| `/tomar` | | barra | La pone a tu nombre |
| `/pasar` | | barra | Se la pasa a otra persona |
| `/nota` | `/comentar` | barra | Deja un comentario en el historial |
| `/tarea` | `/detalle` | barra | Estado, responsable, dependencias e historial |
| `/local` | `/grupo` | barra | Tareas de un local o de un grupo |
| `/asignar` | | barra + diálogo | `/tomar` con formulario |
| `/derivar` | | barra + diálogo | `/pasar` con formulario |
| `/apuntar` | | barra + diálogo | `/nota` con formulario |
| `/tildar` | | barra + diálogo | `/marcar` de varias a la vez, con checkbox |
| `/pago` | | barra + diálogo | Vincula un pago de dcsmart a tarea y/o persona |
| `/mispagos` | | barra | Tus pagos con seguimiento pendiente |
| `/tildarpagos` | | barra + diálogo | Marca varios pagos como resueltos |
| `/buscar` | | barra | Pregunta libre, respondida por Gemini (§5) |

### `/departamentos` — el único comando admin que no aparece en `/ayuda`

Vale la pena que lo conozcas porque nadie se entera de que existe salvo que
alguien se lo diga: es un panel de **auditoría de configuración**, no de
tareas. Por cada departamento activo imprime una línea con:

```
• Finanzas (`finanzas`) — 12 tareas · 💬 Space · umbrales 2/def ⚠️ sin calendario
```

- **Destino del aviso**: 💬 Space / 🔗 webhook / — sin avisos.
- **Umbrales** propios si difieren del default global.
- **⚠️ sin calendario** si al departamento le falta `id_calendar_google`.
- **👁️ ve todo** en la fila de Dirección.
- **🤝 compartido con...** si ese Space también cubre otros departamentos.

Al pie, si hay departamentos sin Space ni webhook, avisa cuántos quedan
"huérfanos" de recordatorio diario (sus tareas atrasadas igual escalan a
Dirección, pero no reciben su propio aviso).

Para vincular un Space a uno o varios departamentos, o para el "modo todo"
de Dirección, ver la sección correspondiente de `MANUAL-DE-USO.md` — no se
repite acá.

---

## 9. Jobs automáticos

| Job | Qué hace | Frecuencia (según el propio código) |
|---|---|---|
| `avisosChat.js` | Recordatorio diario por departamento + escalamiento a Dirección | Diario, 8am |
| `reconciliar.js` | Renueva recurrencias por vencer, cierra las que corresponda | Cada 6 horas |
| `snapshotCumplimiento.js` | Escribe el snapshot que lee `/reportes` | Diario |

> La configuración real de horarios vive en Cloud Scheduler (consola de
> GCP), no en este repo — si necesitás confirmar el horario exacto vigente,
> verificalo ahí; el comentario del código documenta la intención original,
> no necesariamente la config viva.

**Correrlos a mano** (desde `backend/`):

```bash
npm run job:avisos
npm run job:reconciliar
npm run job:snapshot            # usa el día de ayer (hora argentina)
npm run job:snapshot 2026-09-15 # o una fecha puntual
```

**Variables de entorno relevantes:**

| Variable | Efecto | Default |
|---|---|---|
| `AVISO_DRY_RUN=1` | Arma y loguea los mensajes sin postear nada a Chat | envía en serio |
| `AVISO_SLUG_DIRECCION` | Slug del departamento tratado como "Dirección" (modo todo + escalamiento nivel 2) | `direccion` |
| `AVISO_DIAS_DEPARTAMENTO` | Umbral (días hábiles) del aviso propio — la columna del depto tiene prioridad sobre esto | `2` |
| `AVISO_DIAS_DIRECCION` | Umbral de escalamiento a Dirección — se clampea a `departamento+1` si queda igual o menor | `5` |
| `FRONTEND_URL` | Link a la plataforma dentro de la card de Chat | usa https://dc-plataforma.web.app |

---

## Apéndice — operaciones que hoy solo se hacen por API o SQL directo (sin pantalla)

Webhook/umbrales y los filtros de Reportes ya tienen pantalla (§3 y §7) —
quedan dos que deliberadamente no la tienen:

| Operación | Por qué no tiene pantalla | Cómo se hace |
|---|---|---|
| Ver la `kiosko_key` de un departamento ya creado | Se excluye a propósito de cualquier `GET` (es secreto) | Guardarla al crear el depto, o `SELECT` directo a Postgres (§3) |
| Promover a alguien a admin global | Es un rol de dcsmart, no de esta app | Marcarlo `super_admin` en dcsmart (efecto en el próximo login SSO), o `UPDATE` SQL directo si no puede esperar |
