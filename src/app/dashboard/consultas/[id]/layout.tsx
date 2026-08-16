// Existe SÓLO para ponerle título a la pestaña.
//
// `page.tsx` de esta ruta es un Client Component —usa `useState` para el SOAP, el cuaderno y la
// grabación— y un Client Component no puede exportar `metadata`. Un layout de servidor en la misma
// carpeta sí, y no agrega ningún marcado: devuelve `children` tal cual.
//
// Sin esto, la pestaña de una consulta abierta decía "Tuvetia", igual que las otras veintiséis.

export const metadata = { title: "Consulta · Tuvetia" }

export default function ConsultaLayout({ children }: { children: React.ReactNode }) {
  return children
}
