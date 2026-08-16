// Igual que en `consultas/[id]`: la página es un Client Component y no puede exportar `metadata`.
// Este layout de servidor sólo le pone título a la pestaña y devuelve `children` sin envolver.

export const metadata = { title: "Importar pacientes · Tuvetia" }

export default function ImportarPacientesLayout({ children }: { children: React.ReactNode }) {
  return children
}
