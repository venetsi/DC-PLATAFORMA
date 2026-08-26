# Configurar la Chat App (paso manual, una sola vez)

Todo el código de la Fase C está desplegado. Falta la configuración en la consola de
Google Cloud, que **no tiene API pública** — hay que hacerla a mano una vez.

**Estado (2026-08-26):** la app funciona en producción con comandos de barra y con el
recordatorio diario. Lo único que no funciona son los botones que resuelven una acción
dentro de Chat — ver "Qué funciona y qué no" más abajo, con el detalle de todo lo que se
probó. No bloquea nada: los comandos cubren lo mismo y los botones de las tarjetas
abren la plataforma.

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

## 3b. Cargar los comandos de barra

En **Google Chat API → Configuration → sección "Comandos"**, agregar uno por uno con
**"Agrega un comando"**:

| ID | Nombre | Descripción sugerida | Diálogo |
|---|---|---|---|
| `1` | `hoy` | Las tareas que vencen hoy | no |
| `2` | `atrasadas` | Lo que quedó sin hacer | no |
| `3` | `mias` | Las tareas que están a mi nombre | no |
| `4` | `ayuda` | Ver los comandos disponibles | no |
| `5` | `vincular` | Vincular este Space a un departamento | no |
| `6` | `desvincular` | Dejar de recibir los recordatorios acá | no |
| `7` | `tomar` | Poner una tarea a mi nombre | no |
| `8` | `pasar` | Pasarle una tarea a otra persona | no |
| `9` | `nota` | Dejar un comentario en una tarea | no |
| `10` | `asignar` | Elegir una tarea de una lista | **sí** — pero no funciona, ver más abajo |

Todos son de tipo **"Comando de barra"**. Los IDs son una referencia, no un requisito:
el comando se resuelve por su **nombre**, así que si uno queda con otro número igual
funciona. (Antes se resolvía por ID y un número cruzado hacía que `/ayuda` contestara
"Atrasadas".)

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

## Qué funciona y qué no (verificado en producción)

| Canal | Payload | Estado |
|---|---|---|
| Agregar / sacar la app de un Space | `addedToSpacePayload` / `removedFromSpacePayload` | ✅ funciona |
| Comandos de barra (`/hoy`, `/tomar`…) | `appCommandPayload` | ✅ funciona |
| Botón dentro de un mensaje | `buttonClickedPayload` | ❌ no llega al endpoint |
| Envío de un diálogo | `buttonClickedPayload` (con `isDialogEvent`) | ❌ no llega al endpoint |
| Botón de tipo `openLink` | — (lo resuelve el cliente) | ✅ funciona |

Lo roto está acotado a **todo lo que vuelve como `buttonClickedPayload`**. Chat
reconoce el click (queda registrado con el `deploymentFunction` correcto) pero nunca
llega un request al servidor, y muestra *"La app no responde o la respuesta no es
válida"*.

Por eso la app usa comandos para todo lo que escribe, y los botones de las tarjetas
son `openLink` (abren la plataforma) en vez de resolver la acción en Chat.

### Qué se probó y descartó

- Tipo de Space (colaboración vs. anuncios) y sus permisos de publicación.
- Caché del navegador (probado en incógnito) y Spaces marcados como externos.
- La URL y la audiencia de "Configuración de conexión".
- Crear e instalar un deployment en `gsuiteaddons` (queda hecho; no cambió nada).
- Un diálogo, que confirmó que el problema no es del widget sino del canal.

### El log que sirve para diagnosticar

No es el de Cloud Run — es uno dedicado de la propia Chat API:

```bash
gcloud logging read 'logName="projects/dc-smart-mvp/logs/chat.googleapis.com%2Ferrors"' --limit 5 --freshness=1h --project dc-smart-mvp
```

Muestra qué botón se clickeó (`deploymentFunction`) y el error real de Google. Fue
el que reveló un bug propio que estaba escondido detrás de este: los mensajes cuyo
texto contenía `&lt;algo&gt;` (los placeholders de la ayuda) eran rechazados enteros con
`invalidContent`, porque Chat los lee como etiquetas HTML desconocidas. Hay una
guarda en `routes/chat.js#escaparPseudoEtiquetas` para que no vuelva a pasar.

### Si algún día se destraba

El código de los botones y del diálogo está escrito y probado de punta a punta
(simulando el envío). Volver a activarlo es cambiar `botonAbrir` por `botonMarcar`
en `chat-cards.js#seccionDeTareas`.

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
