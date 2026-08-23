import { notFound } from "next/navigation"

import { titularPorToken } from "@/lib/email/baja"
import { darDeBaja } from "./actions"

// La página que abre el "Darse de baja" al pie de un aviso de la clínica.
//
// SIN SESIÓN, Y EL TOKEN ES LA ÚNICA CREDENCIAL — mismo molde que `/f/[token]`:
//
//  · Se lee con `service_role` (el visitante es anónimo) y cada consulta lleva su filtro explícito.
//  · El token es un uuid (122 bits): no se adivina. Se valida la FORMA antes de tocar la base.
//  · Un token que no existe da 404, igual que cualquier otra falla. Distinguirlos confirmaría que
//    un token existe.
//  · `noindex`: es una URL pública con un dato privado.
//
// LO QUE SE MUESTRA ES EL MÍNIMO: el nombre de la clínica —para que se entienda de quién se está
// dando de baja, que es la pregunta real cuando alguien recibe correo de varias— y la dirección
// afectada. Nada más del titular sale de acá.
//
// SIN JAVASCRIPT TAMBIÉN FUNCIONA: es un `<form>` con una server action. Quien se da de baja suele
// hacerlo desde el cliente de correo, y una página que exige JS para desuscribirse es una página
// que no deja desuscribirse.

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Darse de baja · Tuvetia",
  robots: { index: false, follow: false },
}

export default async function BajaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const titular = await titularPorToken(token)
  if (!titular) notFound()

  const deQuien = titular.clinica ?? "tu clínica"

  async function confirmar(formData: FormData) {
    "use server"
    await darDeBaja(token, (formData.get("motivo") as string | null) ?? null)
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 px-6 py-10">
      <div className="rounded-2xl border bg-card p-6">
        {titular.yaDeBaja ? (
          <>
            <h1 className="text-lg font-semibold">Ya estabas dado de baja</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              No vas a recibir más avisos de {deQuien} en {titular.email}.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold">¿Dejar de recibir avisos de {deQuien}?</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Dejaríamos de escribirte a <b className="text-foreground">{titular.email}</b> con
              recordatorios y novedades.
            </p>

            {/* LO QUE SIGUE LLEGANDO, DICHO ANTES DE CONFIRMAR y no en la letra chica: quien se da
                de baja creyendo que apaga todo y después recibe una factura piensa que no se
                respetó su decisión. Se respetó — es otra cosa. */}
            <p className="mt-3 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              Vas a seguir recibiendo lo que tiene que ver con tu cuenta: facturas, recordatorios de
              pago y respuestas a lo que escribas. Eso no es publicidad y no se puede desactivar.
            </p>

            <form action={confirmar} className="mt-4 flex flex-col gap-3">
              <label className="text-xs text-muted-foreground">
                Si querés, contanos por qué (opcional)
                <input
                  name="motivo"
                  maxLength={500}
                  className="mt-1 w-full rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </label>
              <button
                type="submit"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110"
              >
                Sí, darme de baja
              </button>
            </form>
          </>
        )}
      </div>
      <p className="text-center text-xs text-muted-foreground">Tuvetia</p>
    </main>
  )
}
