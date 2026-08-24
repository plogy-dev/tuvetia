// La ranura del modal, vacía.
//
// Sin este archivo, Next no sabe qué pintar en `@modal` cuando la ruta interceptada no está activa
// —o sea, casi siempre— y la zona de ventas deja de renderizar. Devolver `null` es literalmente
// «acá no va nada por ahora».
export default function SinModal() {
  return null
}
