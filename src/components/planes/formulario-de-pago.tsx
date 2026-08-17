"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, Lock } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { tokenizarTarjeta } from "@/lib/wompi/tokenizar-tarjeta"
import { formatCOP } from "@/lib/facturacion/format"

// El formulario de la tarjeta.
//
// ── LO QUE PASA CON EL NÚMERO DE TARJETA ───────────────────────────────────────────────────────
//
// No sale de este componente hacia Tuvetia. `tokenizarTarjeta` habla con Wompi DIRECTO desde el
// navegador y devuelve un token; lo único que viaja a nuestra API es ese token. El número vive en
// el estado de React el tiempo que dura el formulario y desaparece con él.
//
// Por eso el `<form>` no tiene `action` y el envío es manual: un submit nativo mal configurado
// mandaría los campos a nuestro servidor, que es exactamente lo que se está evitando.
//
// ── POR QUÉ EL ÉXITO NO DICE "YA SOS PRO" ──────────────────────────────────────────────────────
//
// Wompi responde `PENDING` casi siempre: la aprobación llega por webhook, segundos después. Decir
// "listo, ya tenés Pro" y que la pantalla siga mostrando free al recargar es peor que decir la
// verdad, que es "estamos confirmando el pago".

type Paso = "datos" | "procesando" | "confirmando"

/** Sólo dígitos, en grupos de cuatro. Es formato de lectura, no validación. */
function formatearNumero(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 19)
  return d.replace(/(.{4})/g, "$1 ").trim()
}

export function FormularioDePago({
  abierto,
  onCerrar,
  precioCentavos,
}: {
  abierto: boolean
  onCerrar: () => void
  precioCentavos: number
}) {
  const router = useRouter()

  const [numero, setNumero] = React.useState("")
  const [titular, setTitular] = React.useState("")
  const [vencimiento, setVencimiento] = React.useState("")
  const [cvc, setCvc] = React.useState("")
  const [paso, setPaso] = React.useState<Paso>("datos")
  const [error, setError] = React.useState<string | null>(null)
  const [enlaces, setEnlaces] = React.useState<{ terminos: string | null; datos: string | null }>({
    terminos: null,
    datos: null,
  })

  // Los enlaces a los términos se piden al ABRIR y no al cargar la pantalla: son de vida corta y
  // sólo hacen falta si alguien va a pagar de verdad.
  React.useEffect(() => {
    if (!abierto) return
    let vivo = true
    void fetch("/api/suscripcion/iniciar")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (vivo && j) setEnlaces({ terminos: j.terminos ?? null, datos: j.tratamientoDeDatos ?? null })
      })
      .catch(() => {
        // Sin enlaces el formulario sigue sirviendo; se muestra el texto sin los vínculos. No vale
        // bloquear un pago porque no cargó un permalink.
      })
    return () => {
      vivo = false
    }
  }, [abierto])

  async function pagar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const [mes, anio] = vencimiento.split("/").map((s) => s.trim())
    if (!mes || !anio) {
      setError("Escribí el vencimiento como MM/AA.")
      return
    }

    setPaso("procesando")

    // 1. Navegador → Wompi. El número no pasa por nuestro servidor.
    const tok = await tokenizarTarjeta({
      numero,
      cvc,
      mesVencimiento: mes,
      anioVencimiento: anio,
      titular,
    })
    if (!tok.ok) {
      setPaso("datos")
      setError(tok.mensaje)
      return
    }

    // 2. Token → nuestra API, que guarda la fuente de pago y cobra el primer mes.
    const res = await fetch("/api/suscripcion/suscribir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: tok.tarjeta.token,
        marca: tok.tarjeta.marca,
        ultimos4: tok.tarjeta.ultimos4,
      }),
    })
    const json = (await res.json().catch(() => null)) as { error?: string } | null

    if (!res.ok) {
      setPaso("datos")
      setError(json?.error ?? "No pudimos procesar el pago.")
      return
    }

    // El número se descarta en cuanto deja de hacer falta, sin esperar a que se desmonte.
    setNumero("")
    setCvc("")
    setPaso("confirmando")
    router.refresh()
  }

  const procesando = paso === "procesando"

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && !procesando && onCerrar()}>
      <DialogContent className="max-w-md">
        {paso === "confirmando" ? (
          <>
            <DialogHeader>
              <DialogTitle>Estamos confirmando tu pago</DialogTitle>
              <DialogDescription>
                Tu banco está procesando el cobro. Puede tardar un momento; apenas se apruebe, Athos
                y el Modo Fantasma quedan activos y te va a aparecer acá.
              </DialogDescription>
            </DialogHeader>
            <Button className="mt-6" onClick={onCerrar}>
              Entendido
            </Button>
          </>
        ) : (
          <form onSubmit={pagar}>
            <DialogHeader>
              <DialogTitle>Cambiar a Pro</DialogTitle>
              <DialogDescription>
                {formatCOP(precioCentavos)} al mes para toda la clínica. Se renueva solo y podés
                cancelar cuando quieras.
              </DialogDescription>
            </DialogHeader>

            <FieldGroup className="mt-6">
              <Field>
                <FieldLabel htmlFor="tarjeta-numero">Número de la tarjeta</FieldLabel>
                <Input
                  id="tarjeta-numero"
                  inputMode="numeric"
                  autoComplete="cc-number"
                  placeholder="4242 4242 4242 4242"
                  value={numero}
                  onChange={(e) => setNumero(formatearNumero(e.target.value))}
                  disabled={procesando}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="tarjeta-titular">Titular</FieldLabel>
                <Input
                  id="tarjeta-titular"
                  autoComplete="cc-name"
                  placeholder="Como aparece en la tarjeta"
                  value={titular}
                  onChange={(e) => setTitular(e.target.value)}
                  disabled={procesando}
                  required
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="tarjeta-vence">Vence</FieldLabel>
                  <Input
                    id="tarjeta-vence"
                    inputMode="numeric"
                    autoComplete="cc-exp"
                    placeholder="MM/AA"
                    value={vencimiento}
                    onChange={(e) => setVencimiento(e.target.value)}
                    disabled={procesando}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="tarjeta-cvc">Código</FieldLabel>
                  <Input
                    id="tarjeta-cvc"
                    inputMode="numeric"
                    autoComplete="cc-csc"
                    placeholder="123"
                    value={cvc}
                    onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    disabled={procesando}
                    required
                  />
                </Field>
              </div>

              {error && <FieldDescription className="text-destructive">{error}</FieldDescription>}

              <FieldDescription className="flex items-start gap-2">
                <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  Los datos de tu tarjeta van directo a Wompi, nuestra pasarela de pagos; Tuvetia no
                  los ve ni los guarda. Al continuar aceptás los{" "}
                  {enlaces.terminos ? (
                    <a
                      href={enlaces.terminos}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      términos de Wompi
                    </a>
                  ) : (
                    "términos de Wompi"
                  )}{" "}
                  y la{" "}
                  {enlaces.datos ? (
                    <a
                      href={enlaces.datos}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      autorización de tratamiento de datos
                    </a>
                  ) : (
                    "autorización de tratamiento de datos"
                  )}
                  .
                </span>
              </FieldDescription>
            </FieldGroup>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={onCerrar} disabled={procesando}>
                Cancelar
              </Button>
              <Button type="submit" disabled={procesando}>
                {procesando && <Loader2 className="size-4 animate-spin" />}
                Pagar {formatCOP(precioCentavos)}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
