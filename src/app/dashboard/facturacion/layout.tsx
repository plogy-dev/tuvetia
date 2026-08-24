// El armazón de la zona de ventas, con un hueco para el modal de «Registrar venta».
//
// ── POR QUÉ EXISTE ESTE LAYOUT ────────────────────────────────────────────────────────────────
//
// Sólo para declarar la ranura paralela `@modal`. La zona de ventas no necesitaba layout propio
// hasta ahora: cada pantalla trae su `PageShell` y sigue haciéndolo.
//
// ── QUÉ RESUELVE ──────────────────────────────────────────────────────────────────────────────
//
// En OkVet, «Registrar venta» abre un modal SOBRE el libro de ventas: se registra la cuenta y al
// cerrar se sigue exactamente donde se estaba, con los filtros y la página puestos. Acá era una
// navegación a otra pantalla, y volver significaba rearmar el filtro.
//
// Con ranura paralela + ruta interceptora (`@modal/(.)nueva`), `/dashboard/facturacion/nueva`:
//
//   · abre COMO MODAL cuando se llega navegando desde la zona de ventas;
//   · abre COMO PÁGINA COMPLETA si alguien pega la URL, recarga, o la comparte;
//   · se cierra con «atrás» del navegador, porque el modal ES una ruta y no un estado suelto.
//
// Ese último punto es el que no se puede imitar con un `useState`: un modal que no está en la URL
// se lleva el botón de atrás puesto — el vet aprieta atrás esperando cerrar el modal y se va del
// módulo entero.
//
// `@modal/default.tsx` devuelve `null`, que es lo que mantiene la ranura vacía cuando la ruta no
// está activa.

export default function LayoutDeVentas({
  children,
  modal,
}: {
  children: React.ReactNode
  modal: React.ReactNode
}) {
  return (
    <>
      {children}
      {modal}
    </>
  )
}
