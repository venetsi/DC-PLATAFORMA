# Configurar la Chat App (paso manual, una sola vez)

Todo el código de la Fase C está desplegado. Falta la configuración en la consola de
Google Cloud, que **no tiene API pública** — hay que hacerla a mano una vez.

**Estado (2026-08-26): todo funciona** — comandos de barra, botones que resuelven la
acción dentro de Chat, y diálogos (`/asignar`, `/derivar`, `/apuntar`). Marcar una tarea
actualiza la tarjeta en su lugar y los rechazos de un click salen privados. Hubo un bug
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
| `5` | `vincular` | barra | Vincular este Space a un departamento |
| `6` | `desvincular` | barra | Dejar de recibir los recordatorios acá |
| `7` | `tomar` | barra | Poner una tarea a mi nombre |
| `8` | `pasar` | barra | Pasarle una tarea a otra persona |
| `9` | `nota` | barra | Dejar un comentario en una tarea |
| `11` | `tarea` | barra | El detalle y el historial de una tarea |
| `12` | `local` | barra | Las tareas de un local o de un grupo |
| `10` | `asignar` | barra + **Diálogo** | Elegir una tarea de una lista (equivale a `/tomar`) |
| `16` | `derivar` | barra + **Diálogo** | Elegir tarea y persona de dos listas (equivale a `/pasar`) |
| `17` | `apuntar` | barra + **Diálogo** | Elegir la tarea de una lista y escribir la nota en un formulario (equivale a `/nota`) |

> **Los IDs importan solo para los comandos rápidos.** Un comando de barra se resuelve
> por su **nombre** (viene en el texto del mensaje), así que si le queda otro número
> igual funciona. Un comando rápido no se escribe, así que no trae texto y se resuelve
> **por ID** — ahí el número de la consola tiene que coincidir con el del código
> (`backend/src/lib/chat-comandos.js`).

También hay alias, por si alguien escribe otra palabra: `/tareas` = `/hoy`,
`/vencidas` = `/atrasadas`, `/estado` = `/resumen`, `/detalle` = `/tarea`,
`/grupo` = `/local`, `/comentar` = `/nota`, `/help` = `/ayuda`. No hace falta darlos
de alta: funcionan si alguien los escribe.

> **`/derivar` y `/apuntar` son comandos NUEVOS, no una reconfiguración de `/pasar` y
> `/nota`.** Hacen lo mismo, pero con un diálogo en vez de texto ("tarea: destino" /
> "tarea: nota"). Se dieron de alta aparte a propósito: no está confirmado que un
> comando ya configurado como *barra* siga aceptando texto plano una vez que se le
> agrega el checkbox de *Diálogo*, y `/pasar`/`/nota` ya están probados en producción
> — no valía la pena arriesgarlos para ahorrarse dos comandos.

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
vinculación se limpia sola.

> **Dirección es la más importante**: es la que recibe el consolidado del escalamiento,
> y hoy no tiene ni Space ni webhook, así que ese nivel se calcula pero no llega a
> nadie.

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

## Rollback

Si algo sale mal, `chat_webhook_url` sigue en la base y no se borró. Basta con
desvincular el Space (sacar la app, o poner `chat_space_name` en `NULL`) y el aviso
vuelve a salir por webhook en texto plano.
