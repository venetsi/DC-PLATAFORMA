import { useEffect, useState } from 'react'

// Media queries desde JS, para lo que no se resuelve solo con CSS: sacar la
// vista Mes en celular y cambiar los textos de ayuda en pantallas tactiles
// (ahi arrastrar no es confiable). Mismo corte que index.css: 700px = celular.
export const CONSULTA_CELULAR = '(max-width: 700px)'
export const CONSULTA_TACTIL = '(pointer: coarse)'

export function useMedia(consulta) {
  const [coincide, setCoincide] = useState(() => typeof window !== 'undefined' && window.matchMedia(consulta).matches)
  useEffect(() => {
    const mq = window.matchMedia(consulta)
    const alCambiar = () => setCoincide(mq.matches)
    alCambiar()
    mq.addEventListener('change', alCambiar)
    return () => mq.removeEventListener('change', alCambiar)
  }, [consulta])
  return coincide
}
