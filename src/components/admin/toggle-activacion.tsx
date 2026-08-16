"use client"

// El interruptor de acceso de una cuenta. Molde de `send-email-dialog.tsx`: panel inline →
// acción → `router.refresh()`.
//
// POR QUÉ NO ES UN SWITCH. Un `<Switch>` invita a alternarlo y se dispara con un clic suelto, y esto
// le corta el acceso a una persona real a mitad de su jornada. Cuesta un paso más a propósito:
// abrir, escribir por qué, confirmar.
//
// LA RAZÓN NO ES OBLIGATORIA, y es deliberado: un campo requerido se llena con "x" y deja de
// informar. Opcional pero presente, se llena cuando hay algo que decir — que es cuando importa.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, ShieldBan, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { cambiarActivacion } from "@/app/admin/usuarios/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function ToggleActivacion({
  userId,
  nombre,
  activo,
  esUnoMismo,
}: {
  userId: string
  nombre: string | null
  /** `false` sólo cuando está explícitamente desactivada; `null` en la base cuenta como activa. */
  activo: boolean
  /** El admin no puede desactivarse a sí mismo. El servidor lo vuelve a comprobar. */
  esUnoMismo: boolean
}) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [guardando, setGuardando] = useState(false)

  const quien = nombre ?? "esta cuenta"

  async function aplicar(nuevoActivo: boolean) {
    setGuardando(true)
    const res = await cambiarActivacion({ userId, activo: nuevoActivo, motivo: motivo.trim() || undefined })
    setGuardando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(res.mensaje)
    setAbierto(false)
    setMotivo("")
    router.refresh()
  }

  // Reactivar es la operación segura: devuelve acceso, no lo quita. Un solo clic.
  if (!activo) {
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled={guardando}
        onClick={() => void aplicar(true)}
        title={`Devolverle el acceso a ${quien}`}
      >
        {guardando ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4 text-ok" />}
      </Button>
    )
  }

  if (esUnoMismo) {
    return (
      <Button size="sm" variant="ghost" disabled title="No podés desactivar tu propia cuenta">
        <ShieldBan className="size-4 opacity-30" />
      </Button>
    )
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setAbierto((v) => !v)}
        title={`Quitarle el acceso a ${quien}`}
      >
        <ShieldBan className="size-4" />
      </Button>

      {abierto && (
        <div className="absolute right-0 z-20 mt-1 flex w-80 flex-col gap-2 rounded-lg border bg-popover p-3 text-left shadow-popover">
          <p className="text-sm font-medium">Quitarle el acceso a {quien}</p>
          {/* Decir qué NO pasa es tan importante como qué pasa: sin esta línea, "desactivar" se lee
              como "borrar", y quien aprieta el botón no está seguro de poder deshacerlo. */}
          <p className="text-xs text-muted-foreground">
            No va a poder entrar a la plataforma. <b>Sus datos no se borran</b> y podés devolverle el
            acceso desde acá cuando quieras.
          </p>
          <Input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (opcional) — queda en la traza"
            maxLength={500}
            autoFocus
          />
          <div className="flex items-center justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={guardando}
              onClick={() => void aplicar(false)}
            >
              {guardando ? <Loader2 className="size-4 animate-spin" /> : "Quitar el acceso"}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
