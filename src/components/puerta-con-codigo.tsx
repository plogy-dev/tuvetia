"use client"

// La pantalla de registro cuando Tuvetia está en modo cerrado: primero el código, después el
// formulario de siempre.
//
// ── POR QUÉ EL CÓDIGO VA ANTES Y NO COMO UN CAMPO MÁS ─────────────────────────────────────────
//
// Un campo "código" dentro del formulario se lee como opcional —al lado de nombre, correo y
// teléfono, parece el típico "¿tenés un cupón?"— y quien no lo tiene igual llena los tres campos,
// aprieta «Crear cuenta» y recién ahí se entera de que no puede entrar. Tres campos de trabajo
// tirados a la basura es exactamente la primera impresión que esta pantalla no puede dar.
//
// Puesto adelante, la pantalla dice la verdad en el primer segundo: esto está cerrado, hace falta un
// código, y si no lo tenés no sigas. Y para quien SÍ lo tiene el paso desaparece: el enlace que le
// compartieron trae `?codigo=` y esta pantalla nunca se le muestra.
//
// LO QUE ACÁ SE DECIDE ES DE INTERFAZ, NO DE SEGURIDAD. Nada de esto impide llamar a
// `supabase.auth.signInWithOtp` desde la consola; lo que lo impide es que la base no aprovisiona
// clínica sin pase (migración 0100), y sin clínica la app no existe. Esta pantalla es la que hace
// que el camino honesto sea claro, no la que cierra el deshonesto.

import { useState } from "react"
import Link from "next/link"
import { KeyRound, Loader2Icon } from "lucide-react"

import { comprobarCodigo } from "@/app/signup/actions"
import { SignupForm } from "@/components/signup-form"
import { normalizarCodigo, type PaseDeRegistro } from "@/lib/puerta"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/* Glifo "chispa" de la marca Tuvetia — el mismo de `signup-form` y `login-form`. */
function BrandGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden>
      <path
        fill="var(--accent)"
        fillRule="evenodd"
        d="M32 8a24 24 0 1 0 0.001 0Z M44 22a5 5 0 1 0 0.001 0Z"
      />
    </svg>
  )
}

export function PuertaConCodigo({
  pase: paseInicial,
  puertaCerrada,
  aviso,
}: {
  /** El código que ya validó el servidor al abrir `?codigo=…`. Con esto, el paso no se muestra. */
  pase: PaseDeRegistro | null
  /** Con la puerta abierta el código es opcional: sólo define los días de prueba. */
  puertaCerrada: boolean
  /** Por qué llegó acá: el rebote de un Google sin cuenta, un código vencido en el enlace… */
  aviso: string | null
}) {
  const [pase, setPase] = useState<PaseDeRegistro | null>(paseInicial)
  const [codigo, setCodigo] = useState("")
  const [validando, setValidando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Con la puerta abierta esta pantalla no se interpone nunca: el formulario de siempre, con el
  // código si vino en el enlace (para los días) y sin él si no vino.
  if (pase || !puertaCerrada) {
    return <SignupForm pase={pase} aviso={aviso} />
  }

  async function validar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setValidando(true)
    const res = await comprobarCodigo(codigo)
    setValidando(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setPase({ codigo: res.codigo, dias: res.dias })
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={validar}>
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <Link href="/" className="flex flex-col items-center gap-2 font-medium">
              <div className="flex size-8 items-center justify-center rounded-md">
                <BrandGlyph />
              </div>
              <span className="font-display text-[17px] font-bold tracking-[-0.02em]">Tuvetia</span>
            </Link>
            <h1 className="text-xl font-bold">Tuvetia está en acceso por invitación</h1>
            <FieldDescription>
              Estamos abriendo de a poco, con clínicas que nos ayudan a probarlo. Si te compartieron
              un código, escribilo acá.
            </FieldDescription>
          </div>

          {/* EL MOTIVO POR EL QUE REBOTÓ, ARRIBA DEL CAMPO. Quien llega acá desde un «Continuar con
              Google» que no funcionó necesita saber que no fue un error de la app ni de su cuenta:
              sin esta línea, la pantalla parece haberse tragado el intento sin explicación. */}
          {aviso && (
            <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-foreground">
              {aviso}
            </div>
          )}

          <Field>
            <FieldLabel htmlFor="codigo-de-acceso">Código de acceso</FieldLabel>
            <Input
              id="codigo-de-acceso"
              value={codigo}
              // Se normaliza mientras se teclea: lo que el vet ve es exactamente lo que se va a
              // comparar. Pegar «vets 2026» desde un mensaje y ver «VETS2026» en el campo es la
              // confirmación de que el espacio de más no importa — antes de apretar nada.
              onChange={(e) => setCodigo(normalizarCodigo(e.target.value))}
              placeholder="VETABC123"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="font-mono tracking-[0.15em]"
              required
              autoFocus
            />
            <FieldDescription>
              Te lo compartió alguien del equipo de Tuvetia, junto con el enlace.
            </FieldDescription>
          </Field>

          {error && <FieldError>{error}</FieldError>}

          <Field>
            <Button type="submit" disabled={validando || codigo.length < 4}>
              {validando ? <Loader2Icon className="animate-spin" /> : <KeyRound className="size-4" />}
              Continuar
            </Button>
          </Field>

          {/* LA SALIDA PARA QUIEN YA ES CLIENTE. El modo cerrado sólo frena las cuentas NUEVAS; quien
              ya tiene la suya entra como siempre, y sin este renglón esta pantalla se lee como «me
              cerraron la app» — que es literalmente lo contrario de lo que pasa. */}
          <FieldDescription className="text-center">
            ¿Ya tenés cuenta? <Link href="/login">Iniciá sesión</Link> — el código es sólo para
            cuentas nuevas.
          </FieldDescription>
        </FieldGroup>
      </form>
    </div>
  )
}
