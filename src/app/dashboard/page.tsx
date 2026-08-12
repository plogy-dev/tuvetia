import { redirect } from "next/navigation"

// ATHOS PRIMERO. `/dashboard` ya no es el tablero de métricas: es la puerta, y la puerta abre en
// Athos. Es la idea central del mockup v2 del cliente —se llama literalmente "Tuvetia · Athos
// primero"— y lo que su brief describe: el consultorio antes que el CRM.
//
// POR QUÉ UN REDIRECT Y NO PINTAR ATHOS ACÁ. El ítem "Athos" del sidebar apunta a
// `/dashboard/asistente`, y `onboarding-tour.tsx` ancla uno de sus pasos en
// `a[href="/dashboard/asistente"]`. Si Athos viviera en `/dashboard`, el ancla tendría que ser
// `a[href="/dashboard"]` — que también matchea el enlace del logo en la cabecera de la barra, y
// `document.querySelector` devuelve el PRIMERO del DOM. El tour terminaría señalando el logo en vez
// del ítem, sin fallar ningún test.
//
// Con el redirect, la pantalla de Athos tiene una sola URL, el ancla queda sin ambigüedad, y los
// enlaces viejos a `/dashboard` siguen llegando a algún lado sensato.
//
// El tablero completo no desaparece: vive en `/dashboard/tablero` y se llega desde el riel derecho
// de Athos ("La clínica hoy → Dashboard") y desde el sidebar.
export default function DashboardPage() {
  redirect("/dashboard/asistente")
}
