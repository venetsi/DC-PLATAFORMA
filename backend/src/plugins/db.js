import fp from 'fastify-plugin'
import { PrismaClient } from '@prisma/client'
import { opcionesPrisma } from '../lib/db-url.js'

// Pool acotado: la base es compartida con dcsmart (ver lib/db-url.js).
const prisma = new PrismaClient(opcionesPrisma())

async function dbPlugin(fastify) {
  await prisma.$connect()
  fastify.decorate('db', prisma)
  fastify.addHook('onClose', async () => {
    await prisma.$disconnect()
  })
}

export default fp(dbPlugin)
