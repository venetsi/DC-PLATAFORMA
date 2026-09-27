# Manual del administrador — DC-PLATAFORMA

Guía de las operaciones de back-office: quién entra y con qué permisos,
departamentos y avisos, tareas y agendas, el tablero de cumplimiento,
repositorios de documentos, y lo poco que todavía no tiene pantalla.

> **Cómo se relaciona con los otros dos documentos del proyecto:**
> - [`MANUAL-DE-USO.md`](./MANUAL-DE-USO.md) — el día a día de cualquier
>   usuario (marcar tareas, Mis tareas, comandos de Chat). Este manual no lo
>   repite; asume que ya lo leíste.
> - [`CONFIGURAR-CHAT-APP.md`](./CONFIGURAR-CHAT-APP.md) — la puesta a punto
>   *una sola vez* de la Chat App en la consola de Google Cloud.
>
> Verificado contra el código y la configuración de producción el **2026-09-27**.

---

## 1. Quién entra y con qué permisos

| | |
|---|---|
| **Plataforma** | `https://dc-plataforma.dcsmart.app` (la vieja `dc-plataforma.web.app` redirige ahí, conservando ruta y `?ticket=`) |
| **Kiosko (TV)** | `https://tv.dcsmart.app` (también responden `dc-plataforma-tv.dcsmart.app` y `dc-plataforma-tv.web.app`, sin redirigir: cada TV guarda su conexión en el dominio donde se conectó): muestra un QR para conectarla (§7) |
| **API** | `https://dc-plataforma-api-288069746644.us-central1.run.app` — el frontend la usa a través de `/api/**` del mismo dominio |

### Cómo se entra

**Única entrada: desde dcsmart.** En el sistema principal, botón **"Tareas"**
del menú lateral. Abre `/sso?ticket=<jwt>` en una pestaña nueva; el ticket es
de un solo uso, vence en ~60 segundos y la pantalla lo canjea sola por una
sesión de DC-PLATAFORMA. Todos pasan por la validación de dcsmart.

- El login por email sin contraseña (`/login` con formulario) **está apagado
  en producción** (`ALLOW_DEV_LOGIN=false`, la ruta responde 404). Solo
  existe en una máquina de desarrollo.
- "Entrar con Google" está programado pero **en pausa por decisión**: sin
  `VITE_GOOGLE_CLIENT_ID` el botón no aparece.
- Si una sesión queda vieja (por ejemplo, la cuenta se desactivó), la
  plataforma la corta en el acto y pide volver a entrar por Tareas.

### Los departamentos de cada persona salen de Google Groups

Desde el **2026-09-27** (`MEMBRESIA_FUENTE=groups` en Cloud Run) el
departamento de cada persona **no** sale de dcsmart: sale de los grupos
**`depto-<slug>@dcsmart.app`** de Google Workspace.

- Una persona puede estar en **varios** grupos: ve y gestiona todos esos
  departamentos (en Mi agenda elige cuál mirar).
- **Quien no está en ningún grupo `depto-*` no entra** por el botón Tareas:
  ve *"Tu cuenta no está en ningún grupo de departamento. Pedí que te
  agreguen al grupo depto-<área>@dcsmart.app"*. Excepción: los
  administradores (ver abajo).
- **Para dar o quitar acceso, se agrega o se saca a la persona del grupo**
  en Google Workspace (Grupos o consola de admin). No hay nada que tocar en
  DC-PLATAFORMA.
- La plataforma relee los grupos sola cada ~15 minutos. Para que un cambio
  rija ya: **Agendas → Departamentos y avisos → "Releer Google Groups"**.
- Quien está en un grupo y nunca entró igual tiene usuario (se crea al leer
  los grupos): puede aparecer como responsable y usar Chat desde el día uno.
- **Freno de seguridad**: si un grupo pierde de golpe más de la mitad de sus
  miembros, ese cambio no se aplica (suele ser un error de carga). Queda
  marcado en rojo en "Departamentos y avisos"; para aplicarlo igual, llamar
  `POST /api/departamentos/membresias/sincronizar?forzar=true` (§2).

### Cuentas renombradas (el email viejo quedó como alias)

En Workspace se renombraron cuentas: el email principal cambió y el viejo
quedó como **alias**. Por ejemplo, `reportes@dcsmart.app` hoy es
`jbardinella@dcsmart.app`. Los grupos y Chat usan el email **principal**,
pero dcsmart todavía puede mandar el viejo en el ticket.

- Al entrar por Tareas, la plataforma **traduce el alias al email
  principal** (consultando los grupos `depto-*`) y la persona entra con su
  cuenta nueva, con sus departamentos.
- Detectadas el 2026-09-27: maximiliano@venetsi.com → mmartinez@venetsi.com,
  calderon@dcmanagement.com.ar → dcalderon@, admin@ → eguzman@, analisis@ →
  ggonzalez@, auditoria@ → gmalachane@, estudio@ → jherrera@, operaciones@ →
  gescobar@, reportes@ → jbardinella@, rrhh@dcsmart.app →
  acorra@dcmanagement.com.ar, tesoreria@ → nmeza@ (todas `@dcsmart.app` salvo
  donde se indica).
- Para unificar las filas viejas con las nuevas (pasar admin, id de Chat y
  responsables, y desactivar la vieja), desde `backend/`:
  `node scripts/unificar-cuentas-renombradas.mjs` (muestra lo que haría) y
  después con `--aplicar`. El historial de tareas hechas conserva el email con
  que se marcó.
- **Recomendado**: actualizar esos emails también en los usuarios de dcsmart,
  para que el ticket ya llegue con el email principal.

### Permisos: el rol en el Google Group

Cada persona tiene, en cada departamento, el **rol que tiene en su grupo**
`depto-<slug>@` (MEMBER, MANAGER u OWNER). Se cambia en Google Groups o en la
consola de admin y rige en unos 15 minutos. Decidido el 27/09/2026:

| Acción (en ese departamento) | MEMBER | MANAGER | OWNER |
|---|---|---|---|
| Ver agendas y tareas (Mi agenda, Mis tareas, Agendas, Chat) | ✅ | ✅ | ✅ |
| Marcar hecha / No aplica; en Chat `/marcar`, `/tildar`, `/tomar`, `/nota` | ✅ | ✅ | ✅ |
| Crear y editar tareas, cambiar agenda y responsable, duplicar | ❌ | ✅ | ✅ |
| Mover una tarea de día (arrastrar o Cambiar fecha) | ❌ | ✅ | ✅ |
| Pasar una tarea a otra persona (`/pasar`, `/derivar`) | ❌ | ✅ | ✅ |
| Ver Reportes | ❌ | ✅ | ✅ |
| Desactivar y eliminar tareas | ❌ | ❌ | ✅ |
| Avisos del departamento (webhook, umbrales) | ❌ | ❌ | ✅ |

**Dirección y super admin, sin restricción**:

```js
esAdminGlobal(usuario) = usuario.es_admin_global || usuario.esDireccion
```

- Quien está en `depto-direccion@dcsmart.app`, **con cualquier rol**, cuenta como
  OWNER en todos los departamentos. Para hacer administrador a alguien, se lo
  agrega a ese grupo.
- `es_admin_global` es el acceso de emergencia: se copia en cada entrada por
  Tareas del `super_admin` de dcsmart. Entra aunque no esté en ningún grupo.
- Solo Dirección / super admin: crear departamentos, **Releer Google Groups**,
  **Documentos** (`/admin/repositorios`), y `/vincular`, `/desvincular` y
  `/departamentos` en Chat.
- En Chat, el **Space de Dirección** opera sobre todos los departamentos para
  quien escriba desde ahí (el control es formar parte del Space).
- El atajo de desarrollo `admin@dcsmart.app` solo funciona con el login de
  desarrollo encendido (nunca en producción).

La pantalla muestra solo lo que el rol permite (`frontend/src/lib/permisos.js`),
y el backend lo vuelve a chequear en cada pedido (`backend/src/lib/permisos.js`,
función `puede(usuario, acción, departamento)`).

---

## 2. Llamar a la API directamente (curl)

Solo hace falta para lo que no tiene pantalla (apéndice). Sirve el token de
tu propia sesión: F12 → Aplicación → Local Storage →
`dc-plataforma.dcsmart.app` → `dc_plataforma_token`.

```bash
curl -X POST "https://dc-plataforma.dcsmart.app/api/departamentos/membresias/sincronizar?forzar=true" \
  -H "Authorization: Bearer <token>"
```

> La cookie de sesión no sirve para curl en producción: el rewrite de
> Firebase Hosting hacia Cloud Run no reenvía `Cookie`, solo `Authorization`.

---

## 3. Departamentos y avisos

Todo en **Agendas → "Departamentos y avisos"** (sección plegable arriba de
la pantalla (Dirección ve todos los departamentos; un OWNER, solo los avisos de los suyos); se recuerda abierta o cerrada por
navegador). El encabezado resume cuántos departamentos hay, cuántos tienen
Space de Chat y si algún grupo no se pudo leer.

### Crear un departamento

Campo **"Nuevo departamento"** → **Crear departamento** (o
`POST /api/departamentos { "nombre": "..." }`). No es un simple alta: crea
en el momento el **Calendar** del departamento, el
**Google Group** `depto-<slug>@dcsmart.app` y le da a ese grupo acceso de
lectura al Calendar. Si Directory falla a mitad de camino, el departamento
queda guardado y la próxima vez solo reintenta lo que falta.

> Con los grupos como fuente de verdad, **entrar por Tareas ya no crea
> departamentos** a partir del texto de dcsmart (un error de tipeo ahí
> generaba un Calendar y un Group reales). Se crean solo desde acá.

Después de crearlo: agregar a las personas al grupo nuevo en Workspace y
"Releer Google Groups".

> Desde el 27/09/2026 ya no se genera una **clave de kiosko** por departamento:
> las TVs se conectan con QR (§7). La columna `departamentos.kiosko_key` quedó
> en la base sin usarse; se borra en un cambio aparte.

### Avisos por departamento

Una fila por departamento con:

- **Grupo**: cuántos miembros leyó, o "error al leer" en rojo.
- **Webhook de Chat**: *write-only* — el campo arranca vacío y "en blanco"
  significa "no tocarlo"; **Quitar webhook** lo borra. Solo acepta
  `chat.googleapis.com`. Si el departamento tiene un Space vinculado con
  `/vincular`, **gana el Space** y el webhook queda de respaldo.
- **Días → depto / Días → Dirección**: umbrales de escalamiento en días
  hábiles; vacío = default (2 y 5).

### Desactivar un departamento

No tiene botón (apéndice). Un departamento inactivo deja de aparecer en
todas las pantallas y sus miembros dejan de tenerlo entre sus departamentos.

---

## 4. Agendas (`/agendas`)

Reemplaza a la vieja pantalla "Tareas" (`/admin/tareas` redirige acá). Entra
cualquier usuario con departamento: un MEMBER la ve en modo lectura; crear y
editar pide MANAGER; desactivar, eliminar y los avisos del departamento, OWNER
(ver §1).

### La pantalla

- **A la izquierda, los departamentos** con su cantidad de tareas. Los
  administradores y quien está en varios tienen además **"Todos"**.
- **La tabla**: por cada tarea, **Dónde** (toda la empresa, un grupo con su
  cantidad de locales, o varios), **Cuándo** (la regla en palabras, o "Varía
  según el local", y la próxima fecha), **Responsable** (una persona,
  "Equipo" o "Varios") y **Estado** (🔴 N atrasadas / 🟡 Sin agenda /
  🟢 Al día, contando los últimos 60 días). Las que necesitan atención van
  primero.
- **Buscar** filtra por tarea, local o grupo. Quien es OWNER (o Dirección)
  puede tildar **"Desactivadas"** para ver las desactivadas y eliminarlas.

### Nueva tarea (en un paso)

**+ Nueva tarea** abre un formulario con:

1. **Qué** — el nombre (único en toda la plataforma).
2. **Departamento** — si tenés más de uno.
3. **Dónde** — toda la empresa, un grupo de locales entero, o locales
   puntuales (se agregan de a uno).
4. **Cuándo** — lunes a viernes / todos los días / algunos días de la
   semana / un día del mes (cada 1, 2, 3, 6 o 12 meses) / una sola vez, y
   desde qué fecha.
5. **Quién** — una persona del departamento o "Equipo (sin responsable fijo)".
6. **Más opciones** — descripción, y compartir con otros departamentos (cada
   uno la ve en su agenda; marcarla en uno la marca en todos).

Abajo, una frase dice exactamente qué se va a crear. **Crear y agendar**
crea la tarea, una asignación por local y los eventos en Calendar. Las
series se agendan por 6 meses y se renuevan solas mientras la tarea siga
activa: `reconciliar` las extiende a hoy + 6 meses cuando les quedan menos de
60 días. Las creadas antes del 27/09/2026 (a 12 meses) conservan su fecha de
fin hasta esa primera renovación.

### Trabajar sobre los locales de una tarea

Click en el nombre de la tarea (▸) abre sus locales con checkbox (se puede
tildar la fila entera o "Elegir todos"). Con locales elegidos:

- **Cambiar cuándo** — nueva regla para todos los elegidos. Rige desde la
  fecha elegida, nunca antes de hoy; lo ya marcado queda como estaba.
- **Cambiar responsable** — solo cambia la persona; la agenda queda igual.
- **Quitar** — dejan de agendarse desde hoy; el historial queda.

Y siempre disponibles:

- **+ Agregar locales** — un grupo o locales puntuales, con la misma agenda
  que el resto (o una propia). Si un local se había quitado antes, se
  reactiva con una serie nueva.
- **Opciones avanzadas** — el panel de siempre, una asignación por vez: agenda
  individual, compartir con otros departamentos y **dependencias** ("espera
  a": avisa, no bloquea; se rechazan ciclos y auto-dependencias).

### Renombrar, duplicar, desactivar, eliminar

- **Renombrar** — cambia el nombre (sigue siendo único).
- **Duplicar** — pide nombre y departamento, y opcionalmente copia la
  agenda: mismos locales, frecuencia, responsable y departamentos
  compartidos, **desde hoy** (no crea atrasadas hacia atrás). Las
  dependencias no se copian.
- **Desactivar** (OWNER del grupo o Dirección) — cierra la agenda de todos sus
  locales desde hoy, sin borrar historial.
- **Eliminar definitivamente** (OWNER del grupo o Dirección, sobre una desactivada;
  hay que escribir `ELIMINAR`) — borra eventos de Calendar, asignaciones,
  dependencias y la tarea. No se puede deshacer. Las series viejas que se
  cerraron al cambiar la frecuencia quedan en Calendar como historial.

---

## 5. Mi agenda y una tarea puntual

**Varios departamentos**: quien está en más de un grupo (y Dirección) arranca
viendo **todos juntos**; cada tarea lleva una etiqueta de color con su
departamento (el color sale del orden alfabético de todos los departamentos,
así es el mismo en todas las vistas). Una tarea compartida entre dos
departamentos visibles se muestra una sola vez, con la etiqueta de su dueño.

**Vista Semana (L-V)**: mismo armado que el kiosko (semáforo y contadores
arriba, columna **Atrasadas** a la izquierda, lunes a viernes por local, y la
**próxima semana** más chica abajo, con cada tarea y en cuántos locales). Mismos
criterios que `routes/tv.js`: últimos 60 días, semáforo rojo con cualquier
atrasada, sin "no aplica". Única diferencia: Atrasadas junta **todo** lo vencido
que no tiene columna a la vista (semanas anteriores **y** sábados y domingos), para
que una vencida de fin de semana no quede sin mostrarse. Sábado y domingo la vista
arranca en la semana siguiente (el kiosko, en cambio, sigue mostrando la
semana en curso aunque sea fin de semana).

**Semana y Mes, para MANAGER y OWNER**:

- **Arrastrar** una tarea pendiente o atrasada a otro día = Cambiar fecha de
  esa ocurrencia, con un aviso de **Deshacer** (15 segundos). En Semana se
  puede arrastrar desde Atrasadas y soltar en la próxima semana.
- Crear en un día: el **+** del día en Semana, tocar el día en Mes, o
  **+ Nueva tarea**. Abre el formulario con ese día ya puesto ("una sola vez,
  ese día").

**El detalle de una tarea** (tocándola, en Mi agenda o Mis tareas). Mientras
esté pendiente o atrasada:

- **Marcar hecha** (MEMBER) — definitivo, con confirmación.
- **No aplica** (MEMBER) — con motivo obligatorio; no cuenta ni como hecha ni
  como atrasada. Definitivo.
- **Cambiar fecha** (MANAGER) — mueve **solo esa ocurrencia** a otro día (no
  toca el resto de la serie ni otros locales). Si la tarea está compartida, se
  mueve también en los otros departamentos. Queda en el historial:
  *REPROGRAMADA de <fecha> a <fecha> por <email>*.
- **Editar** (MANAGER del departamento dueño) — nombre de la tarea (en todos
  sus locales), responsable y frecuencia de ese local.

Mi agenda muestra "Actualizando…" mientras carga, y volver a algo ya visto es
instantáneo. La primera entrada después de un rato sin uso puede tardar 5 a 9
segundos (el servidor se apaga cuando no se usa; se decidió no pagar una
instancia fija).

## 5 bis. Ayuda (`/ayuda`)

La pantalla **Ayuda** muestra `docs/MANUAL-DE-USO.md` tal cual (con índice y
buscador), incluidos todos los comandos de Chat. **Es la única copia del
manual de uso**: cada cambio visible de la plataforma tiene que actualizar ese
archivo (y este manual si toca la administración); se ve en la Ayuda con el
próximo deploy del frontend.

---

## 6. Tablero de cumplimiento (`/reportes`)

Lo ven los MANAGER y OWNER de cada grupo (el de sus departamentos) y Dirección
(todos). Un MEMBER no tiene la entrada en el menú.

- **Un mes a la vez** (‹ ›). Filtros de **departamento** y **grupo**.
- **Indicadores del mes**: cumplimiento (hechas / (hechas + atrasadas sin
  hacer), con la diferencia contra el mes anterior), hechas a tiempo, hechas
  tarde, atrasadas sin hacer y no aplica. "No aplica" no suma ni resta.
- **Por mes y departamento**: los últimos 6 meses; tocar una celda filtra
  todo el tablero por ese mes y departamento.
- **Días con tareas**: solo los días que tuvieron alguna; los vacíos no se
  muestran.
- **Por grupo y local**: cada grupo se abre en sus locales, con una etiqueta
  por tarea (en rojo las que tienen atrasadas). Los peores van primero.

**De dónde salen los datos**: de la tabla `cumplimiento_instancias` (una
fila por tarea × local × día), que escribe el proceso de la 1:00 con los
**días ya cerrados**. Cada noche re-evalúa los últimos 60 días: una
atrasada que se hace después pasa a "hecha tarde". El día de hoy aparece
recién mañana. Una tarea compartida se cuenta una sola vez en la vista de
todos los departamentos.

> La API vieja `GET /api/reportes/cumplimiento` (totales por día de
> `cumplimiento_diario`) sigue existiendo, pero ninguna pantalla la usa.

---

## 7. Kiosko (pantalla de oficina, sin login)

La TV abre **`https://tv.dcsmart.app`** (sitio de Firebase `dc-plataforma-tv`,
`hosting:kiosko`; en Hostmar, `tv` es un CNAME a `dc-plataforma-tv.web.app`). Si no está conectada, muestra
un **QR** y un código corto. Se conecta con el flujo de dispositivo de las
Smart TV (OAuth 2.0 Device Authorization Grant, RFC 8628):

1. **Pide un código.** La TV hace `POST /api/tv/conexion` y recibe un
   `device_code` secreto, un `user_code` de 6 letras (`BCD-FGH`) y el QR hacia
   `${FRONTEND_URL}/tv?codigo=BCD-FGH`.
2. **Espera.** Cada 5 s consulta `POST /api/tv/conexion/token`. Mientras
   nadie la conecta recibe `authorization_pending`; si consulta más rápido,
   `slow_down`.
3. **Alguien la conecta.** La persona escanea el QR, entra a **Pantallas**,
   elige una o varias agendas y confirma (`/api/pantallas/conexion/:codigo/aprobar`).
4. **Recibe su token.** En la siguiente consulta, la TV recibe un token propio.
   Lo guarda en su navegador y desde ahí pide `GET /api/tv/resumen` cada minuto,
   con `Authorization: Bearer`.

**Permisos:**
- **Quién la conecta:** cualquiera que **vea** la agenda (Miembro en adelante).
- **Qué muestra:** lo que esa persona puede ver, verificado en cada consulta. Si
  deja de ver un departamento, la TV deja de mostrarlo. Si ya no le queda
  ninguno, o si la desactivan, la TV vuelve al QR.
- **Quién la administra:** en **Pantallas** la renombra, le cambia las agendas o
  la desconecta quien la conectó, o Dirección. El OWNER de un departamento que
  la TV muestra también la ve y la puede desconectar.
- **Si Dirección le cambia las agendas** a una pantalla de otra persona, la
  pantalla pasa a nombre de Dirección.

**Seguridad:**
- Del `device_code` y del token de la TV solo se guarda el hash (tablas
  `tv_conexiones` y `tv_pantallas`).
- El código vence a los 10 min y sirve una sola vez.
- Buscar o aprobar códigos tiene un límite de 20 intentos cada 10 min por
  persona; pedir códigos, 10 cada 10 min por IP.
- El token solo lee el kiosko, nunca es una sesión, y ya no viaja en la URL:
  antes la clave quedaba en los logs de Cloud Run.

**Funcionamiento de la TV:**
- Se actualiza cada minuto y reintenta a los 30 s si falla. Además recarga la
  página completa cada hora.
- El servidor guarda lo leído de Calendar 30 s por departamento, compartido
  entre TVs.
- Sin conexión, muestra lo último con aviso. Si el servidor responde que la
  pantalla ya no está conectada (401), vuelve al QR.

**Qué muestra:** semáforo (🔴 hay atrasadas de los últimos 60 días / 🟡 hay
pendientes de hoy / 🟢 al día), contadores, **las atrasadas de esos 60 días**,
la semana por local, adelanto de la siguiente, clima y reloj. Con varios
departamentos, cada tarea lleva su etiqueta de color. Es de **solo lectura**: no
se marca nada desde ahí.

**Los links viejos** con `?depto=<slug>&key=<kiosko_key>` dejaron de funcionar
el 27/09/2026. Esas TVs toman el HTML nuevo en su recarga de cada hora, y a
partir de ahí muestran el QR: alguien la escanea y listo.

| Qué pasa | Por qué / qué hacer |
|---|---|
| La TV muestra el QR aunque estaba conectada | La desconectaron, o quien la conectó ya no ve ninguna de sus agendas o fue desactivado. Conectarla de nuevo. |
| "Ese código venció" en el celular | Pasaron 10 minutos. La TV ya muestra otro: escanearlo de nuevo. |
| Una agenda aparece tachada en Pantallas | Quien conectó la TV ya no ve ese departamento. Cambiarle las agendas o conectarla con otra persona. |
| "Terminando de conectarse…" que no avanza | La TV se apagó o perdió la red justo después de aprobarla. A los 15 min se descarta sola: volver a escanear. |

---

## 8. Repositorios de documentos y `/buscar` — Documentos (`/admin/repositorios`)

Solo administradores. Los documentos que usa `/buscar` en Chat.

- Un **repositorio** tiene nombre y se asigna a cero, uno o varios
  departamentos (sin ninguno = general, lo ve cualquier Space).
- **Documentos sueltos**: archivo `.txt`, `.md` o `.pdf`, o una URL. Quedan
  "Indexando…" un rato antes de estar disponibles.
- **Carpeta de Google Drive**: link de la carpeta + **Resincronizar**
  (manual; no baja subcarpetas; de un Sheet lee solo la primera hoja).
- `/buscar` responde **solo** con esos documentos, nunca con conocimiento
  general, y si no encuentra la respuesta lo dice con un texto fijo.

---

## 9. Comandos de Google Chat — referencia

El uso de cada uno está en `MANUAL-DE-USO.md`. En Chat, cada persona opera
sobre los departamentos de sus grupos; desde el Space de Dirección, sobre
todos ("modo todo").

| Comando | Alias | Tipo | Qué hace |
|---|---|---|---|
| `/hoy` | `/tareas` | rápido | Tareas que vencen hoy |
| `/atrasadas` | `/vencidas` | rápido | Lo que quedó sin hacer |
| `/mias` | | rápido | Las tuyas + las del equipo sin responsable |
| `/ayuda` | `/help` | rápido | Lista de comandos |
| `/resumen` | `/estado` | rápido | Pendientes, atrasadas y % de cumplimiento |
| `/equipo` | | rápido | Quién tiene qué y cuánto atraso |
| `/departamentos` | | rápido, **solo admin** | Panorama de configuración (abajo) |
| `/vincular` | | barra + diálogo, **solo admin** | Qué departamento(s) cubre este Space |
| `/desvincular` | | barra | Deja de cubrir departamentos en este Space |
| `/marcar` | `/hecha` | barra | Da una tarea por hecha |
| `/tomar` | | barra | La pone a tu nombre |
| `/pasar` | | barra | Se la pasa a otra persona |
| `/nota` | `/comentar` | barra | Comentario en el historial |
| `/tarea` | `/detalle` | barra | Estado, responsable, dependencias e historial |
| `/local` | `/grupo` | barra | Tareas de un local o de un grupo |
| `/asignar` | | barra + diálogo | `/tomar` con formulario |
| `/derivar` | | barra + diálogo | `/pasar` con formulario |
| `/apuntar` | | barra + diálogo | `/nota` con formulario |
| `/tildar` | | barra + diálogo | Marcar varias a la vez |
| `/pago` | | barra + diálogo | Vincula un pago de dcsmart a tarea y/o persona |
| `/mispagos` | | barra | Tus pagos con seguimiento pendiente |
| `/tildarpagos` | | barra + diálogo | Marca varios pagos como resueltos |
| `/buscar` | | barra | Pregunta libre, respondida por Gemini (§8) |

Los de acción siguen el rol del grupo (§1): marcar, tildar, tomar y anotar
alcanzan con MEMBER; `/pasar` y `/derivar` piden MANAGER u OWNER. Desde el Space
de Dirección, todo.

Si alguien escribe desde una cuenta sin acceso, Chat le dice cuál cuenta
detectó y qué hacer: *"No encuentro a X en la plataforma…"* (no está en
ningún grupo) o *"Tu usuario (X) está desactivado…"*.

### `/departamentos`

Panel de **auditoría de configuración** (no aparece en `/ayuda`). Por cada
departamento activo: cantidad de tareas, destino del aviso (💬 Space / 🔗
webhook / — sin avisos), umbrales propios, ⚠️ si le falta calendario, 👁️ en
Dirección y 🤝 si el Space cubre otros departamentos. Al pie avisa cuántos
quedan sin recordatorio diario.

---

## 10. Procesos automáticos (Cloud Run Jobs)

| Job | Qué hace | Cuándo (Cloud Scheduler, hora argentina) |
|---|---|---|
| `dc-plataforma-avisos` (`avisosChat.js`) | Recordatorio por departamento + escalamiento a Dirección | 8:00, lunes a viernes |
| `dc-plataforma-reconciliar` (`reconciliar.js`) | Renueva series por vencer, cierra las de locales dados de baja | Cada 6 horas |
| `dc-plataforma-snapshot` (`snapshotCumplimiento.js`) | Totales del día (`cumplimiento_diario`) + tablero por instancia de los últimos 60 días (`cumplimiento_instancias`) | 1:00, todos los días |

Los tres usan la misma imagen (`dc-plataforma-avisos:latest`). Al cambiar su
código hay que reconstruirla (`gcloud builds submit --config
cloudbuild.jobs.yaml`) y actualizar cada job (`gcloud run jobs update <job>
--image ...`): publicar el servicio no los toca.

**Correrlos a mano** (desde `backend/`):

```bash
npm run job:avisos
npm run job:reconciliar
npm run job:snapshot                                # ayer (hora argentina)
npm run job:snapshot -- 2026-09-15                  # una fecha puntual
npm run job:snapshot -- --instancias-desde=2026-08-08   # completar el tablero hacia atrás
```

| Variable | Efecto | Default |
|---|---|---|
| `AVISO_DRY_RUN=1` | Arma los mensajes sin postear nada | envía |
| `AVISO_SLUG_DIRECCION` | Slug tratado como Dirección | `direccion` |
| `AVISO_DIAS_DEPARTAMENTO` / `AVISO_DIAS_DIRECCION` | Umbrales globales (la columna del departamento gana) | `2` / `5` |
| `MEMBRESIA_FUENTE` | `groups` = departamentos desde Google Groups | `groups` en producción |
| `FRONTEND_URL` | Link a la plataforma en las cards de Chat, adónde apunta el QR de las TVs (`/tv`) y origen permitido por CORS. Sin esta variable (el job de avisos no la tiene) se usa el mismo valor por defecto | `https://dc-plataforma.dcsmart.app` |

> **Desde una máquina de desarrollo**: si `gcloud auth application-default
> login` queda bloqueado por el control de acceso a apps de Workspace, el
> proxy de Cloud SQL puede autenticarse con la cuenta de servicio:
> `cloud-sql-proxy dc-smart-mvp:us-central1:dcsmart-mvp-insta --port 5433
> --credentials-file=backend/dc-plataforma-sa-key.json`.

---

## Apéndice — lo que todavía no tiene pantalla

| Operación | Cómo se hace |
|---|---|
| Desactivar un departamento | `UPDATE departamentos SET activo = false WHERE slug = '...'` (base compartida con producción: con cuidado) |
| Aplicar un cambio de grupo frenado por seguridad | `POST /api/departamentos/membresias/sincronizar?forzar=true` (§2) |
| Hacer administrador a alguien | Agregarlo a `depto-direccion@dcsmart.app` (o marcarlo `super_admin` en dcsmart) |
| Unificar cuentas renombradas | `node scripts/unificar-cuentas-renombradas.mjs [--aplicar]` (§1) |
