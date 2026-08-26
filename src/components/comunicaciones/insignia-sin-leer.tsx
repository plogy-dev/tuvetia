"use client"

// Cuántos mensajes de WhatsApp esperan respuesta, en la barra lateral.
//
// ── EL DEFECTO ────────────────────────────────────────────────────────────────────────────────
//
// Hasta ahora no había NINGUNA señal de que llegó un mensaje: había que entrar a Comunicaciones y
// mirar. Un vet con un paciente delante no entra a mirar, así que un titular podía escribir a las
// 9 y que nadie lo viera hasta la tarde.
//
// El dato ya existía —los entrantes sin `read_at` son exactamente eso— y sólo faltaba sacarlo de
// esa pantalla.
//
// ── POR QUÉ NO SE CUENTA EN EL LAYOUT ─────────────────────────────────────────────────────────
//
// Sería lo obvio: el layout del dashboard ya consulta cosas y podría traer el número. Pero ese
// layout se midió el 23-ago en 1.023 ms y se le sacaron dos viajes de red a mano; un `getUser()`
// solo cuesta 265 ms. Contar ahí le agregaría un viaje A TODAS LAS PANTALLAS —tablero, pacientes,
// agenda, ventas— para pintar un número que interesa en una.
//
// Se cuenta acá, después de pintar. La barra aparece de inmediato y el número llega cuando llega:
// una insignia que tarda 200 ms no le arruina el día a nadie, y medio segundo de más en cada
// navegación sí.
//
// ── SE RECUENTA, NO SE INCREMENTA ─────────────────────────────────────────────────────────────
//
// Sumar uno por cada entrante y restar uno por cada lectura parece más barato y se desincroniza
// solo: la bandeja marca de a MUCHOS al abrir una conversación, puede haber dos pestañas abiertas,
// y un evento perdido deja el número mal PARA SIEMPRE — sin forma de que se arregle.
//
// Un `count` con `head: true` no trae filas: es una consulta barata, y siempre da la verdad.
//
// ── Y SE PONE AL DÍA EN CADA RECONEXIÓN ───────────────────────────────────────────────────────
//
// Realtime pierde eventos mientras el socket está caído —portátil suspendido, cambio de red, un
// despliegue— y esos no se reenvían nunca. Es la misma lección que ya está escrita en la bandeja:
// se recuenta en cada `SUBSCRIBED`, que es el primero y el de cada reconexión.

import { useEffect, useRef, useState } from "react"

import { createClient } from "@/lib/supabase/client"

/** Ráfagas: abrir una conversación marca muchos mensajes de una y dispara un UPDATE por cada uno. */
const ESPERA_MS = 400

// CADA MONTAJE USA SU PROPIO CANAL, y no es estilo: supabase-js devuelve el MISMO RealtimeChannel
// cuando el topic se repite, y llamarle `.on()` a un canal ya suscrito LANZA («cannot add
// postgres_changes callbacks after subscribe()»). Con DOS consumidores de este hook montados a la
// vez —la insignia del sidebar y la campanita de la cabecera, que es el caso normal— el segundo
// tumbaba la app entera al error boundary (visto en producción, 26-ago, minutos después del
// deploy de la campanita). El sufijo por instancia le da un canal a cada montaje; los eventos de
// `postgres_changes` llegan igual a todos.
let instancia = 0

export function useMensajesSinLeer(): number {
  const [supabase] = useState(() => createClient())
  const [sinLeer, setSinLeer] = useState(0)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // La consulta es asíncrona y la insignia se desmonta al navegar: sin esta guarda, una respuesta
    // que llega tarde escribiría estado de un componente que ya no existe.
    let vivo = true

    const contar = async () => {
      // RLS acota a la clínica de la sesión; no hace falta filtrar por `clinic_id` acá.
      const { count } = await supabase
        .from("whatsapp_messages")
        .select("id", { count: "exact", head: true })
        .eq("direction", "inbound")
        .is("read_at", null)
      if (vivo) setSinLeer(count ?? 0)
    }

    const recontarPronto = () => {
      if (temporizador.current) clearTimeout(temporizador.current)
      temporizador.current = setTimeout(() => void contar(), ESPERA_MS)
    }

    void contar()
    const canal = supabase
      .channel(`mensajes-sin-leer-${++instancia}`)
      // INSERT: llegó uno nuevo. UPDATE: alguien lo leyó (o le cambió el estado).
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "whatsapp_messages" }, recontarPronto)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "whatsapp_messages" }, recontarPronto)
      .subscribe((estado) => {
        if (estado === "SUBSCRIBED") void contar()
      })

    return () => {
      vivo = false
      if (temporizador.current) clearTimeout(temporizador.current)
      void supabase.removeChannel(canal)
    }
  }, [supabase])

  return sinLeer
}

/**
 * La insignia del ítem de Comunicaciones.
 *
 * En la barra COLAPSADA se convierte en un punto: ahí el ítem mide 32 px y un número no cabe, pero
 * «hay algo esperando» sí se puede decir. Sin eso, colapsar la barra apagaría el aviso justo cuando
 * el vet la colapsó para tener más sitio — o sea, cuando está trabajando.
 */
export function InsigniaSinLeer() {
  const sinLeer = useMensajesSinLeer()
  if (sinLeer <= 0) return null
  return (
    <>
      <span
        aria-label={`${sinLeer} mensaje${sinLeer === 1 ? "" : "s"} sin leer`}
        className="ml-auto grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-on-brand group-data-[collapsible=icon]:hidden"
      >
        {sinLeer > 9 ? "9+" : sinLeer}
      </span>
      <span
        aria-hidden
        className="absolute right-1 top-1 hidden size-1.5 rounded-full bg-brand group-data-[collapsible=icon]:block"
      />
    </>
  )
}
