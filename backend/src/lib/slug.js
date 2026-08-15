// Administracion -> administracion: NFD separa la letra de la tilde en dos
// codepoints, y U+0300-U+036F son justamente las marcas diacriticas sueltas.
const MARCAS_DIACRITICAS = /[̀-ͯ]/g

export function aSlug(nombre) {
  return nombre
    .normalize('NFD')
    .replace(MARCAS_DIACRITICAS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}
