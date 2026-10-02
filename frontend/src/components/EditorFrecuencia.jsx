import { DIAS_SEMANA, MAX_DIA_HABIL } from '../lib/agenda-texto.js'

// Editor de "cuándo" controlado: `valor` tiene la forma de valorInicial()
// (lib/agenda-texto.js). Lo usan crear tarea y los cambios en lote de Agendas.
export default function EditorFrecuencia({ valor, onChange }) {
  const set = (campo, v) => onChange({ ...valor, [campo]: v })
  function toggleDia(d) {
    set('diasSemana', valor.diasSemana.includes(d) ? valor.diasSemana.filter((x) => x !== d) : [...valor.diasSemana, d])
  }

  return (
    <div className="editor-frecuencia">
      <select value={valor.tipo} onChange={(e) => set('tipo', e.target.value)} aria-label="Frecuencia">
        <option value="DIARIA_HABIL">Lunes a viernes</option>
        <option value="DIARIA">Todos los días</option>
        <option value="SEMANAL">Algunos días de la semana</option>
        <option value="INTERVALO_MESES">Un día del mes</option>
        <option value="DIA_HABIL">Un día hábil del mes</option>
        <option value="UNICA">Una sola vez</option>
        {valor.tipo === 'FECHAS' && <option value="FECHAS">Fechas exactas (de planilla)</option>}
      </select>

      {valor.tipo === 'DIA_HABIL' && (
        <span className="en-linea" title="Cuenta de lunes a viernes; no descuenta feriados">
          día hábil
          <input type="number" min="1" max={MAX_DIA_HABIL} value={valor.diaHabil} onChange={(e) => set('diaHabil', e.target.value)} aria-label="Día hábil del mes" />
          de cada mes (lunes a viernes)
        </span>
      )}

      {valor.tipo === 'SEMANAL' && (
        <div className="dias-semana" role="group" aria-label="Días de la semana">
          {DIAS_SEMANA.map((d) => (
            <button
              key={d.valor}
              type="button"
              className={valor.diasSemana.includes(d.valor) ? 'dia on' : 'dia'}
              aria-pressed={valor.diasSemana.includes(d.valor)}
              onClick={() => toggleDia(d.valor)}
            >
              {d.etiqueta}
            </button>
          ))}
        </div>
      )}

      {valor.tipo === 'INTERVALO_MESES' && (
        <span className="en-linea">
          día
          <input type="number" min="1" max="31" value={valor.diaHasta} onChange={(e) => set('diaHasta', e.target.value)} aria-label="Día del mes" />
          <select value={valor.cadaNMeses} onChange={(e) => set('cadaNMeses', Number(e.target.value))} aria-label="Cada cuántos meses">
            <option value={1}>de cada mes</option>
            <option value={2}>cada 2 meses</option>
            <option value={3}>cada 3 meses</option>
            <option value={6}>cada 6 meses</option>
            <option value={12}>una vez por año</option>
          </select>
        </span>
      )}

      {valor.tipo === 'FECHAS' ? (
        <span className="en-linea" title="Se cargan desde una planilla; para cambiarlas hay que volver a cargarlas">
          {valor.fechas?.length || 0} fechas, del {[...(valor.fechas || [])].sort()[0]} al {[...(valor.fechas || [])].sort().slice(-1)[0]}
        </span>
      ) : valor.tipo === 'UNICA' ? (
        <span className="en-linea">
          el <input type="date" value={valor.fecha} onChange={(e) => set('fecha', e.target.value)} aria-label="Fecha" />
        </span>
      ) : (
        <span className="en-linea">
          desde <input type="date" value={valor.desde} onChange={(e) => set('desde', e.target.value)} aria-label="Desde" />
        </span>
      )}
    </div>
  )
}
