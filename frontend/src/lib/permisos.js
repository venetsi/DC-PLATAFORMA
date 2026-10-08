import { useAuthStore } from '../store/authStore.js'

// Espejo de backend/src/lib/permisos.js, solo para mostrar u ocultar acciones:
// el backend vuelve a chequear cada pedido. Rol = el del Google Group del
// departamento (viene en /auth/me); Direccion y admin pueden todo en todos.
export const NIVEL_ROL = { MEMBER: 1, MANAGER: 2, OWNER: 3 }
// Ver es de toda la organizacion; modificar (marcar y editar), de quienes son del
// departamento; reportes, del Manager; lo irreversible, del Owner (ver el backend).
export const ACCIONES = { ver: 'TODOS', marcar: 'MEMBER', editar: 'MEMBER', reportes: 'MANAGER', administrar: 'OWNER' }
export const NOMBRE_ROL = { OWNER: 'Owner', MANAGER: 'Manager', MEMBER: 'Miembro' }

export function puedeCon({ esAdminGlobal, departamentos }, accion, idDepartamento) {
  if (esAdminGlobal || accion === 'ver') return true
  const d = departamentos.find((x) => x.id === idDepartamento)
  return !!d && NIVEL_ROL[d.rol || 'MEMBER'] >= NIVEL_ROL[ACCIONES[accion]]
}

export function usePermisos() {
  const esAdminGlobal = useAuthStore((s) => s.esAdminGlobal)
  const departamentos = useAuthStore((s) => s.departamentos)
  const sesion = { esAdminGlobal, departamentos }
  return {
    esAdminGlobal,
    puede: (accion, idDepartamento) => puedeCon(sesion, accion, idDepartamento),
    // ¿Puede hacer `accion` en al menos un departamento?
    enAlguno: (accion) => esAdminGlobal || departamentos.some((d) => puedeCon(sesion, accion, d.id)),
    // De una lista de departamentos, los que admiten `accion`.
    filtrar: (accion, lista) => (lista || departamentos).filter((d) => puedeCon(sesion, accion, d.id))
  }
}
