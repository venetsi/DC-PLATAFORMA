# Configurar la Chat App (paso manual, una sola vez)

Todo el código de la Fase C está desplegado. Falta la configuración en la consola de
Google Cloud, que **no tiene API pública** — hay que hacerla a mano una vez.

Hasta que se complete, el endpoint responde `503` a todo (fail-closed) y el job sigue
saliendo por el webhook viejo. Nada se rompe mientras tanto.

---

## 1. Configurar la app en la consola

Ir a **Google Cloud Console → APIs & Services → Google Chat API → Configuration**
(proyecto `dc-smart-mvp`; la API ya está habilitada).

| Campo | Valor |
|---|---|
| App name | `DC-PLATAFORMA` |
| Avatar URL | cualquier logo público de DCSMART |
| Description | `Recordatorio diario de tareas por departamento` |
| **Enable interactive features** | **ON** |
| Receive 1:1 messages | opcional |
| **Join spaces and group conversations** | **ON** (obligatorio) |
| Connection settings | **HTTP endpoint URL** |
| **HTTP endpoint URL** | `https://dc-plataforma-api-288069746644.us-central1.run.app/api/chat/eventos` |
| **Authentication Audience** | **HTTP endpoint URL** |
| Visibility | disponible para el dominio `dcsmart.app` |

> **La URL tiene que ser la de `run.app`, no `dc-plataforma.web.app`.** El `aud` del
> token que manda Google es la URL **configurada acá**, no la que ve Cloud Run. Si se
> apunta al rewrite `/api/**` de Firebase Hosting, la verificación falla siempre.

## 2. Cargar la audiencia en Cloud Run

Es exactamente la misma URL del paso anterior. Sin esta variable el endpoint responde
`503` a propósito.

```bash
gcloud run services update dc-plataforma-api --region us-central1 --update-env-vars CHAT_AUDIENCE=https://dc-plataforma-api-288069746644.us-central1.run.app/api/chat/eventos
```

## 3. Crear y vincular un Space por departamento

Por cada departamento, en Google Chat:

1. Crear el Space (ej. "Tareas — Auditoría").
2. Agregar el grupo `depto-<slug>@dcsmart.app` — con eso entran todos los del
   departamento de una. Los slugs son: `administracion`, `auditoria`, `comercial`,
   `compras`, `costos`, `direccion`, `finanzas`, `mantenimiento`, `operaciones`,
   `rrhh`, `sistemas`.
3. Agregar la app **DC-PLATAFORMA** al Space.
4. La app responde con una tarjeta preguntando a qué departamento vincularlo.
   **Elegir con un click** — lo tiene que hacer un administrador.

No hay que cargar nada por SQL. Si más adelante se saca la app del Space, la
vinculación se limpia sola.

> **Dirección es la más importante**: es la que recibe el consolidado del escalamiento,
> y hoy no tiene ni Space ni webhook, así que ese nivel se calcula pero no llega a
> nadie.

## 4. Verificar

```bash
gcloud run jobs execute dc-plataforma-avisos --region us-central1 --wait
```

En los logs, `departamentos_con_space` debería reflejar cuántos vinculaste. Si hay
tareas vencidas, la tarjeta llega al Space con un botón **Marcar hecha** por tarea;
al tocarlo, la instancia queda `✓` en Google Calendar con el email real de quien
clickeó.

Para ver qué mandaría sin postear nada:

```bash
cd C:\DEV_ORIG\01-APPS\DC-PLATAFORMA\backend; $env:AVISO_DRY_RUN='1'; npm run job:avisos; Remove-Item Env:\AVISO_DRY_RUN
```

---

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
