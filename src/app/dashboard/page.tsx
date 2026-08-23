import { redirect } from "next/navigation"

// LA PUERTA ABRE EN EL DASHBOARD.
//
// Estuvo abriendo en Athos ("Athos primero", del mockup v2). Se volvió atrás por pedido del
// cliente: entrar directo a una conversación vacía no dice cómo está la clínica, y el tablero —
// citas de hoy, notas por aprobar, consultas del mes— sí. Athos sigue a un clic en la barra, y el
// riel de configuración se mudó al tablero justamente para acompañar esta vuelta.
//
// POR QUÉ UN REDIRECT Y NO PINTAR EL TABLERO ACÁ. El ítem "Dashboard" del sidebar apunta a
// `/dashboard/tablero`. Si el tablero viviera también en `/dashboard`, habría dos URLs para la
// misma pantalla y el `isActive` del sidebar dejaría de marcarlo al entrar por la puerta.
//
// Con el redirect, cada pantalla tiene UNA sola URL y los enlaces viejos a `/dashboard` siguen
// llegando a algún lado sensato.
export default function DashboardPage() {
  redirect("/dashboard/tablero")
}
