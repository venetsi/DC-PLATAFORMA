import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // La pantalla Ayuda importa ../docs/MANUAL-DE-USO.md (una sola copia del
  // manual, la del repo): en desarrollo Vite tiene que poder servir la carpeta
  // de arriba. En el build se empaqueta igual, no hace falta nada mas.
  server: { fs: { allow: ['..'] } }
})
