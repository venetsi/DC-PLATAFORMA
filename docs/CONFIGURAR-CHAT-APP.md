# Configurar la Chat App (paso manual, una sola vez)

Todo el código de la Fase C está desplegado. Falta la configuración en la consola de
Google Cloud, que **no tiene API pública** — hay que hacerla a mano una vez.

**Estado (2026-08-27): todo funciona** — comandos de barra, botones que resuelven la
acción dentro de Chat, y diálogos (`/asignar`, `/derivar`, `/apuntar`, `/tildar`,
`/vincular`). Marcar una tarea actualiza la tarjeta en su lugar y los rechazos de un
click salen privados. El Space de Dirección ve y opera sobre todos los departamentos
("modo todo", ver más abajo). Además, `/pago`/`/mispagos`/`/tildarpagos` permiten
asignar una tarea y/o una persona a un Pago de dcsmart (leído de solo lectura vía
BigQuery, ver "Seguimiento de Pagos" más abajo) — no depende de departamento ni de modo
todo. Un Space también puede cubrir varios departamentos concretos (no solo el "modo
todo" de Dirección): `/vincular` abre un checkbox donde se puede tildar más de uno —
ver "`/vincular` con checkbox" más abajo. `/buscar` responde preguntas con Gemini,
anclado en Repositorios (con nombre propio, asignables a varios departamentos a la vez)
cargados desde `/admin/repositorios` — manuales/URLs sueltas o carpetas enteras de
Google Drive (ver "8. Búsqueda con Gemini" más abajo). Probado end-to-end en producción
(2026-09-19) contra datos reales, incluida una carpeta real de Google Drive. Hubo un bug
que costó encontrar y está explicado en "El campo action.function" más abajo: vale
leerlo antes de tocar cualquier botón.

> La documentación oficial de Google está incompleta en varios de estos pasos — lo que
> sigue está confirmado contra la consola real y contra logs de producción, no copiado
> de una guía.

---

## 1. Habilitar las tres APIs (no alcanza con una sola)

```bash
gcloud services enable chat.googleapis.com --project dc-smart-mvp
gcloud services enable appsmarket-component.googleapis.com --project dc-smart-mvp
gcloud services enable gsuiteaddons.googleapis.com --project dc-smart-mvp
```

- **Chat API** — la obvia, pero sola no alcanza.
- **Google Workspace Marketplace SDK** (`appsmarket-component`) — sin esto, la app
  puede aparecer "ACTIVA" en la configuración de Chat y aun así ser **invisible** al
  buscarla desde Chat. Es la que la hace encontrable.
- **Google Workspace Add-ons API** (`gsuiteaddons`) — los tokens que Google manda al
  webhook vienen firmados por
  `service-<PROJECT_NUMBER>@gcp-sa-gsuiteaddons.iam.gserviceaccount.com` (confirmado
  contra logs reales), no por el `chat@system.gserviceaccount.com` que documenta la
  mayoría de las guías — `backend/src/lib/chat-verificar.js` acepta los dos.

## 2. Configurar la app en "Google Chat API → Configuration"

Proyecto `dc-smart-mvp`.

| Campo | Valor |
|---|---|
| App name | `DC-PLATAFORMA` |
| Avatar URL | cualquier logo público de DCSMART |
| Description | `Recordatorio diario de tareas por departamento` |
| **Enable interactive features** | **ON** |
| **Join spaces and group conversations** | **ON** (obligatorio) |
| Connection settings | **HTTP endpoint URL** |
| **HTTP endpoint URL** | `https://dc-plataforma-api-288069746644.us-central1.run.app/api/chat/eventos` |
| **Authentication Audience** | **HTTP endpoint URL** |

> **La URL tiene que ser la de `run.app`, no `dc-plataforma.web.app`.** El `aud` del
> token que manda Google es la URL **configurada acá**, no la que ve Cloud Run. Si se
> apunta al rewrite `/api/**` de Firebase Hosting, la verificación falla siempre.

## 3. Configurar la app en "Google Workspace Marketplace SDK"

Es una API **distinta** de la del paso 2 (buscarla aparte en el buscador de la
consola). Tiene sus propias pestañas.

### Pestaña "Configuración de la app"

- **Visibilidad de la app: Privada** ("Solo disponible para los usuarios en tu
  dominio"). **Ojo: este campo no se puede cambiar una vez guardado** — pensarlo bien
  antes de guardar. Dejar "No listada" **sin marcar** (si se marca, deja de aparecer
  en las búsquedas de Chat, que es justo lo que se necesita).
- Configuración de la instalación: **"Instalación individual + de administrador"**
  (no "Solo instalación de administrador" — así cualquiera puede agregar la app a su
  Space, no solo un super admin).
- Integraciones de apps: tildar **"Complemento de Google Workspace"** →
  **"HTTP u otras implementaciones"** → tildar **"App de Chat independiente"**. El
  campo "ID de implementación" que aparece debajo queda grisado — es normal y
  correcto, ese campo es para apps que combinan Chat con Drive/Docs/etc., no aplica acá.

### Pestaña "Ficha de Play Store"

Google la autocompleta bastante sola a partir de los datos del paso 2 (nombre,
avatar, descripción → íconos, banner, textos EN/ES). Puede hacer falta completar a
mano **"Vínculos de asistencia"** (URL de Condiciones del Servicio, Política de
Privacidad, URL de asistencia — son obligatorios).

Cuando todos los campos obligatorios estén completos, el botón **"Publicar"** al pie
de la página se habilita. Publicar acá es seguro: es la ficha de Marketplace, **no**
toca el consentimiento OAuth de `dcsmart` (ver la advertencia grande más abajo).

### Pestaña "Implementaciones de HTTP"

Crear una implementación nueva (ID simple, ej. `dc-plataforma`) con el JSON vacío
`{}` — alcanza, no hace falta repetir ahí el nombre/URL/logo, ya están en el paso 2.
Después clickear **"Instalar"** al lado de la fila que aparece.

*(No quedó 100% confirmado que este paso sea necesario para el problema de los clicks
que sigue abierto — se hizo durante el diagnóstico y no hizo daño, así que se deja
documentado como parte del camino, pero no se descarta que sea prescindible para una
app puramente de Chat.)*

## 3b. Cargar los comandos

En **Google Chat API → Configuration → sección "Comandos"**, agregar uno por uno con
**"Agrega un comando"**:

**El "Tipo de comando" importa:**

- **Comando rápido** — se ejecuta con un click desde el menú, sin escribir. Es el
  mejor tipo para los que no llevan parámetro.
- **Comando de barra** — se puede escribir y admite parámetros. Obligatorio para los
  que necesitan un argumento (`/tomar cierre`).
- *Acción de mensaje* — no se usa en esta app.

| ID | Nombre | Tipo | Para qué |
|---|---|---|---|
| `1` | `hoy` | **rápido** | Las tareas que vencen hoy |
| `2` | `atrasadas` | **rápido** | Lo que quedó sin hacer |
| `3` | `mias` | **rápido** | Las que están a mi nombre |
| `4` | `ayuda` | **rápido** | La lista de comandos |
| `13` | `resumen` | **rápido** | Cómo viene el departamento |
| `14` | `equipo` | **rápido** | Quién tiene qué |
| `15` | `departamentos` | **rápido** | Panorama de los 11 (solo admin) |
| `5` | `vincular` | barra + **Diálogo** | Checkbox de qué departamento(s) cubre este Space (solo admin) |
| `6` | `desvincular` | barra | Dejar de recibir los recordatorios acá |
| `18` | `marcar` | barra | Dar una tarea por hecha |
| `7` | `tomar` | barra | Poner una tarea a mi nombre |
| `8` | `pasar` | barra | Pasarle una tarea a otra persona |
| `9` | `nota` | barra | Dejar un comentario en una tarea |
| `11` | `tarea` | barra | El detalle y el historial de una tarea |
| `12` | `local` | barra | Las tareas de un local o de un grupo |
| `10` | `asignar` | barra + **Diálogo** | Elegir una tarea de una lista (equivale a `/tomar`) |
| `16` | `derivar` | barra + **Diálogo** | Elegir tarea y persona de dos listas (equivale a `/pasar`) |
| `17` | `apuntar` | barra + **Diálogo** | Elegir la tarea de una lista y escribir la nota en un formulario (equivale a `/nota`) |
| `19` | `tildar` | barra + **Diálogo** | Checkbox de varias tareas a la vez, ordenadas por atraso (equivale a `/marcar`, pero de a muchas) |
| `20` | `pago` | barra + **Diálogo** | Vincular un pago de dcsmart a una tarea y/o persona |
| `21` | `mispagos` | barra | Mis pagos con seguimiento pendiente |
| `22` | `tildarpagos` | barra + **Diálogo** | Marcar varios pagos como resueltos |

> **Los IDs importan solo para los comandos rápidos.** Un comando de barra se resuelve
> por su **nombre** (viene en el texto del mensaje), así que si le queda otro número
> igual funciona. Un comando rápido no se escribe, así que no trae texto y se resuelve
> **por ID** — ahí el número de la consola tiene que coincidir con el del código
> (`backend/src/lib/chat-comandos.js`).

> **`/vincular` cambió de tipo (2026-08-27): de "barra" a "barra + Diálogo".** A
> diferencia de `/derivar`/`/apuntar`/`/tildar` (que se armaron como comandos NUEVOS
> para no arriesgar uno ya probado en producción), acá se decidió a propósito reusar
> el mismo `/vincular` para el checkbox de departamentos — es un comando de uso
> ocasional, solo de administrador, así que el riesgo de romper una costumbre de
> escritura es bajo. **Hay que entrar a la consola y cambiarle el tipo al comando `5`**;
> hasta que no se haga, `/vincular` sigue aceptando el formato de texto viejo tal cual
> lo tenía Chat configurado (el código ya solo sabe abrir el diálogo).

También hay alias, por si alguien escribe otra palabra: `/tareas` = `/hoy`,
`/vencidas` = `/atrasadas`, `/estado` = `/resumen`, `/detalle` = `/tarea`,
`/grupo` = `/local`, `/comentar` = `/nota`, `/hecha` = `/marcar`, `/help` = `/ayuda`.
No hace falta darlos de alta: funcionan si alguien los escribe.

> **`/marcar` es el único de los cuatro comandos de "coordinar" que SI da la tarea por
> hecha** (`/tomar`, `/pasar` y `/nota` deliberadamente no lo hacen). Por eso, a
> diferencia de esos tres, reusa `marcarInstanciaYPropagar` — el mismo helper del click
> del botón de la tarjeta — en vez de llamar a `gcal.marcarInstancia` directo: da gratis
> el chequeo de "ya estaba marcada", la propagación a departamentos compartidos, y el
> aviso de prerrequisito pendiente.

> **`/derivar` y `/apuntar` son comandos NUEVOS, no una reconfiguración de `/pasar` y
> `/nota`.** Hacen lo mismo, pero con un diálogo en vez de texto ("tarea: destino" /
> "tarea: nota"). Se dieron de alta aparte a propósito: no está confirmado que un
> comando ya configurado como *barra* siga aceptando texto plano una vez que se le
> agrega el checkbox de *Diálogo*, y `/pasar`/`/nota` ya están probados en producción
> — no valía la pena arriesgarlos para ahorrarse dos comandos.

> **`/tildar` es distinto a los otros tres diálogos: usa `CHECK_BOX`, no
> `RADIO_BUTTON`**, porque el pedido fue elegir VARIAS tareas para marcar juntas, no una
> sola. `formInputs` en ese caso devuelve un array con cada value tildado — hace falta
> un lector aparte (`leerCampoMultipleDelFormulario` en `routes/chat.js`), el existente
> (`leerCampoDelFormulario`) solo toma el primer valor. Arriba del checkbox lleva el
> semáforo + contadores del día, con el MISMO criterio que `routes/tv.js#estado_general`
> (rojo si algo de hoy quedó vencido, amarillo si hay pendientes de hoy, verde si no).
> Las cards de Chat no tienen colores de verdad — se usan los mismos 🔴🟡🟢 que ya usa
> el kiosko para lo mismo, no una paleta nueva. La lista va ordenada por antigüedad
> (más atrasada primero) y acotada a vencidas + pendientes de hoy — a diferencia de
> `/asignar`, tomar algo con anticipación no tiene sentido en un checklist de "esto ya
> lo hice".

Los comandos van por un mecanismo **distinto** al de los botones de las tarjetas
(`appCommandPayload` en vez de `buttonClickedPayload`), y **funcionan** aunque los
botones no. Por eso todo lo que la app escribe se hace por comando.

Para probar, empezar por `/ayuda`: es el único que no toca Calendar, así que aísla si
el problema fuera de permisos o de datos.

## 4. Cargar la audiencia en Cloud Run

Es exactamente la misma URL del paso 2.

```bash
gcloud run services update dc-plataforma-api --region us-central1 --update-env-vars CHAT_AUDIENCE=https://dc-plataforma-api-288069746644.us-central1.run.app/api/chat/eventos
```

Sin esta variable el endpoint responde `503` a propósito (fail-closed).

## 5. Crear y vincular un Space por departamento

Por cada departamento, en Google Chat:

1. Crear el Space (ej. "Tareas — Auditoría").
2. Agregar el grupo `depto-<slug>@dcsmart.app` — con eso entran todos los del
   departamento de una. Los slugs son: `administracion`, `auditoria`, `comercial`,
   `compras`, `costos`, `direccion`, `finanzas`, `mantenimiento`, `operaciones`,
   `rrhh`, `sistemas`.
3. Agregar la app **DC-PLATAFORMA** al Space. Si Chat avisa "Usa apps en un espacio
   externo" (pasa si alguien del Space tiene un dominio de correo distinto al tuyo,
   p. ej. `@dcmanagement.com.ar`), es normal — esa persona va a **ver** la tarjeta
   pero no va a poder tocar los botones; el resto del equipo sí puede.
4. La app responde con una tarjeta preguntando a qué departamento vincularlo.
   **Elegir con un click** — lo tiene que hacer un administrador (hoy este paso
   funciona; ver el estado de los clicks más abajo).

No hay que cargar nada por SQL. Si más adelante se saca la app del Space, la
vinculación se limpia sola (la avisa Chat con el evento `REMOVED_FROM_SPACE`, y se
sacan también los departamentos compartidos de ese Space).

Un error puntual al postear (403/404) **no** desvincula: queda como "no se pudo
avisar", Dirección lo ve en su Space y se vuelve a intentar al día siguiente. Si
el Space se borró y Chat no mandó `REMOVED_FROM_SPACE`, el vínculo queda colgado y
hay que limpiarlo a mano (ver "Cuando algo sale mal" en el manual de
administrador).

> **Dirección es distinta a los demás**: además de recibir el consolidado del
> escalamiento, su Space entra en **"modo todo"** (ver más abajo) — conviene armar el
> grupo con cuidado de a quién se agrega.

### El Space de Dirección ve y opera sobre TODOS los departamentos ("modo todo")

Decisión explícita del usuario (2026-08-26): el Space vinculado a **Dirección**
—cualquiera que sea, se puede recrear cuando haga falta— deja de estar acotado a las
tareas propias de Dirección. Desde ahí:

- `/hoy`, `/atrasadas`, `/mias`, `/tarea`, `/local`, `/resumen` y `/equipo` mezclan los
  11 departamentos, con cada línea marcando `[Departamento]` de dónde es.
- `/tomar`, `/pasar`, `/nota` (y sus diálogos `/asignar`, `/derivar`, `/apuntar`) actúan
  sobre la tarea de **cualquier** departamento que encuentren por el texto — el
  `calendarId` sale de la tarea encontrada, no de Dirección.

**El control de acceso es la membresía del Space, no la ficha de la persona.** Quien
escriba desde ese Space obtiene el modo todo aunque su propio departamento no sea
Dirección — así lo pidió el usuario a propósito, para no tener que mantener sincronizada
una lista aparte de "quién es de Dirección". Por eso arma con cuidado a quién agregás al
grupo/Space que vincules ahí: es, en la práctica, el mismo nivel de acceso que un admin
global dentro de Chat.

Detalle técnico para quien toque `chat-comandos.js`: la tarea que viaja en el `value` de
un diálogo abierto en modo todo lleva el id de departamento codificado
(`idDepartamento::instanceId`, ver `codificarTarea`/`decodificarTarea`), porque el mismo
id de evento de Calendar puede repetirse entre calendarios distintos. Fuera de modo todo
esa codificación se re-verifica contra el ámbito del Space (el dueño MAS los
compartidos, ver abajo) — no alcanza con mandar un `value` manipulado para operar sobre
un departamento que ese Space no cubre.

### `/vincular` con checkbox: un Space entre varios departamentos concretos

Decisión explícita del usuario (2026-08-27): además del "modo todo" de Dirección, hace
falta un mecanismo más chico — Spaces armados con gente de 2-3 equipos concretos (ej.
"Administración + Finanzas") que quieren coordinar tareas de los dos sin que cada uno
tenga que escribir desde el Space del otro. La primera versión de esto fue un par de
comandos nuevos (`/compartir`/`/descompartir`); el usuario pidió reusar directamente
`/vincular`, con un formulario de checkbox, en vez de sumar comandos de texto aparte —
es lo que quedó.

`/vincular` (ver arriba, ahora "barra + Diálogo") abre un checkbox con los
departamentos activos, pre-tildados según lo que ya cubre el Space
(`departamentosParaVincular`). Al guardar, `vincularDepartamentos` recalcula la
cobertura ENTERA a partir de lo tildado — no hay una operación de "agregar uno", es
"esto es lo que cubre este Space ahora":

- `Departamento.chat_space_name` (único — un departamento no puede ser dueño de dos
  Spaces) sigue siendo el **dueño**, el que recibe el recordatorio diario automático.
  Se mantiene si sigue tildado (para no reordenar nada solo por sumar o sacar un
  compartido); si se destildó, el primero por orden alfabético de los que quedan pasa a
  ser el nuevo dueño.
- La tabla `DepartamentoCompartidoEnSpace` (`chat_space_name`, `id_departamento`) guarda
  el resto de los tildados como **compartidos**. Se recalcula entera en cada envío
  (se borran los que ya no están tildados, se crean los que faltan).
- Sin nada tildado, equivale a `/desvincular`: limpia todo.

`departamentosDelSpace(db, space)` (en `chat-comandos.js`) devuelve siempre un array —
`[dueño]` para un Space normal, `[dueño, ...compartidos]` para uno compartido — y es la
base de `resolverDepartamento`/`ambitoDeChat`/`puedeOperarEnChat`. Con eso, un Space
compartido se comporta como una versión chica de "modo todo": los comandos de lectura
mezclan sus 2-3 departamentos (con cada línea aclarando de cuál sale, igual que en modo
todo) y los de acción operan sobre la tarea de cualquiera de ellos — pero el
recordatorio diario automático (`jobs/avisosChat.js`) sigue yendo solo al dueño, porque
ese job itera por `chat_space_name` como siempre: tildar más de uno amplía qué se puede
**consultar y operar** desde el Space, no a quién avisa el job.

## 6. Verificar

```bash
gcloud run jobs execute dc-plataforma-avisos --region us-central1 --wait
```

En los logs, `departamentos_con_space` debería reflejar cuántos vinculaste. Si hay
tareas vencidas, la tarjeta llega al Space con un botón **Marcar hecha** por tarea.

Para ver qué mandaría sin postear nada:

```bash
cd C:\DEV_ORIG\01-APPS\DC-PLATAFORMA\backend; $env:AVISO_DRY_RUN='1'; npm run job:avisos; Remove-Item Env:\AVISO_DRY_RUN
```

---

## 7. Seguimiento de Pagos (`/pago`, `/mispagos`, `/tildarpagos`)

Permite asignarle una tarea del catálogo y/o una persona a un **Pago** puntual de
dcsmart (`Pago` en `dcsmart/backend/prisma/schema.prisma`) — por ejemplo, "hay que
auditar este comprobante" o "que Juan concilie este pago con el proveedor". Nace de un
pedido explícito: seguimiento de tareas, aplicado a un pago en vez de a una tarea
recurrente.

**Deliberadamente NO usa el modelo de Tarea/TareaAsignacion/Calendar.** Un pago es un
registro de una sola vez de OTRO sistema (dcsmart), no algo que se repita — forzarlo
por el motor de agenda (RRULE con horizonte, evento de Calendar) ensuciaría el calendario
del departamento con eventos que no son operativos reales. Tiene su propia tabla,
`PagoSeguimiento` (`schema.prisma`), sin Calendar de por medio.

**Tampoco depende de departamento ni de "modo todo"**: `Pago` no tiene departamento,
solo local, así que estos tres comandos no pasan por `resolverDepartamento` — el único
requisito es ser un `ExtUser` activo, igual que cualquier comando de lectura.

### De dónde salen los datos

Lectura de **solo lectura** contra el dataset CDC de dcsmart en BigQuery
(`dcsmart_analytics_cdc`, el mismo que usa `dcsmart-auditoria` — ver
`backend/src/lib/pagos.js`). **Nunca se escribe en dcsmart**, ni en Postgres ni en
BigQuery: la única escritura de esta funcionalidad es `PagoSeguimiento`, en la base
propia de DC-PLATAFORMA.

Requiere que la service account del servicio (`dc-plataforma-api@dc-smart-mvp.iam
.gserviceaccount.com`) tenga estos dos roles sobre `dc-smart-mvp` — los mismos que ya
tiene la de `dcsmart-auditoria`, no un permiso nuevo a inventar:

```bash
gcloud projects add-iam-policy-binding dc-smart-mvp \
  --member="serviceAccount:dc-plataforma-api@dc-smart-mvp.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataViewer" --condition=None

gcloud projects add-iam-policy-binding dc-smart-mvp \
  --member="serviceAccount:dc-plataforma-api@dc-smart-mvp.iam.gserviceaccount.com" \
  --role="roles/bigquery.jobUser" --condition=None
```

Sin este grant, `/pago` responde con un error de BigQuery al abrir el diálogo —
`/mispagos` y `/tildarpagos` funcionan igual (leen `PagoSeguimiento`, no BigQuery).

### Flujo

1. `/pago tiamo` — resuelve el local por texto (mismo criterio que `/local`, pero sin
   la lógica de grupo: un pago es de un solo local), trae los pagos de los últimos 30
   días que **todavía no tienen seguimiento** (se excluyen los que ya están en
   `PagoSeguimiento`), y abre un diálogo: radio button para elegir el pago, dropdown
   opcional para clasificarlo con una tarea del catálogo, dropdown opcional para
   asignarlo a alguien.
2. Al confirmar, el pago se **re-lee de BigQuery en ese momento** (no se confía en lo
   que haya en el `value` de la card, que pudo quedar viejo) y se guarda un **snapshot**
   (comprobante, proveedor, importe, fecha) en `PagoSeguimiento` — así `/mispagos` no
   necesita una llamada a BigQuery por fila.
3. `/mispagos` lista los pendientes asignados a quien pregunta, `100%` desde Postgres.
4. `/tildarpagos` abre un checkbox (mismo widget genérico que ya usa `/tildar`, ver
   `chat-cards.js#selectorMultiple`) con los pendientes de esa persona; el submit hace
   un `updateMany` con `WHERE id IN (...) AND asignado_a = <email> AND estado =
   'PENDIENTE'` — la propia condición es la guarda de seguridad: nadie puede marcar un
   pago ajeno manipulando el `value` de la card.

### Trampa empírica: `types` explícito en el cliente de BigQuery

**No pasar el objeto `types` al `.query()`** (`{ idLocal: 'STRING', desde: 'DATE', ... }`).
Se probó así primero y la query **corría sin tirar ningún error, pero devolvía 0 filas
siempre** — para cualquier local, aunque hubiera pagos reales en la ventana. Un mock de
BigQuery en un test no lo detecta (el mock no valida tipos), así que esto solo salió a
la luz al probar contra datos reales. Sacando `types` por completo, y dejando que el
cliente infiera el tipo de cada parámetro por el valor JS que se le pasa, la misma
query trae los datos correctos. No se investigó la causa raíz dentro de
`@google-cloud/bigquery` — queda como constancia empírica de qué forma funciona, ver
`lib/pagos.js`.

## 8. Búsqueda con Gemini sobre documentos (`/buscar`)

Permite preguntar algo en el Space y que **Gemini responda anclado solo en los
documentos cargados** (manuales, políticas, instructivos). Los documentos se organizan
en **Repositorios** (entidad con nombre propio, `/admin/repositorios`, solo admin): cada
uno se asigna a cero o más departamentos (misma maquinaria de ámbito que `/hoy`/`/tarea`),
sin ninguno es general y lo ve cualquier Space. Un mismo repositorio puede asignarse a
varios departamentos a la vez, para que compartan la misma fuente de información.

**Motor: Gemini API File Search** (`ai.google.dev/gemini-api/docs/file-search`, lanzado
2026) — un RAG totalmente administrado por Google: se suben archivos a un "store" (uno
por Repositorio), el propio Gemini los trocea, indexa y busca, y la respuesta trae citas
de qué documento salió cada parte. Soporta nativo `.txt`, `.md` y `.pdf`.

### Primera credencial tipo API key de toda la app

A diferencia de TODO lo demás acá (Calendar, Groups, Chat, BigQuery — todo por cuenta de
servicio/ADC, cero secretos guardados), File Search se autentica con una **API key**
sobre la Generative Language API — no tiene variante por cuenta de servicio.

1. Google Cloud Console → APIs & Services → Credentials, proyecto `dc-smart-mvp` (ya
   tiene `generativelanguage.googleapis.com` y `aiplatform.googleapis.com`
   habilitados) → crear una API key, **restringida** a la Generative Language API.
2. Guardarla como secret de Cloud Run (`GEMINI_API_KEY`) — **nunca en el repo ni en un
   `.env` versionado**.

### Cargar el comando

| ID | Nombre | Tipo | Para qué |
|---|---|---|---|
| `23` | `buscar` | barra | Preguntar algo, respondido por Gemini con los documentos cargados |

`/buscar` **no** es de tipo Diálogo — responde con texto (actualizado en el mismo
mensaje mientras Gemini procesa, no en la respuesta síncrona del webhook, porque una
consulta puede tardar más que los ~30s que da Chat).

### Repositorios de tipo carpeta de Google Drive

Un Repositorio puede ser `MANUAL` (archivos sueltos o URLs pegadas) o `DRIVE_FOLDER`
(toda una carpeta de Drive, con un botón "Resincronizar" en `/admin/repositorios` — la
sync es manual, no automática: no hay infraestructura de notificaciones push de Drive en
esta app, y no hace falta para un puñado de manuales que cambian de vez en cuando).
Docs/Slides se exportan como texto plano; Sheets exporta **solo la primera hoja** como
CSV (limitación real de la API de Drive, no resuelta). No es recursivo: los archivos de
subcarpetas no se importan.

**Requiere el scope `drive.readonly` por domain-wide delegation** — otorgado
2026-09-19, mismo lugar que `admin.directory.user.readonly` (ver "Opcional: el fallback
de identidad" más abajo), **Admin Console → Seguridad → Control de datos y acceso →
Delegación de dominio**, sobre el client ID de
`dc-plataforma-api@dc-smart-mvp.iam.gserviceaccount.com`:

```
https://www.googleapis.com/auth/drive.readonly
```

**Trampa real, encontrada al probar contra una carpeta real**: si la carpeta vive en una
**Unidad compartida** (Shared Drive, no "Mi unidad"), la API de Drive v3 **NO la ve por
defecto** — `files.list`/`files.get` devuelven vacío o 404 **sin ningún error que lo
delate**, aunque la cuenta impersonada (`GOOGLE_WORKSPACE_ADMIN_EMAIL`) sea miembro con
acceso de administrador. Hace falta pasar `supportsAllDrives: true` (y
`includeItemsFromAllDrives: true` en el `list`) en cada llamada — ver
`lib/repositorios.js#sincronizarCarpetaDrive`. Sin esto, un admin puede compartir la
carpeta perfecto y la sync va a seguir devolviendo "0 archivos" sin pista de por qué.

Verificado end-to-end contra una carpeta real de Unidad compartida con 5 archivos reales
(2 Google Docs, 2 `.md`, 1 `.pdf`): los 5 se importan, indexan, y una pregunta real sobre
su contenido combina las tres fuentes en la respuesta con las citas correctas.
Resincronizar de nuevo no duplica nada (se saltea por `origen` = id del archivo de
Drive, ya importado).

## ⚠️ NUNCA tocar la pantalla de "Google Auth Platform" de este proyecto

`dc-smart-mvp` es el **mismo proyecto de GCP que usa `dcsmart` en producción**. Todo lo
que diga **"Google Auth Platform" / "Pantalla de consentimiento" / "Público"** (Tipo
de usuario, Prueba/Producción, Información de la marca) **no es de esta app** — es la
pantalla que usa el login real con Google de `dcsmart`
(`dcsmart/backend/src/routes/auth.js`, `POST /api/auth/google`) y el "Abrir en Sheets"
de Pagos. En particular:

- **Nunca tocar "Marcar como interno"** en "Tipo de usuario" — corta el acceso, sin
  vuelta atrás, a cualquier cuenta fuera del propio Workspace (hay cuentas reales de
  `@dcmanagement.com.ar` y al menos un Gmail personal usando ese login hoy).
- **No hace falta tocar "Publicar app" (Prueba→Producción)** de esa misma pantalla
  para nada de lo de acá — si se toca sin querer, no rompe el login pero hace que
  "Abrir en Sheets" le muestre a los usuarios un cartel de "app no verificada"; se
  revierte con el botón "Volver al modo de prueba" en la misma pantalla, sin dejar
  secuela.

Las pantallas de **Chat API** y **Marketplace SDK** (pasos 2 y 3 de arriba) son
seguras — viven en otra sección de la consola y no comparten nada con esto.

## El campo `action.function`: la URL, no el nombre

**Este es el detalle que hace que un botón funcione o no**, y es la diferencia más
importante entre una Chat app "clásica" y una publicada como Workspace Add-on (que es
lo que es esta app).

| | Chat app clásica | **Workspace Add-on (nuestro caso)** |
|---|---|---|
| `action.function` | el **nombre** de una función | la **URL completa** del endpoint |

Textual, de [chat/convert](https://developers.google.com/workspace/add-ons/chat/convert):

> "add-ons use a full HTTP URL for a card's `action.function`, while Chat apps built
> with Google Chat API interaction events use a function name."

Y sobre cómo distinguir entonces una acción de otra:

> "You can set a unique HTTP endpoint per button, or use a common endpoint and pass the
> action as a parameter in `action.parameters`."

Esta app usa lo segundo. Un botón se ve así (`chat-cards.js`):

```json
{
  "onClick": {
    "action": {
      "function": "https://dc-plataforma-api-288069746644.us-central1.run.app/api/chat/eventos",
      "parameters": [
        { "key": "accion", "value": "marcar" },
        { "key": "instanceId", "value": "..." }
      ]
    }
  }
}
```

**Dos trampas, las dos verificadas empíricamente:**

1. **La URL tiene que ser EXACTA**, la misma que `CHAT_AUDIENCE`. Se probó con cuatro
   variantes y el resultado fue: un nombre simbólico no genera **ningún** request; la
   URL limpia da 200; la URL con `#fragmento` o `?query` **llega al endpoint pero da
   401**, porque el `aud` del token pasa a incluir eso y deja de coincidir.

2. **El payload del click NO trae `commonEventObject.invokedFunction`.** Si el código
   lo lee de ahí para decidir qué hacer, queda `undefined` y termina devolviendo algo
   vacío — que Chat reporta como *"la respuesta no es válida"*, sin ninguna pista de
   la causa real. La acción tiene que leerse de `commonEventObject.parameters`.

### Qué canales usa la app

| Canal | Payload que llega |
|---|---|
| Agregar / sacar la app de un Space | `addedToSpacePayload` / `removedFromSpacePayload` |
| Comandos (`/hoy`, `/tomar`…) | `appCommandPayload` |
| Botón que resuelve una acción | `buttonClickedPayload` + `parameters` |
| Envío de un diálogo | `buttonClickedPayload` + `formInputs` |
| Botón `openLink` | ninguno: lo resuelve el cliente |

### El log que sirve para diagnosticar

No es el de Cloud Run — es uno dedicado de la propia Chat API, y es el único lugar
donde aparece el error real:

```bash
gcloud logging read 'logName="projects/dc-smart-mvp/logs/chat.googleapis.com%2Ferrors"' --limit 5 --freshness=1h --project dc-smart-mvp
```

Muestra el `deploymentFunction` (qué botón se tocó) y el mensaje de Google. Fue el que
reveló, además, que un mensaje cuyo texto contenga `&lt;algo&gt;` es rechazado **entero**
con `invalidContent`, porque Chat lo lee como una etiqueta HTML desconocida. Hay una
guarda en `routes/chat.js#escaparPseudoEtiquetas`.

## Después del fix: la tarjeta en su lugar, rechazos privados y dos diálogos más

Con los botones funcionando, se revisaron tres cosas más (2026-08-26):

- **Marcar una tarea actualiza la tarjeta EN SU LUGAR** (`updateMessageAction`) en vez
  de postear un mensaje nuevo con `✅ marcada`. La tarjeta se reconstruye contra
  Calendar en vivo (`lib/chat-recordatorio.js`) y la confirmación queda como una línea
  arriba de las secciones que sigan vigentes. Si la reconstrucción fallara por lo que
  sea, cae a un mensaje de texto simple en vez de romper el click.
- **Los rechazos de un click salen privados** (solo los ve quien clickeó), usando
  `privateMessageViewer` en el `message` que devuelve `createMessageAction` — ese campo
  es del recurso `Message` de la Chat API, no algo exclusivo del bot clásico, así que
  aplica igual acá. Los rechazos de un **comando de barra** (`/pasar`, `/tomar`...)
  siguen públicos a propósito: quien escribe el comando lo hace a la vista de todos.
- **`/derivar` y `/apuntar`**: versión en diálogo de `/pasar` y `/nota` (ver la tabla de
  comandos más arriba). Comandos nuevos, no una reconfiguración de los existentes — el
  motivo está en la nota debajo de esa tabla.

## Opcional: el fallback de identidad

Cuando alguien toca un botón, Chat manda su email en el payload y con eso alcanza. Si
alguna vez no viniera, hay un fallback que resuelve la identidad por Directory API, y
ese sí necesita autorizar un scope más en
**Admin Console → Seguridad → Control de datos y acceso → Delegación de dominio**,
sobre el client ID del service account:

```
https://www.googleapis.com/auth/admin.directory.user.readonly
```

Está en un cliente JWT separado a propósito: si el scope no se autoriza, lo único que
deja de funcionar es el fallback — las llamadas de Google Groups siguen intactas.

**El mismo scope habilita los mensajes privados de «Ya podés hacerla»** (aviso de
dependencias, ver `lib/avisos-dependencias.js`). Para escribirle en privado a una persona
la app necesita su id de Chat (`users/<id>`): con la cuenta de la app, Chat **no**
acepta el email como alias (probado el 2026-09-28: 403 *"Service account authentication
doesn't support access to user information using email aliases"*). Sin el scope, el id
sale solo de `ext_users.chat_user_name`, que se guarda cuando la persona usa la app
(ese día: 6 de 32). Con el scope, se resuelve por Directory para todos; el servicio lo
empieza a usar al reiniciar (un 401 hace que deje de intentarlo hasta entonces).

## Rollback

Si algo sale mal, `chat_webhook_url` sigue en la base y no se borró. Basta con
desvincular el Space (sacar la app, o poner `chat_space_name` en `NULL`) y el aviso
vuelve a salir por webhook en texto plano.
