"use client"

// Lo que se hace con un código ya creado: copiar su enlace y apagarlo.
//
// COPIAR EL ENLACE ES LA ACCIÓN PRINCIPAL, no la secundaria. Lo que David pidió fue «un link»: el
// código suelto obliga a quien lo reparte a explicar dónde se pega, y esa explicación es la que se
// pierde por WhatsApp. El enlace ya lleva el código puesto y aterriza en el formulario con el paso
// del código saltado.
//
// El origen se lee del navegador (`window.location.origin`) en vez de una env: así el enlace que se
// copia desde una preview de Vercel apunta a esa preview, y el que se copia desde producción apunta
// a producción. Una env fija daría siempre el mismo, que es exactamente el error que se comete al
// probar y no se nota hasta que alguien de afuera abre el enlace.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Copy, Loader2, Power } from "lucide-react"
import { toast } from "sonner"

import { cambiarActivoDeCodigo } from "@/app/admin/acceso/actions"
import { enlaceDelCodigo } from "@/lib/puerta"
import { Button } from "@/components/ui/button"

export function AccionesDeCodigo({ codigo, activo }: { codigo: string; activo: boolean }) {
  const router = useRouter()
  const [copiado, setCopiado] = useState(false)
  const [guardando, setGuardando] = useState(false)

  async function copiar() {
    const enlace = enlaceDelCodigo(window.location.origin, codigo)
    try {
      await navigator.clipboard.writeText(enlace)
      setCopiado(true)
      toast.success("Enlace copiado", { description: enlace })
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // El portapapeles falla sin permiso o fuera de HTTPS. Mostrar el enlace deja copiarlo a mano
      // en vez de dejar el botón mudo.
      toast.error("No se pudo copiar", { description: enlace })
    }
  }

  async function alternar() {
    setGuardando(true)
    const res = await cambiarActivoDeCodigo({ codigo, activo: !activo })
    setGuardando(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(res.mensaje)
    router.refresh()
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button size="sm" variant="ghost" onClick={() => void copiar()} title="Copiar el enlace para compartir">
        {copiado ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={guardando}
        onClick={() => void alternar()}
        title={activo ? "Dejar de admitir registros con este código" : "Volver a admitir registros"}
      >
        {guardando ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Power className={activo ? "size-4" : "size-4 text-muted-foreground opacity-40"} />
        )}
      </Button>
    </div>
  )
}
