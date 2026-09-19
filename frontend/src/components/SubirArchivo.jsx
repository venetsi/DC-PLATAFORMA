import { useRef, useState } from 'react'

// Dropzone simple para .txt/.md/.pdf -- inspirado en el de dcsmart
// (AdjuntoUpload.jsx) pero simplificado: sin cámara ni preview de imagen,
// acá solo entran los tres tipos que Gemini File Search soporta nativo.
const EXTENSIONES = '.txt,.md,.pdf'

export default function SubirArchivo({ onArchivo, disabled }) {
  const inputRef = useRef(null)
  const [sobreVuelo, setSobreVuelo] = useState(false)

  function elegirArchivo(lista) {
    const archivo = lista?.[0]
    if (archivo) onArchivo(archivo)
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setSobreVuelo(true) }}
      onDragLeave={() => setSobreVuelo(false)}
      onDrop={(e) => {
        e.preventDefault()
        setSobreVuelo(false)
        elegirArchivo(e.dataTransfer.files)
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      style={{
        border: `2px dashed ${sobreVuelo ? 'var(--teal)' : 'var(--texto-tenue)'}`,
        borderRadius: 8,
        padding: '1.5rem',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        color: 'var(--texto-tenue)'
      }}
    >
      Arrastrá un archivo .txt, .md o .pdf, o hacé click para elegirlo
      <input
        ref={inputRef}
        type="file"
        accept={EXTENSIONES}
        disabled={disabled}
        style={{ display: 'none' }}
        onChange={(e) => elegirArchivo(e.target.files)}
      />
    </div>
  )
}
