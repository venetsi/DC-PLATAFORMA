# Configurar la Chat App (paso manual, una sola vez)

Todo el código de la Fase C está desplegado. Falta la configuración en la consola de
Google Cloud, que **no tiene API pública** — hay que hacerla a mano una vez.

**Estado real (2026-08-26, tras un diagnóstico largo — ver el final de este documento):**
agregar/sacar la app de un Space funciona en producción. Los clicks en los botones de
las tarjetas **todavía no** — Chat reconoce el botón pero reporta que la respuesta
"no llegó o fue inválida", y no hay ningún request llegando al servidor. Nada de esto
rompe lo demás: mientras tanto, sigue saliendo el aviso por webhook en texto plano para
los departamentos que lo tengan configurado.

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

## Diagnóstico: los clicks de botones no llegan al webhook (estado abierto)

Agregar/sacar la app del Space funciona (confirmado con requests reales llegando al
servidor). Tocar un botón ("Marcar hecha", "Vincular") **no** — el botón queda
girando y termina en *"DC-PLATAFORMA no puede procesar tu solicitud."*, sin que
Cloud Run registre ningún request entrante para ese click.

**El log más útil para esto no es el de Cloud Run — es el de la propia Chat API:**

```bash
gcloud logging read 'logName="projects/dc-smart-mvp/logs/chat.googleapis.com%2Ferrors"' --limit 5 --freshness=1h --project dc-smart-mvp
```

Muestra `deploymentFunction` (qué botón se clickeó — confirma que Chat sí lo
reconoce) y el error real:
`"Can't post a reply. The Chat app didn't respond or its response was invalid."`

**Ya se descartó**, probando cada uno:
- Caché del navegador (mismo resultado en incógnito).
- Espacio marcado como "externo" (mismo resultado en un Space nuevo, sin ese aviso).
- Checkboxes reseteados (re-verificados uno por uno).
- La URL/audiencia de "Configuración de conexión" (correcta).
- Que faltara la implementación de "Implementaciones de HTTP" (se creó e instaló una,
  sin cambio).

**Sospecha sin confirmar**: demora de propagación del lado de Google para el ruteo de
*acciones* específicamente (el deployment de `gsuiteaddons` se creó el mismo día),
aunque los eventos de ciclo de vida (que no dependen de ese ruteo) ya funcionan.

Para retomar: postear una tarjeta de prueba mínima con
`backend/src/lib/chat.js#postearEnSpace()` (con un solo botón, sin depender del job
completo) y clickearla, revisando el log de arriba después de cada intento.

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
