import { conPermisos, departamentosCon, departamentosDe, esAdminGlobal, puede, usuarioActual } from '../lib/permisos.js'
import { describirEquipo, formatearUserCode, nombrePorDefecto, normalizarUserCode, pedidoVigente } from '../lib/tv-conexion.js'
import { infoDepartamentos } from '../lib/colores-depto.js'

// Pantallas de TV (kiosko) desde la app: confirmar la conexion que pide una
// TV (el paso del celular del Device Authorization Grant, ver
// lib/tv-conexion.js) y administrar las pantallas ya conectadas.
//
// Permisos (decision del usuario, 2026-09-27): conecta una TV cualquiera que
// VEA la agenda (Miembro en adelante); la TV muestra lo que esa persona puede
// ver, re-verificado en cada consulta. La administra quien la conecto o
// Direccion; el OWNER de un departamento que muestra la ve y la puede desconectar.

// Adivinar un codigo ajeno es el riesgo real del flujo: se limita por persona
// (despues de authenticate, por eso el hook preHandler), no por IP.
const LIMITE_POR_PERSONA = {
  max: 20,
  timeWindow: '10 minutes',
  hook: 'preHandler',
  keyGenerator: (request) => `pantallas:${request.user?.id || request.ip}`
}

const MAX_NOMBRE = 60
const MAX_DEPARTAMENTOS = 20
// Aprobada pero la TV nunca retiro su token (se apago, perdio la red): pasado
// esto ya no lo va a retirar (el pedido vence a los 10 min).
const MINUTOS_SIN_RETIRAR = 15

async function colores(db) {
  return infoDepartamentos(await db.departamento.findMany({ where: { activo: true }, select: { id: true, nombre: true } }))
}

function conColor(info, d) {
  const i = info.get(d.id)
  return { id: d.id, nombre: d.nombre, abreviatura: i?.abreviatura, color: i?.color }
}

// Departamentos que la persona puede elegir para una TV: los que puede ver.
// Se calcula aca y no en el navegador: GET /api/departamentos devuelve todos.
async function departamentosElegibles(db, usuario) {
  const ids = departamentosCon(usuario, 'ver') // null = todos (Direccion / admin)
  return db.departamento.findMany({
    where: { activo: true, ...(ids ? { id: { in: ids } } : {}) },
    select: { id: true, nombre: true },
    orderBy: { nombre: 'asc' }
  })
}

// Valida la lista que manda el celular: nunca se confia en ella tal cual.
async function validarDepartamentos(db, usuario, ids) {
  if (!Array.isArray(ids) || !ids.length) return { error: 'Elegí al menos un departamento.' }
  const unicos = [...new Set(ids.map(String))]
  if (unicos.length > MAX_DEPARTAMENTOS) return { error: `Como mucho ${MAX_DEPARTAMENTOS} departamentos por pantalla.` }
  const departamentos = await db.departamento.findMany({ where: { id: { in: unicos }, activo: true }, select: { id: true, nombre: true } })
  if (departamentos.length !== unicos.length) return { error: 'Algún departamento ya no existe o está desactivado.' }
  const ajeno = departamentos.find((d) => !puede(usuario, 'ver', d.id))
  if (ajeno) return { error: `No podés mostrar ${ajeno.nombre} en una pantalla: no ves esa agenda.` }
  return { departamentos: departamentos.sort((a, b) => a.nombre.localeCompare(b.nombre)) }
}

function limpiarNombre(nombre) {
  const limpio = String(nombre || '').replace(/\s+/g, ' ').trim()
  return limpio ? limpio.slice(0, MAX_NOMBRE) : null
}

export default async function pantallasRoutes(fastify) {
  // Funcion y no un objeto compartido: @fastify/rate-limit agrega su chequeo
  // con push() sobre el arreglo preHandler de cada ruta limitada, y con un
  // mismo arreglo para todas el limite de "adivinar codigos" se colaba en la
  // lista y en editar/desconectar.
  const conSesion = () => ({ preHandler: [fastify.authenticate] })

  // --- Confirmar la conexion que pide una TV ---

  async function pedidoDe(request, reply) {
    const codigo = normalizarUserCode(request.params.codigo)
    const conexion = codigo && await fastify.db.tvConexion.findUnique({ where: { user_code: codigo } })
    if (!conexion) {
      reply.code(404).send({ error: 'No encontramos ese código. Revisá que sea el que muestra la pantalla.' })
      return null
    }
    if (conexion.estado === 'RECHAZADA') {
      reply.code(410).send({ error: 'Esa conexión se rechazó. La pantalla ya muestra un código nuevo.' })
      return null
    }
    if (conexion.estado !== 'PENDIENTE') {
      reply.code(410).send({ error: 'Ese código ya se usó. Si la pantalla sigue mostrando un QR, escaneá el nuevo.' })
      return null
    }
    if (!pedidoVigente(conexion)) {
      reply.code(410).send({ error: 'Ese código venció. La pantalla ya muestra uno nuevo: escanealo otra vez.' })
      return null
    }
    return conexion
  }

  fastify.get('/conexion/:codigo', { ...conSesion(), config: { rateLimit: LIMITE_POR_PERSONA } }, async (request, reply) => {
    const conexion = await pedidoDe(request, reply)
    if (!conexion) return reply
    const usuario = await usuarioActual(fastify, request)
    const [elegibles, info] = await Promise.all([departamentosElegibles(fastify.db, usuario), colores(fastify.db)])
    const ahora = Date.now()
    return {
      codigo: formatearUserCode(conexion.user_code),
      equipo: describirEquipo(conexion.user_agent),
      pedido_hace_seg: Math.max(0, Math.round((ahora - conexion.created_at.getTime()) / 1000)),
      vence_en_seg: Math.max(0, Math.round((conexion.expira_at.getTime() - ahora) / 1000)),
      departamentos: elegibles.map((d) => conColor(info, d))
    }
  })

  fastify.post('/conexion/:codigo/aprobar', { ...conSesion(), config: { rateLimit: LIMITE_POR_PERSONA } }, async (request, reply) => {
    const conexion = await pedidoDe(request, reply)
    if (!conexion) return reply
    const usuario = await usuarioActual(fastify, request)
    const { departamentos, error } = await validarDepartamentos(fastify.db, usuario, request.body?.ids_departamento)
    if (error) return reply.code(400).send({ error })
    const nombre = limpiarNombre(request.body?.nombre) || nombrePorDefecto(departamentos.map((d) => d.nombre))

    try {
      const pantalla = await fastify.db.$transaction(async (tx) => {
        const creada = await tx.tvPantalla.create({
          data: {
            nombre,
            conectada_por: usuario.email,
            user_agent: conexion.user_agent,
            departamentos: { create: departamentos.map((d) => ({ id_departamento: d.id })) }
          }
        })
        // Atomico: si dos celulares aprueban el mismo codigo a la vez, gana uno.
        const cambio = await tx.tvConexion.updateMany({
          where: { id: conexion.id, estado: 'PENDIENTE', expira_at: { gte: new Date() } },
          data: { estado: 'APROBADA', id_pantalla: creada.id, resuelta_por: usuario.email }
        })
        if (cambio.count !== 1) throw Object.assign(new Error('Ese código ya no está disponible.'), { statusCode: 409 })
        return creada
      })
      request.log.info({ pantalla: pantalla.id, departamentos: departamentos.map((d) => d.id), por: usuario.email }, 'pantallas: TV conectada')
      return { pantalla: { id: pantalla.id, nombre: pantalla.nombre, departamentos: departamentos.map((d) => d.nombre) } }
    } catch (err) {
      if (err.statusCode === 409) return reply.code(409).send({ error: err.message })
      throw err
    }
  })

  fastify.post('/conexion/:codigo/rechazar', { ...conSesion(), config: { rateLimit: LIMITE_POR_PERSONA } }, async (request, reply) => {
    const conexion = await pedidoDe(request, reply)
    if (!conexion) return reply
    const usuario = await usuarioActual(fastify, request)
    const cambio = await fastify.db.tvConexion.updateMany({
      where: { id: conexion.id, estado: 'PENDIENTE' },
      data: { estado: 'RECHAZADA', resuelta_por: usuario.email }
    })
    if (cambio.count !== 1) return reply.code(409).send({ error: 'Ese código ya no está disponible.' })
    request.log.info({ conexion: conexion.id, por: usuario.email }, 'pantallas: conexion rechazada')
    return { ok: true }
  })

  // --- Pantallas conectadas ---

  // Los departamentos que la persona puede poner en una pantalla (para
  // "Cambiar agendas" de una ya conectada).
  fastify.get('/departamentos', conSesion(), async (request) => {
    const usuario = await usuarioActual(fastify, request)
    const [elegibles, info] = await Promise.all([departamentosElegibles(fastify.db, usuario), colores(fastify.db)])
    return { departamentos: elegibles.map((d) => conColor(info, d)) }
  })

  // Quien administra una pantalla: quien la conecto o Direccion. El OWNER de
  // un departamento que muestra, ademas, la puede desconectar.
  function permisosSobre(usuario, pantalla) {
    const admin = esAdminGlobal(usuario)
    const propia = pantalla.conectada_por === usuario.email
    const ownerDeAlguno = pantalla.departamentos.some((pd) => puede(usuario, 'administrar', pd.id_departamento))
    return { editar: admin || propia, desconectar: admin || propia || ownerDeAlguno }
  }

  async function pantallaPara(request, reply, accion) {
    const pantalla = await fastify.db.tvPantalla.findUnique({ where: { id: request.params.id }, include: { departamentos: true } })
    if (!pantalla?.activa) {
      reply.code(404).send({ error: 'Esa pantalla ya no está conectada.' })
      return {}
    }
    const usuario = await usuarioActual(fastify, request)
    if (!permisosSobre(usuario, pantalla)[accion]) {
      reply.code(403).send({ error: accion === 'editar' ? 'Esta pantalla la administra quien la conectó (o Dirección).' : 'No podés desconectar esta pantalla.' })
      return {}
    }
    return { pantalla, usuario }
  }

  fastify.get('/', conSesion(), async (request) => {
    const usuario = await usuarioActual(fastify, request)
    const admin = esAdminGlobal(usuario)
    const idsOwner = departamentosDe(usuario).filter((id) => puede(usuario, 'administrar', id))

    // Las aprobadas que la TV nunca retiro ya no se van a completar: se
    // desactivan solas en vez de quedar en la lista para siempre.
    await fastify.db.tvPantalla.updateMany({
      where: { activa: true, token_hash: null, created_at: { lt: new Date(Date.now() - MINUTOS_SIN_RETIRAR * 60 * 1000) } },
      data: { activa: false, desconectada_por: 'sin-completar' }
    })

    const pantallas = await fastify.db.tvPantalla.findMany({
      where: {
        activa: true,
        ...(admin ? {} : { OR: [{ conectada_por: usuario.email }, { departamentos: { some: { id_departamento: { in: idsOwner } } } }] })
      },
      include: { departamentos: { include: { departamento: { select: { id: true, nombre: true, activo: true } } } } },
      orderBy: { created_at: 'desc' }
    })

    const info = await colores(fastify.db)
    // Lo que muestra cada TV depende de lo que HOY ve quien la conecto: se
    // marca lo que dejo de ver, para que se entienda por que no aparece.
    const duenios = new Map()
    async function duenio(email) {
      if (!duenios.has(email)) {
        const u = await fastify.db.extUser.findUnique({ where: { email } })
        duenios.set(email, u?.activo ? await conPermisos(fastify.db, u) : null)
      }
      return duenios.get(email)
    }

    const lista = []
    for (const p of pantallas) {
      const dueno = await duenio(p.conectada_por)
      const permisos = permisosSobre(usuario, p)
      lista.push({
        id: p.id,
        nombre: p.nombre,
        conectada_por: p.conectada_por,
        conectada_por_nombre: dueno?.nombre || p.conectada_por.split('@')[0],
        duenio_activo: !!dueno,
        creada: p.created_at,
        ultima_conexion: p.ultima_conexion_at,
        esperando_tv: !p.token_hash,
        equipo: describirEquipo(p.user_agent),
        departamentos: p.departamentos
          .map((pd) => ({ ...conColor(info, pd.departamento), se_muestra: !!dueno && pd.departamento.activo && puede(dueno, 'ver', pd.departamento.id) }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre)),
        puede_editar: permisos.editar,
        puede_desconectar: permisos.desconectar
      })
    }
    return { pantallas: lista }
  })

  // Renombrar y/o cambiar las agendas. Si alguien distinto de quien la conecto
  // (Direccion) cambia las agendas, la pantalla pasa a su nombre: desde ahi
  // muestra lo que ELLA eligio, con sus permisos.
  fastify.patch('/:id', conSesion(), async (request, reply) => {
    const { pantalla, usuario } = await pantallaPara(request, reply, 'editar')
    if (!pantalla) return reply
    const data = {}
    if (request.body?.nombre !== undefined) {
      const nombre = limpiarNombre(request.body.nombre)
      if (!nombre) return reply.code(400).send({ error: 'El nombre no puede quedar vacío.' })
      data.nombre = nombre
    }
    let departamentos = null
    if (request.body?.ids_departamento !== undefined) {
      const r = await validarDepartamentos(fastify.db, usuario, request.body.ids_departamento)
      if (r.error) return reply.code(400).send({ error: r.error })
      departamentos = r.departamentos
      if (pantalla.conectada_por !== usuario.email) data.conectada_por = usuario.email
    }
    await fastify.db.$transaction(async (tx) => {
      if (Object.keys(data).length) await tx.tvPantalla.update({ where: { id: pantalla.id }, data })
      if (departamentos) {
        await tx.tvPantallaDepartamento.deleteMany({ where: { id_pantalla: pantalla.id } })
        await tx.tvPantallaDepartamento.createMany({ data: departamentos.map((d) => ({ id_pantalla: pantalla.id, id_departamento: d.id })) })
      }
    })
    return { ok: true, a_tu_nombre: !!data.conectada_por }
  })

  // Desconectar: la TV recibe 401 en su proxima consulta (1 min) y vuelve al QR.
  fastify.delete('/:id', conSesion(), async (request, reply) => {
    const { pantalla, usuario } = await pantallaPara(request, reply, 'desconectar')
    if (!pantalla) return reply
    await fastify.db.tvPantalla.update({
      where: { id: pantalla.id },
      data: { activa: false, token_hash: null, desconectada_por: usuario.email }
    })
    request.log.info({ pantalla: pantalla.id, por: usuario.email }, 'pantallas: TV desconectada')
    return { ok: true }
  })
}
