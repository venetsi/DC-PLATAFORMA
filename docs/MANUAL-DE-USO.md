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

## Preguntas frecuentes

**Marqué una tarea por error, ¿la puedo destildar?**
Por ahora no desde la pantalla — pedile al administrador que la reabra desde el
calendario del departamento.

**¿Puedo tener una tarea sin fecha todavía?**
Sí. Si creás la asignación pero no le definís agenda, queda "sin agenda definida"
hasta que alguien la complete.

**¿Un local puede tener una fecha distinta a otro para la misma tarea?**
Sí, esa es la idea — cada asignación (tarea + local) tiene su propia agenda.

**No veo el menú de "Tareas" ni "Agenda".**
Son solo para administradores. Pedí acceso a quien administra la plataforma.
