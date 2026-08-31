"use client"

// Avisar a los titulares por correo.
//
// ── SE VE A CUÁNTOS LE VA A LLEGAR, ANTES DE ESCRIBIR ─────────────────────────────────────────
//
// Es el freno más importante de esta pantalla y por eso el contador va arriba del formulario, no
// escondido en la confirmación. Un masivo se manda una vez y no se deshace: quien no sabe si le
// escribe a 12 personas o a 400 no está tomando una decisión, está apretando un botón.
//
// Se muestran también los DOS descartes —quién se dio de baja y quién no tiene correo— porque son
// la diferencia entre «mi lista es chica» y «mi lista está incompleta», y llevan a acciones
// distintas.
//
// ── POR QUÉ NO SE LLAMA «MARKETING» ───────────────────────────────────────────────────────────
//
// David lo propuso, y OkVet efectivamente tiene una pestaña con ese nombre. Pero esto manda SÓLO
// avisos operativos —un control que toca, un cambio de horario— que se apoyan en la relación que el
// titular ya tiene con la clínica. Lo comercial (promociones, descuentos) exige base legal bajo la
// Ley 1581 con consentimiento registrado, y no está construido.
//
// Un panel llamado «Marketing» invita a mandar promociones. El nombre tiene que decir lo que la
// función puede hacer, no lo que uno quisiera que hiciera.

import { useState, useTransition } from "react"
import { Megaphone, Send, Users } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { contarAudiencia, mandarAviso } from "@/lib/avisos/actions"

type Conteo = { total: number; deBaja: number; sinCorreo: number; tope: number }

export function PanelDeAvisos({
  segmentos,
  puedeEnviar,
}: {
  segmentos: { clave: string; etiqueta: string; ayuda: string }[]
  /** Sólo el administrador de la clínica: esto habla en nombre de ella. */
  puedeEnviar: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [segmento, setSegmento] = useState(segmentos[0]?.clave ?? "")
  const [conteo, setConteo] = useState<Conteo | null>(null)
  const [asunto, setAsunto] = useState("")
  const [cuerpo, setCuerpo] = useState("")

  const elegido = segmentos.find((s) => s.clave === segmento)

  function contar(clave: string) {
    setSegmento(clave)
    setConteo(null)
    startTransition(async () => {
      // La guarda que devuelve los botones (28-ago): si esta promesa RECHAZA —sesión vencida,
      // red caída, o un id de Server Action viejo tras un deploy— React nunca cierra la
      // transición e `isPending` deja los botones deshabilitados hasta recargar.
      try {
        const r = await contarAudiencia({ segmento: clave })
        if (r.ok) setConteo({ total: r.total, deBaja: r.deBaja, sinCorreo: r.sinCorreo, tope: r.tope })
        else toast.error(r.error)
    
      } catch (e) {
        toast.error(`No se pudo completar la acción: ${(e as Error)?.message ?? e}`)
      }
    })
  }

  function enviar() {
    if (!conteo || conteo.total === 0) {
      toast.error("Elegí un grupo con destinatarios.")
      return
    }
    // UNA CONFIRMACIÓN CON EL NÚMERO ADENTRO. «¿Estás seguro?» no informa nada; «le vas a escribir a
    // 137 personas» sí, y es lo último que se puede leer antes de que salga.
    const ok = window.confirm(
      `Le vas a escribir a ${conteo.total} ${conteo.total === 1 ? "titular" : "titulares"}.\n\n` +
        "Los correos salen ya y no se pueden retirar. ¿Seguimos?",
    )
    if (!ok) return

    startTransition(async () => {
      // La guarda que devuelve los botones (28-ago): si esta promesa RECHAZA —sesión vencida,
      // red caída, o un id de Server Action viejo tras un deploy— React nunca cierra la
      // transición e `isPending` deja los botones deshabilitados hasta recargar.
      try {
        const r = await mandarAviso({ segmento, asunto, cuerpo })
        if (!r.ok) {
          toast.error(r.error)
          return
        }
        const partes = [`${r.enviados} enviados`]
        if (r.excluidosPorBaja > 0) partes.push(`${r.excluidosPorBaja} de baja`)
        if (r.fallidos > 0) partes.push(`${r.fallidos} fallidos`)
        toast.success(partes.join(" · "))
        setAsunto("")
        setCuerpo("")
        contar(segmento)
    
      } catch (e) {
        toast.error(`No se pudo completar la acción: ${(e as Error)?.message ?? e}`)
      }
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <span className="block text-xs font-medium text-fg-muted">A quién</span>
        <div className="mt-1.5 flex flex-col gap-1.5">
          {segmentos.map((s) => (
            <button
              key={s.clave}
              type="button"
              onClick={() => contar(s.clave)}
              aria-pressed={segmento === s.clave}
              disabled={isPending || !puedeEnviar}
              className={`rounded-lg border px-3 py-2 text-left transition ${
                segmento === s.clave
                  ? "border-brand bg-brand/5"
                  : "border-line bg-surface hover:bg-surface-2"
              }`}
            >
              <span className="block text-sm font-medium text-fg">{s.etiqueta}</span>
              <span className="block text-xs text-fg-faint">{s.ayuda}</span>
            </button>
          ))}
        </div>
      </div>

      {/* EL NÚMERO, ARRIBA DEL FORMULARIO. Ver el comentario de cabecera. */}
      {elegido && (
        <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm">
          {conteo === null ? (
            <span className="text-fg-faint">
              {isPending ? "Contando…" : "Elegí un grupo para ver a cuántos le llega."}
            </span>
          ) : (
            <>
              <span className="flex items-center gap-2 font-medium text-fg">
                <Users className="size-4 text-fg-faint" aria-hidden />
                {conteo.total === 0
                  ? "No hay a quién mandarle"
                  : `${conteo.total} ${conteo.total === 1 ? "titular" : "titulares"}`}
              </span>
              {(conteo.deBaja > 0 || conteo.sinCorreo > 0) && (
                <span className="mt-1 block text-xs text-fg-muted">
                  {conteo.deBaja > 0 && `${conteo.deBaja} se dieron de baja`}
                  {conteo.deBaja > 0 && conteo.sinCorreo > 0 && " · "}
                  {conteo.sinCorreo > 0 && `${conteo.sinCorreo} sin correo cargado`}
                </span>
              )}
              {conteo.total >= conteo.tope && (
                <span className="mt-1 block text-xs text-warn">
                  Se manda como mucho a {conteo.tope} por envío.
                </span>
              )}
            </>
          )}
        </div>
      )}

      <div>
        <label htmlFor="asunto-aviso" className="block text-xs font-medium text-fg-muted">
          Asunto
        </label>
        <input
          id="asunto-aviso"
          value={asunto}
          onChange={(e) => setAsunto(e.target.value)}
          maxLength={150}
          disabled={!puedeEnviar}
          placeholder="Ej.: A Milo le toca su control anual"
          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      <div>
        <label htmlFor="cuerpo-aviso" className="block text-xs font-medium text-fg-muted">
          Mensaje
        </label>
        <textarea
          id="cuerpo-aviso"
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value)}
          rows={7}
          maxLength={4000}
          disabled={!puedeEnviar}
          placeholder="Escribí el aviso. Sale firmado con el nombre de tu clínica, y las respuestas te llegan a vos."
          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className="mt-1 text-xs text-fg-faint">
          Se le agrega solo un pie con el enlace de baja de cada titular. Darse de baja no afecta los
          correos de sus facturas.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={enviar} disabled={isPending || !puedeEnviar || !conteo?.total}>
          <Send className="size-4" aria-hidden />
          {isPending ? "Enviando…" : "Enviar aviso"}
        </Button>
        {!puedeEnviar && (
          <span className="text-xs text-fg-muted">
            Sólo un administrador de la clínica puede enviar avisos.
          </span>
        )}
      </div>

      {/* LO QUE ESTA PANTALLA NO HACE, dicho donde se lee. Sin esto, la primera pregunta de
          cualquiera es «¿y para mandar una promo?» — y la respuesta importa. */}
      <p className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-xs text-fg-muted">
        <Megaphone className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Esto es para <strong>avisos operativos</strong>: un control que toca, un cambio de horario,
          una indicación. Para promociones y descuentos hace falta el consentimiento comercial de
          cada titular (Ley 1581), y todavía no está construido.
        </span>
      </p>
    </div>
  )
}
