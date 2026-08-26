# Manual de uso — DC-PLATAFORMA

Guía paso a paso: cómo un administrador carga tareas y su agenda, cómo cada
departamento las marca como hechas, qué muestra la pantalla de oficina, y cómo leer
el reporte de cumplimiento.

> Versión con formato: ver el artifact publicado (link en la conversación de
> planificación) — este archivo es la copia de referencia dentro del repo.

## Cómo entrar

Hoy la plataforma usa un **login temporal** mientras se conecta con el sistema
principal de DCSMART (ver Fase 8 del plan). Vas a entrar con tu email nada más, sin
contraseña.

1. Abrí la aplicación en el navegador.
2. Escribí tu email y hacé click en **Entrar**. Si tu email todavía no fue cargado
   como usuario, te va a avisar que consultes con el administrador.
3. Vas a caer en "Mi checklist de hoy" si tenés un departamento asignado, o en un
   aviso de "Sin asignación" si todavía no.

Este login temporal se reemplaza más adelante por el ingreso automático desde el
sistema principal de DCSMART — mientras tanto, es intencional que cualquiera con el
email correcto pueda entrar, para poder probar la plataforma antes de conectarla.

## Cargar el catálogo de tareas (administrador)

Antes de poder agendar algo, la tarea tiene que existir en el catálogo — es el tipo
de tarea (ej. "CMV"), no todavía el día ni la frecuencia.

1. Andá a **Tareas** en el menú superior.
2. Escribí el nombre de la tarea y elegí el departamento responsable. El
   departamento queda fijo para esa tarea.
3. Click en **Crear**.

## Definir cuándo se repite — la agenda (administrador)

Una misma tarea puede tener una agenda distinta por local (ej. "P&L" vence el día 10
en un local y el día 15 en otro).

1. Andá a **Agenda** y elegí la tarea.
2. Agregá una asignación: un local específico, o "Sin local (alcance empresa)".
3. Elegí cómo se repite:
   - **Diaria** — todos los días desde la fecha "desde".
   - **Semanal** — días de la semana específicos.
   - **Cada N meses** — mensual, trimestral, semestral o anual, con el día del mes.
   - **Una vez** — una fecha puntual.
4. Click en **Agendar**. Para editar, volvé a esta pantalla con la misma tarea — el
   botón pasa a decir **Actualizar**; los días ya marcados como hechos no se tocan.

Cada agenda se crea por **12 meses** a partir de la fecha "desde", y se renueva sola
antes de vencerse: no hay que volver a cargarla cada año.

### Tareas que dependen de otra

Debajo de la agenda podés indicar que esa tarea **espera** a otra — por ejemplo, que
el reporte de Auditoría espere al CMV de Finanzas del mismo día.

1. Click en **Depende de otra tarea**.
2. Elegí el departamento, la tarea y el local del prerrequisito.
3. Queda listado en **Espera a:**, con la × al lado para sacarlo.

La dependencia puede cruzar departamentos, y el sistema rechaza los círculos (si A
espera a B, B no puede esperar a A).

**Avisa, no bloquea.** Nadie queda trabado esperando a otro equipo:

- En la agenda, la tarea muestra el nombre del prerrequisito y su departamento
  (por ejemplo **⏳ espera a CMV — Finanzas**) mientras ese día siga sin hacerse.
- Si la marcás igual, **se marca** y aparece un aviso de qué quedó sin hacer. Eso
  también queda anotado en el historial del evento en Google Calendar.
- Si el prerrequisito no tiene tarea ese día, la dependencia simplemente no aplica.

## Mi checklist de hoy (cualquier usuario)

Pantalla principal al entrar — muestra las tareas de tu departamento que vencen hoy.

1. Ves la lista de tareas de hoy con su estado.
2. Click en **Marcar realizada** cuando termines una. Queda registrado quién y
   cuándo.

Por ahora no hay paso de aprobación: marcar "realizada" ya cierra la tarea.

## Mis tareas (cualquier usuario)

Como "Mi agenda", pero acotada a lo que te toca a vos: las que tenés asignadas a tu
nombre **más** las de tu departamento que no tienen responsable fijo (esas las puede
hacer cualquiera del equipo, vos incluido).

1. Andá a **Mis tareas**.
2. Arriba ves cuántas tenés vencidas, pendientes y realizadas.
3. Las vencidas muestran hace cuántos días lo están.
4. Click en una tarea para marcarla realizada, igual que en Mi agenda.
5. Si alguna espera a otra tarea, lo vas a ver con **⏳ espera a…** debajo del nombre.

Con **Solo las que tengo asignadas** dejás afuera las del equipo y ves únicamente las
que están a tu nombre.

Muestra los últimos 30 días y las próximas 2 semanas: mira más hacia atrás que Mi
agenda porque lo que importa acá es lo que quedó pendiente.

## La pantalla de agenda — kiosko (todos)

Pensada para quedar fija en una TV/monitor de oficina, sin login, actualizándose
sola cada 2 minutos.

1. Pedile al administrador el link de tu departamento (cada uno tiene su propia
   clave privada).
2. Abrí ese link en pantalla completa en la TV/monitor.
3. Muestra un semáforo del día, contadores de pendientes/realizadas/vencidas, y el
   listado de tareas de hoy.

| Color | Significado |
|---|---|
| Verde | Todo al día |
| Amarillo | Hay pendientes, todavía no vencieron |
| Rojo | Hay al menos una vencida sin hacer |

Si se corta internet, sigue mostrando los últimos datos (con aviso de "sin
conexión" y hace cuánto) y se reconecta sola.

## Reporte de cumplimiento (usuario y admin)

1. Andá a **Reportes**.
2. Si sos de un departamento, ves el tuyo directo; si sos admin, elegís cuál mirar.
3. Arriba: % de cumplimiento del período. Abajo: tabla día por día (total,
   realizadas, vencidas sin hacer).

El número del día se calcula una vez que el día termina — el de hoy aparece recién
mañana. Para el estado de hoy mismo, mirá el checklist o la pantalla de oficina.

## Avisos por Google Chat

Todas las mañanas (8 hs) cada departamento recibe en su Space un recordatorio con:

- **Atrasadas** — las que ya pasaron el umbral de días hábiles del departamento.
- **Vencidas** — el resto de lo que quedó sin hacer.
- **Pendientes de hoy** — lo que vence hoy.

Cada línea muestra el local, el responsable si tiene uno, y hace cuántos **días
hábiles** está atrasada, con un botón **Marcar hecha** al lado. Se cuentan días
hábiles y no de calendario a propósito: una tarea del viernes no debe escalar sola el
lunes solo porque pasó el fin de semana.

El recordatorio se repite todos los días mientras la tarea siga sin hacerse.

### Escalamiento a Dirección

Cuando una tarea supera un segundo umbral, más alto, entra además en **un único
mensaje consolidado a Dirección**, agrupado por departamento y ordenado por
antigüedad. No reemplaza al aviso del departamento: se le suma.

Los umbrales por defecto son **2 días hábiles** para el departamento y **5** para
Dirección, y se pueden ajustar por departamento.

### Operar desde el Chat

Podés consultar y coordinar tareas escribiendo comandos en el Space del
departamento, sin abrir la plataforma.

**Para mirar:**

| Comando | Qué hace |
|---|---|
| `/hoy` | Las tareas que vencen hoy en el departamento |
| `/atrasadas` | Lo que quedó sin hacer, de más viejo a más nuevo |
| `/mias` | Las que están a tu nombre, más las del equipo sin responsable fijo |
| `/ayuda` | La lista de comandos |

**Para ver el detalle:**

| Comando | Qué hace |
|---|---|
| `/tarea cierre` | En qué anda esa tarea: estado, quién la tiene, de qué depende y su historial completo |
| `/local tiamo` | Las tareas de un local. Con `/grupo aldos` ves las de todos los locales del grupo |
| `/resumen` | Cómo viene el departamento: pendientes de hoy, atrasadas y % de cumplimiento |
| `/equipo` | Quién tiene qué y cuánto atraso arrastra cada uno |

`/tarea` es el que muestra las notas que se dejaron con `/nota`, junto con quién marcó
qué y cuándo.

**Para coordinar entre el equipo:**

| Comando | Qué hace |
|---|---|
| `/marcar cierre` | La das por hecha |
| `/tomar cierre` | Esa tarea queda a tu nombre |
| `/pasar cierre: juan@dcsmart.app` | Se la pasás a otra persona |
| `/nota cierre: hablé con el proveedor` | Dejás un comentario en el historial de la tarea |

No hace falta escribir el nombre completo de la tarea: con una parte alcanza. Si hay
más de una que coincida, la app te pregunta cuál. Todo queda registrado en el historial
del evento en Google Calendar, con tu nombre y la fecha.

Si preferís elegir de una lista en vez de escribir, `/tomar`, `/pasar` y `/nota` tienen
cada uno su versión en formulario: `/asignar`, `/derivar` y `/apuntar`. Hacen exactamente
lo mismo, solo cambia cómo elegís la tarea (y, en el caso de `/derivar`, la persona).

`/marcar` también tiene su versión en formulario, pero para varias tareas a la vez:
**`/tildar`** abre un checklist con checkbox, ordenado de la más atrasada a la más
nueva, con un semáforo arriba (🔴🟡🟢, igual que la pantalla de oficina) y cuántas
tenés vencidas/pendientes/hechas hoy. Tildás las que ya hiciste y las marca todas juntas.

Un par de detalles:

- `/marcar` es el único de estos cuatro que da la tarea por hecha. `/tomar` y `/pasar`
  **no** la marcan, solo cambian quién se encarga.
- Si la tarea espera a otra que todavía no está hecha, `/marcar` la marca igual y te
  avisa qué quedó pendiente — mismo criterio que el botón de la tarjeta.
- Si alguien ya la había marcado, `/marcar` te avisa quién fue en vez de duplicar nada.
- Si le pasás una tarea a alguien de otro departamento, la app te avisa: esa persona no
  la va a ver en su `/mias`, así que conviene avisarle aparte.
- Si escribís un comando en un Space que no está vinculado a ningún departamento, la app
  te muestra las de tu propio departamento y te lo aclara.

**Marcar una tarea desde el recordatorio.** Cada tarea del aviso diario trae un botón
**Marcar hecha**: un click la cierra sin salir de Chat, y queda registrada en Google
Calendar con tu nombre igual que si la marcaras desde la plataforma. La tarjeta se
actualiza en el momento con las tareas que quedan pendientes, así que no hace falta
recargar nada ni se acumulan mensajes viejos con botones que ya no sirven.

- Solo pueden marcar los del departamento (y los administradores); si alguien más lo
  intenta, o pasa algo raro (la tarea ya no existe, el Space no está vinculado), el aviso
  lo ve solo quien clickeó — no se llena el Space de mensajes de error ajenos.
- Si alguien ya la marcó, el segundo click te avisa a vos quién fue, sin duplicar nada.
- Si la tarea espera a otra que todavía no está hecha, se marca igual y la respuesta lo
  aclara.
- El botón **Ver todas** del pie abre la plataforma cuando hay más tareas de las que
  entran en la tarjeta.

### Vincular el Space de un departamento (administrador)

1. Creá el Space en Google Chat y agregá el grupo `depto-` + el slug del departamento
   + `@dcsmart.app` (por ejemplo `depto-finanzas@dcsmart.app`) — con eso entran todos
   los del departamento de una.
2. Agregá la app **DC-PLATAFORMA** al Space. Te va a saludar y listar los
   departamentos disponibles.
3. Escribí `/vincular` y el nombre del departamento. Por ejemplo:

   ```
   /vincular finanzas
   ```

Desde ese momento el recordatorio diario llega a ese Space. Para que deje de llegar,
`/desvincular` (o sacar la app del Space, que también limpia la vinculación).

Para cambiar los umbrales de escalamiento de un departamento:

```json
PATCH /api/departamentos/:id/notificaciones
{ "dias_aviso_departamento": 2, "dias_aviso_direccion": 5 }
```

Un departamento **sin** Space se sigue evaluando igual — sus tareas atrasadas llegan a
Dirección — pero no recibe su propio recordatorio hasta que se le vincule uno.

### El Space de Dirección ve todos los departamentos

El Space que se vincule a **Dirección** es distinto de los demás: desde ahí, los
comandos dejan de estar acotados a un solo departamento.

- `/hoy`, `/atrasadas`, `/mias`, `/tarea`, `/local`, `/resumen` y `/equipo` traen la
  información de **los 11 departamentos mezclada**, y cada línea aclara de cuál es
  (`[Costos]`, `[RRHH]`, etc.).
- `/marcar`, `/tomar`, `/pasar` y `/nota` — y sus versiones en formulario `/asignar`,
  `/derivar`, `/apuntar` y `/tildar` — actúan sobre la tarea que encuentren, sea de qué
  departamento sea.

Quien escribe desde ese Space obtiene esta visión completa **sin importar su propio
departamento** — el control es formar parte del Space, no la ficha de la persona. Por
eso conviene armar ese grupo con cuidado de a quién se agrega: equivale, dentro de Chat,
al mismo nivel de acceso que un administrador.

## Preguntas frecuentes

**Marqué una tarea por error, ¿la puedo destildar?**
Por ahora no desde la pantalla — pedile al administrador que la reabra desde el
calendario del departamento.

**¿Puedo tener una tarea sin fecha todavía?**
Sí. Si creás la asignación pero no le definís agenda, queda "sin agenda definida"
hasta que alguien la complete.

**¿Un local puede tener una fecha distinta a otro para la misma tarea?**
Sí, esa es la idea — cada asignación (tarea + local) tiene su propia agenda.

**Mi departamento no recibe los avisos de Chat.**
Le falta vincular el Space. Sus tareas atrasadas igual escalan a Dirección; pedile a un
administrador que escriba `/vincular` y el nombre del departamento en ese Space.

**No veo el menú de "Tareas" ni "Agenda".**
Son solo para administradores. Pedí acceso a quien administra la plataforma.
