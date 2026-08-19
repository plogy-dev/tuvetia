import { redirect } from "next/navigation"

// LA PUERTA ABRE EN EL TABLERO. Abría en Athos —"Athos primero", del mockup v2— y el cliente lo
// revirtió en la reunión del 17-ago: fue el PRIMER punto que planteó Luciano, entrar al dashboard y
// no al asistente.
//
// La razón es de jornada, no de gusto: al llegar a la clínica lo primero es cuántas citas hay hoy y
// qué quedó pendiente, no una caja de texto en blanco. Athos sigue a un clic en la barra, y ahora
// además hay una consulta en curso visible desde cualquier pantalla.
//
// SE REDIRIGE A `/dashboard/tablero` Y NO SE PINTA EL TABLERO ACÁ, por lo mismo que antes:
//
// cada pantalla tiene UNA sola URL. `onboarding-tour.tsx` ancla sus pasos en selectores como
// `a[href="/dashboard/tablero"]`, y el enlace del logo de la barra apunta a `/dashboard`: si el
// tablero viviera en las dos, `document.querySelector` devolvería el logo —es el primero del DOM— y
// el tour señalaría el sitio equivocado sin fallar ningún test.
//
// Con el redirect el ancla queda sin ambigüedad y los enlaces viejos a `/dashboard` siguen llegando
// a algún lado sensato.
export default function DashboardPage() {
  redirect("/dashboard/tablero")
}
