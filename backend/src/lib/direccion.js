// Slug del departamento "Dirección", compartido entre el job de avisos (que lo
// usa para saber a quién escalar) y los comandos de Chat (que lo usan para
// activar el "modo todo" -- ver chat-comandos.js). Un solo lugar para no
// terminar con dos slugs configurables por separado que se puedan desalinear.
export const SLUG_DIRECCION = process.env.AVISO_SLUG_DIRECCION || 'direccion'
