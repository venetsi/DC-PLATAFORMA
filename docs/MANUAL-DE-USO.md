# Manual de uso — DC-PLATAFORMA

DC-PLATAFORMA organiza las tareas periódicas de cada departamento: qué hay que
hacer, en qué local, cuándo, quién la tiene, y si ya se hizo. Todo vive en Google
Calendar y se opera desde la plataforma o desde Google Chat.

> Este manual es el que ves en **Ayuda** dentro de la plataforma. Se actualiza
> cada vez que cambia algo. Actualizado el 28/09/2026.

**Direcciones:**

| Para | Dirección |
|---|---|
| La plataforma (computadora o celular) | **dc-plataforma.dcsmart.app** |
| Una TV de oficina (pantalla del QR) | **tv.dcsmart.app** |

Si tenés guardada la dirección vieja (`dc-plataforma.web.app`), te lleva sola a la
nueva. La primera vez en la dirección nueva puede pedirte entrar de nuevo: tocá **Ir a
dcsmart** y después **Tareas**.

## Cómo entrar

1. En el sistema de dcsmart, tocá **Tareas** en el menú lateral.
2. Se abre DC-PLATAFORMA (**dc-plataforma.dcsmart.app**) en una pestaña nueva, ya
   con tu sesión. No hay contraseña aparte. Si entrás directo a esa dirección sin
   sesión, el botón **Ir a dcsmart** te lleva a entrar.

Para entrar tenés que estar en el grupo de Google de tu departamento
(`depto-<área>@dcsmart.app`, por ejemplo `depto-auditoria@dcsmart.app`). Si ves *"Tu
cuenta no está en ningún grupo de departamento"*, pedile al OWNER de tu grupo o a
Dirección que te agregue: en unos 15 minutos ya podés entrar.

Si tu email cambió en Google (por ejemplo, de una cuenta de área a una personal), la
plataforma te reconoce igual y entrás con tu cuenta nueva.

## Qué podés hacer según tu rol

Tu rol sale del grupo de Google de cada departamento. Si estás en varios grupos,
tenés un rol en cada uno.

| Rol en el grupo | Qué puede hacer en ese departamento |
|---|---|
| **Miembro** (MEMBER) | Ver agendas y tareas. Marcarlas hechas o "no aplica", tomarlas y dejar notas |
| **Manager** (MANAGER) | Todo lo anterior + crear y editar tareas, moverlas de día, pasarlas a otra persona, ver los reportes |
| **Owner** (OWNER) | Todo lo anterior + desactivar y eliminar tareas, y configurar los avisos del departamento |
| **Dirección** | Quien está en `depto-direccion@` ve y gestiona **todos** los departamentos, sin restricción |

Si pasás el mouse sobre tu email, arriba a la derecha, ves tu rol en cada
departamento. Lo que tu rol no permite directamente no aparece en pantalla.

## Mi agenda

Es la pantalla principal. Si estás en varios departamentos, arranca mostrando
**todos juntos**: cada tarea lleva una etiqueta de color con su departamento (ADM,
AUD, TES…) y arriba está la referencia. Con el selector de arriba ves uno solo.

Cinco vistas, con los botones de arriba (la plataforma recuerda la última que usaste):

- **Tablero**: como Trello. Una lista por departamento y una tarjeta por tarea
  abierta (las atrasadas de los últimos 60 días y lo pendiente de los próximos 30),
  ordenadas por vencimiento. La etiqueta de cada tarjeta dice cuándo vence: en rojo
  si está atrasada ("hace N d"), en amarillo si es de hoy. Tocá la tarjeta para ver
  el detalle; la **casilla** la marca hecha (pide confirmación, porque no se puede
  deshacer). Las tarjetas no se arrastran entre listas: la lista es el departamento.
  Los departamentos sin tareas abiertas aparecen **colapsados** y al final: una
  franja angosta con el nombre en vertical, para que el espacio quede para los que
  tienen tareas.
- **Calendario**: el mes completo.
- **Agenda**: la semana en curso, un día por columna, agrupado por local.
- **Cronograma**: una línea de tiempo de dos semanas, con una fila por
  departamento y un día por columna. Las tareas iguales del mismo día se juntan:
  *CMV ×12* quiere decir que se hace en 12 locales; tocala para ver cuáles. Con
  **‹ ›** avanzás o volvés de a una semana.
- **Semana (L-V)**: de lunes a viernes, armada como la pantalla de oficina: con
  las atrasadas y un adelanto de la semana que viene. Se explica abajo.

En el celular no aparece **Calendario**, porque no entra. El Tablero y el
Cronograma se deslizan de costado; Agenda y Semana se ven como una lista por día
(un día sin tareas ocupa una sola línea).

### La vista Semana (L-V)

- **Arriba**: el semáforo del día (🔴 hay atrasadas, 🟡 hay pendientes de hoy,
  🟢 todo al día) y cuántas tareas hay pendientes hoy, hechas hoy y atrasadas.
- **A la izquierda, Atrasadas**: todo lo que pasó su día sin hacerse en los últimos
  60 días, con la fecha y hace cuántos días venció. Las atrasadas de un día de
  la semana que estás viendo quedan en su día, en rojo; también aparecen acá las
  de sábado o domingo, que no tienen columna.
- **Al medio, de lunes a viernes**: cada día con sus tareas. Hoy está resaltado.
- **Abajo, Próxima semana**, más chica, con la misma información. Tocá una tarea
  para ver el detalle.

Cada tarea se muestra como **Tarea › Local** (por ejemplo, *Auditar › LOS GALGOS*),
ordenadas por tarea y local. Debajo va el responsable (→ nombre, o «equipo» si no
tiene uno fijo; ✓ nombre si ya está hecha) y, si depende de otra, su etiqueta:
⏳ **Espera a…** o 🔗 **Sigue con…** (ver
[Tareas que dependen de otra](#tareas-que-dependen-de-otra)).

Con las flechas **‹ ›** vas y volvés de semana, y **Hoy** te trae a la actual.
Sábado y domingo la vista arranca en la semana que viene. Las tareas "no aplica"
no se muestran en esta vista (sí en Agenda y Mes).

El punto de color de cada tarea indica cómo viene:

| Color | Estado |
|---|---|
| Amarillo | Pendiente, todavía no venció |
| Rojo | Atrasada: pasó su día sin hacerse |
| Verde | Hecha |
| Gris | No aplica |

Una tarea vence a la medianoche de su día (hora argentina).

### Sobre una tarea

Tocá cualquier tarea para ver su detalle: estado, responsable, su **cadena** (lo que
espera y con qué sigue, ver [Tareas que dependen de otra](#tareas-que-dependen-de-otra))
e historial (quién la marcó, notas, cambios de fecha). Desde ahí, según tu rol:

- **Marcar hecha**: queda registrada a tu nombre. Pide confirmación porque no se
  puede deshacer.
- **No aplica**: para cuando esa vez no correspondía (local cerrado, feriado, mes
  sin movimiento). Pide el motivo. No cuenta ni como hecha ni como atrasada, y
  tampoco se puede deshacer.
- **Cambiar fecha** (Manager y Owner): mueve **solo esa ocurrencia** a otro día. No
  cambia el resto de la agenda ni otros locales. Si la tarea está compartida con
  otro departamento, se mueve en los dos.
- **Editar** (Manager y Owner): cambiar el nombre de la tarea (en todos sus
  locales), el responsable en ese local, o la frecuencia en ese local.

### Mover y crear desde el calendario (Manager y Owner)

- En **Semana** o **Calendario**, **arrastrá** una tarea pendiente o atrasada a otro día
  para moverla. En Semana también podés arrastrar desde **Atrasadas** para
  reprogramarla, o soltarla en un día de la próxima semana. Aparece un aviso con
  **Deshacer** por si te equivocaste.
- Con el dedo (celular o tablet), arrastrar en **Semana** no anda en la mayoría de
  los equipos: tocá la tarea y usá **Cambiar fecha**. En **Calendario** (tablet) sí se
  puede: mantené apretada la tarea y arrastrala.
- Para crear una tarea en un día: en **Semana**, el **+** de ese día; en **Calendario**,
  tocá el día. También está el botón **+ Nueva tarea**. Arranca como "una sola
  vez, ese día", y la podés cambiar a cualquier frecuencia.

Las tareas hechas o "no aplica" no se pueden arrastrar.

## Mis tareas

Como Mi agenda, pero con lo que te toca a vos: las que están a tu nombre **más** las
de tus departamentos sin responsable fijo (esas las puede hacer cualquiera del
equipo). Muestra los últimos 60 días y las próximas 2 semanas, y arriba cuántas
tenés atrasadas, pendientes y hechas.

Con **Solo las que tengo asignadas** ves únicamente las que están a tu nombre.

## Agendas

Acá se ven y se gestionan todas las tareas de cada departamento: dónde se hace
(toda la empresa, un grupo de locales, o locales sueltos), cuándo, quién es
responsable, cuándo es la próxima y si hay atrasadas. Las que necesitan atención
aparecen primero. A la izquierda elegís el departamento; **Buscar** filtra por
tarea, local o grupo.

Siendo Miembro la ves en modo lectura. Siendo Manager u Owner:

- **+ Nueva tarea**: se crea en un solo paso. Completás qué, dónde, cuándo y
  quién, y una frase abajo te dice exactamente qué se va a crear antes de
  confirmar. En **Más opciones** podés compartirla con otros departamentos: cada
  uno la ve en su agenda, y marcarla en uno la marca en todos.
- **Una tarea, muchos locales**: el nombre no se repite, porque una misma tarea
  se hace en todos sus locales y se ve como «P&L — TI AMO», «P&L — UAT». Si en
  **+ Nueva tarea** ponés un nombre que ya existe, te ofrece **sumarle esos
  locales** con la agenda y el responsable que cargaste.
- **Cuándo** puede ser lunes a viernes, todos los días, algunos días de la
  semana, un día del mes, **un día hábil del mes** o una sola vez. El día hábil
  cuenta de lunes a viernes: el día hábil 10 es el décimo del mes sin sábados ni
  domingos. Los feriados no se descuentan.
- Tocá una tarea para ver sus locales. Tildá varios para **cambiar cuándo** o
  **cambiar responsable** a todos juntos, o para **quitarlos**. Con **+ Agregar
  locales** sumás un grupo o locales sueltos con la misma agenda.
- **Renombrar** y **Duplicar**. Duplicar copia la tarea con sus locales,
  frecuencia y responsable, desde hoy.
- **Opciones avanzadas**: agenda de un local puntual, compartir, y dependencias
  (ver abajo).

Siendo Owner, además: **Desactivar** (deja de agendarse desde hoy; el historial
queda), **Eliminar definitivamente**, y los **avisos de tu departamento** (webhook
de Chat y cuántos días hábiles de atraso disparan cada aviso).

Las agendas se crean por 6 meses y se renuevan solas mientras la tarea siga activa.

### Tareas que dependen de otra

Una tarea puede **esperar** a otra, incluso de otro departamento: por ejemplo, que
el reporte de Auditoría espere al CMV de Costos. Se configura en **Opciones
avanzadas → + Depende de otra tarea**: elegís el departamento, la tarea y el local.
Con **En todos los locales**, cada local de la tarea espera a la otra tarea en su
mismo local, sin cargarlos de a uno; si la otra tarea no está en algún local, te lo
dice.

**A qué espera.** Cada vez que le toca a la tarea, espera a la **última vez que le
tocó a la otra desde su fecha anterior**. Ejemplo: si el CMV es el día 1 y el
reporte el día 3, el reporte del 3 espera al CMV del 1. Si en ese tramo la otra
tarea no tuvo ninguna fecha, esa vez la dependencia no aplica. Una que quedó como
**no aplica** cuenta como resuelta.

**Qué se ve.** En todas las vistas (y en la TV), una etiqueta en la tarea:

| Ícono | Etiqueta | Qué quiere decir |
|---|---|---|
| ⏳ | **Espera a** Cierre de caja — Tesorería | Todavía falta lo que espera. Se puede marcar igual, pero te avisa. |
| ✅ | **Lista:** ya se hizo Cierre de caja | Ya no le falta nada: se puede hacer. |
| 🔗 | **Sigue con** Reporte de ventas — Auditoría | Cuando esta se hace, sigue esa otra: hay alguien esperándola. |

Si la otra tarea es de otro local, se agrega el local (por ejemplo, «Sigue con
P&L — Reportes · UAT»). Con varias, se muestra la primera y «y N más»; pasando el
mouse se ven todas. En **Calendario** y **Cronograma**, donde no entra la etiqueta
completa, queda solo el ícono ⏳ o 🔗 delante del nombre.

En el detalle, la **cadena** completa en el orden en que se hacen las cosas:

| Ícono | En la cadena |
|---|---|
| ✓ | Paso ya hecho (con quién y cuándo) |
| ⏳ | Paso pendiente o atrasado (con su fecha y responsable) |
| ⊘ | Paso que quedó como «no aplica» |
| ● | Esta tarea |
| ↓ | **Sigue con:** la tarea que viene después

**Avisa, no bloquea.** Si la marcás igual, se marca: la confirmación te dice qué
falta, queda anotado en el historial, y te avisa qué quedó pendiente.

**Aviso en Chat cuando se resuelve.** Cuando se marca la última tarea que otra
esperaba, llega un mensaje **Ya podés hacerla**, con el botón **Marcar hecha**:

- al **Space del departamento** de la tarea que esperaba, si tiene uno vinculado;
- en **privado a su responsable**, si tiene uno. Por ahora le llega solo a quien ya
  usó la app de Chat alguna vez; al resto, el aviso le llega por el Space.

Si esperaba a varias, el aviso sale cuando se completa la última.

## Reportes (Manager y Owner)

El tablero de cumplimiento muestra un mes a la vez (‹ › para cambiar):

- **Cumplimiento** del mes (hechas sobre el total de lo que ya venció) y la
  diferencia con el mes anterior, más hechas a tiempo, hechas tarde, atrasadas sin
  hacer y no aplica.
- **Por mes y departamento**: los últimos 6 meses. Tocá una celda para filtrar.
- **Días con tareas**: solo los días que tuvieron alguna.
- **Por grupo y local**: cada grupo se abre en sus locales, con cada tarea (en rojo
  las que tienen atrasadas).

Cuenta los días ya cerrados: lo de hoy aparece mañana. Si una atrasada se hace
después, pasa a "hecha tarde".

## Pantalla de oficina (kiosko)

Pensada para una TV fija en la oficina, sin login, que se actualiza sola cada
minuto. Puede mostrar una agenda o varias juntas, con la etiqueta de color de cada
departamento.

Arriba siempre muestra el semáforo (🔴 hay atrasadas, 🟡 hay pendientes de hoy, 🟢
todo al día) y los contadores. Debajo, la **vista** que se eligió al conectarla:

- **Semana**: las atrasadas de los últimos 60 días, la semana y un adelanto de la
  siguiente. Igual que en Mi agenda: cada tarea como **Tarea › Local**, con su
  responsable y si espera (⏳) o sigue con otra (🔗).
- **Tablero**: una lista por departamento, con las tareas abiertas por vencimiento
  (como el Tablero de Mi agenda). Los departamentos sin tareas abiertas se muestran
  al final, como una franja angosta, y el resto se reparte el ancho de la pantalla.
- **Calendario**: el mes completo, con las tareas de cada día.

Como en la TV no se puede deslizar, lo que no entra en una lista o en un día se
resume como *+N más*. Si se corta internet, sigue mostrando lo último y se reconecta
sola.

### Conectar una TV

**En la TV** (una sola vez):

1. Abrí el navegador de la TV y entrá a **tv.dcsmart.app**.
2. Aparece la pantalla *Conectá esta pantalla*, con un **código QR** grande y un
   **código de 6 letras** (por ejemplo `BCD-FGH`) abajo.

**En tu celular:**

3. Escaneá el QR con la cámara. Se abre **dc-plataforma.dcsmart.app/tv** con el
   código ya puesto.
   - Sin cámara: entrá a **dc-plataforma.dcsmart.app/tv** (o a **Pantallas** en el
     menú) y escribí el código.
   - Si no tenés la sesión abierta, la plataforma te pide entrar: tocá **Abrir
     dcsmart**, después **Tareas** en el menú de dcsmart, y volvés solo a la
     pantalla de conexión.
4. Revisá que el código y el equipo ("pedida hace 1 min desde Chrome en Android
   TV") sean los de la TV que tenés adelante.
5. Elegí qué agendas muestra (una o varias), **qué vista** (Semana, Tablero o
   Calendario), ponele un nombre (por ejemplo, *TV Tesorería*) y tocá **Conectar**.

**Listo:** en unos segundos la TV deja el QR y pasa sola a la agenda. Queda conectada
aunque se apague o se recargue.

Cosas a tener en cuenta:

- El código dura 10 minutos. Si nadie lo usa, la TV muestra uno nuevo sola.
- Si el código que ves en el celular no es el de tu TV, tocá **No reconozco esta
  pantalla**: se rechaza y la TV pide otro código.
- Cualquiera que vea una agenda la puede poner en una TV, y la TV muestra lo que
  **vos** podés ver: si dejás de ver un departamento, la TV deja de mostrarlo. Por eso
  conectala solo si tenés la pantalla adelante.
- Si una TV conectada vuelve a mostrar el QR, la desconectaron (o quien la conectó ya
  no ve esas agendas): conectala de nuevo con estos mismos pasos.

### Pantallas

En **Pantallas** ves las TVs que conectaste, con su estado (en línea, o desde cuándo
no se conecta) y la vista que muestra. Desde ahí podés **Cambiar agendas**, **Cambiar
vista**, **Renombrar** o **Desconectar**. La TV toma el cambio en menos de un minuto, y al desconectarla
vuelve a mostrar el QR. Dirección ve todas las pantallas. El Owner de un
departamento ve las que muestran su agenda y las puede desconectar.

Los links viejos del kiosko, los que tenían la clave del departamento, ya no andan:
esas TVs muestran el QR y hay que volver a conectarlas.

## Google Chat

### El recordatorio de todas las mañanas

De lunes a viernes a las 8, cada departamento con su Space vinculado recibe un
recordatorio con lo atrasado y lo que vence hoy, con un botón **Marcar hecha** por
tarea. La tarjeta se actualiza sola al marcar.

El atraso se cuenta en **días hábiles**. Pasado el umbral del departamento (por
defecto 2 días hábiles) la tarea aparece como atrasada; pasado el de Dirección (por
defecto 5), además entra en un mensaje consolidado a Dirección.

### «Ya podés hacerla»

Cuando se marca (desde la plataforma o desde Chat) la última tarea que otra
esperaba, llega un aviso al Space del departamento que esperaba y, en privado, a su
responsable. Trae el botón **Marcar hecha**, que funciona también desde el mensaje
privado. Ver [Tareas que dependen de otra](#tareas-que-dependen-de-otra).

### Comandos

Se escriben en el Space del departamento. No hace falta el nombre completo de la
tarea: con una parte alcanza, y si hay varias parecidas te pregunta cuál.

**Para mirar**

| Comando | Qué hace |
|---|---|
| `/hoy` | Las tareas que vencen hoy |
| `/atrasadas` | Lo que quedó sin hacer, de lo más viejo a lo más nuevo |
| `/mias` | Las tuyas + las del equipo sin responsable fijo |
| `/resumen` | Pendientes de hoy, atrasadas y % de cumplimiento |
| `/equipo` | Quién tiene qué y cuánto atraso arrastra cada uno |
| `/tarea cierre` | Estado, responsable, dependencias e historial (incluye las notas) |
| `/local tiamo` | Las tareas de un local; `/grupo aldos`, las de todo un grupo |
| `/ayuda` | La lista de comandos |

**Para hacer**

| Comando | Qué hace | Rol |
|---|---|---|
| `/marcar cierre` | La das por hecha | Miembro |
| `/tildar` | Formulario para marcar varias a la vez, de la más atrasada a la más nueva | Miembro |
| `/tomar cierre` | Queda a tu nombre | Miembro |
| `/asignar` | `/tomar` con formulario | Miembro |
| `/nota cierre: hablé con el proveedor` | Deja un comentario en el historial | Miembro |
| `/apuntar` | `/nota` con formulario | Miembro |
| `/pasar cierre: juan@dcsmart.app` | Se la pasa a otra persona | Manager |
| `/derivar` | `/pasar` con formulario | Manager |

`/marcar` y `/tildar` son los únicos que dan la tarea por hecha: `/tomar` y `/pasar`
solo cambian quién se encarga. Si la tarea espera a otra sin hacer, se marca igual
y te avisa. Si alguien ya la había marcado, te dice quién.

**Pagos de dcsmart**

| Comando | Qué hace |
|---|---|
| `/pago tiamo` | Elegís un pago reciente de ese local y le asignás una tarea y/o una persona |
| `/mispagos` | Los pagos que tenés pendientes de resolver |
| `/tildarpagos` | Marcás varios como resueltos |

**Preguntar**

| Comando | Qué hace |
|---|---|
| `/buscar cuál es la política de viáticos` | Gemini responde **solo** con los documentos cargados para tu departamento y los generales, y dice de qué documento salió |

**De administración** (Dirección)

| Comando | Qué hace |
|---|---|
| `/vincular` | Elegir qué departamento(s) cubre este Space |
| `/desvincular` | Que el Space deje de cubrir departamentos |
| `/departamentos` | Panorama de configuración de todos los departamentos |

### Spaces de Chat

- **Vincular un Space**: crear el Space, agregar el grupo `depto-<área>@dcsmart.app`
  y la app **DC-PLATAFORMA**, y escribir `/vincular` para elegir el departamento.
- **Un Space para varios departamentos**: en `/vincular` se tildan varios. Los
  comandos muestran todo junto, y cada línea dice de qué departamento es. El
  recordatorio diario va al primero tildado.
- **El Space de Dirección** ve y opera todos los departamentos. Equivale a
  administración: conviene cuidar a quién se agrega.

Si escribís desde un Space sin vincular, la app te muestra lo de tus propios
departamentos y te lo aclara.

## Preguntas frecuentes

**Marqué una tarea por error, ¿la puedo desmarcar?**
No: marcar hecha y "no aplica" son definitivos, por eso piden confirmación. Si fue
un error, avisale a Dirección.

**No veo Reportes (o no puedo crear tareas).**
Tu rol en el grupo es Miembro. Si necesitás más, pedile al Owner de tu grupo que te
haga Manager.

**No puedo entrar.**
No estás en ningún grupo `depto-*`. Pedí que te agreguen; en unos 15 minutos entrás.

**Veo una tarea que es de otro departamento.**
Está compartida con el tuyo: la ves en tu agenda y la podés marcar. Marcarla en un
departamento la marca en todos.

**En Semana (L-V) no veo una tarea del sábado.**
Esa vista muestra de lunes a viernes: si ya venció sin hacerse, está en
**Atrasadas**; si todavía no, usá **Calendario** (en la computadora o la tablet) o
**Agenda**.

**¿Un local puede tener otra fecha que otro para la misma tarea?**
Sí: cada local tiene su propia agenda. En Agendas, tildá solo ese local y usá
**Cambiar cuándo**.

**Mi departamento no recibe los avisos de Chat.**
Le falta un Space vinculado. Sus atrasadas igual escalan a Dirección. Pedile a
Dirección que escriba `/vincular` en el Space del departamento.

**La TV volvió a mostrar el QR.**
La desconectaron desde **Pantallas**, o quien la conectó ya no ve esas agendas.
Conectala de nuevo (ver *Conectar una TV*).

**Escaneé el QR y dice que el código venció o ya se usó.**
El código dura 10 minutos y sirve una sola vez. La TV ya muestra uno nuevo:
escanealo otra vez.

**La TV quedó en "Sin conexión".**
Se cortó internet en la TV. Sigue mostrando lo último que tenía y se reconecta sola
cuando vuelve la red; no hace falta escanear de nuevo.

**Tengo una TV con un link viejo (con `depto=` y `key=`).**
Esos links ya no andan. Abrí **tv.dcsmart.app** en esa TV y conectala con el QR.
