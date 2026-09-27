import { useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import manual from '../../../docs/MANUAL-DE-USO.md?raw'

// Ayuda = docs/MANUAL-DE-USO.md tal cual (el mismo archivo del repo), para que
// haya una sola copia del manual: cada cambio visible de la plataforma
// actualiza ese archivo y esta pantalla lo muestra en el proximo deploy.
// El HTML sale de un archivo propio empaquetado en el build (no de algo que
// escriba un usuario), por eso se inserta directo.

function sinAcentos(texto) {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}
function slug(texto) {
  return sinAcentos(texto).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// El manual partido en su introduccion + una seccion por cada "## ".
function partir(md) {
  const [intro, ...partes] = md.split(/^## /m)
  return {
    intro,
    secciones: partes.map((p) => {
      const [titulo, ...resto] = p.split('\n')
      const cuerpo = resto.join('\n')
      return { titulo: titulo.trim(), id: slug(titulo), cuerpo, texto: sinAcentos(`${titulo} ${cuerpo}`) }
    })
  }
}

export default function Ayuda() {
  const { intro, secciones } = useMemo(() => partir(manual), [])
  const [busqueda, setBusqueda] = useState('')
  const q = sinAcentos(busqueda.trim())
  const visibles = q ? secciones.filter((s) => s.texto.includes(q)) : secciones

  // Si se entra con #seccion (link directo), llevar ahi una vez renderizado.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (id) document.getElementById(id)?.scrollIntoView()
  }, [])

  return (
    <div className="ayuda">
      <nav className="ayuda-indice" aria-label="Secciones del manual">
        <input type="search" placeholder="Buscar en la ayuda" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar en la ayuda" />
        <ul>
          {visibles.map((s) => <li key={s.id}><a href={`#${s.id}`}>{s.titulo}</a></li>)}
        </ul>
        {q && !visibles.length && <p className="tenue">Nada coincide con "{busqueda}".</p>}
      </nav>
      <article className="md">
        {!q && <div dangerouslySetInnerHTML={{ __html: marked.parse(intro) }} />}
        {visibles.map((s) => (
          <section key={s.id} id={s.id}>
            <h2>{s.titulo}</h2>
            <div dangerouslySetInnerHTML={{ __html: marked.parse(s.cuerpo) }} />
          </section>
        ))}
      </article>
    </div>
  )
}
