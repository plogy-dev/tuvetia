import Link from "next/link"

import { Button } from "@/components/ui/button"

// Lo que ve alguien cuya cuenta fue desactivada.
//
// EXISTE PARA QUE EL GATE NO MIENTA. Con la migración 0059, un perfil inactivo deja de ver los datos
// de su clínica — y sin esta pantalla la app lo trataría como alguien SIN clínica y le ofrecería
// crear una nueva. Un veterinario leería «no tienes clínica» y creería que sus datos se perdieron.
//
// DICE QUE LOS DATOS SIGUEN AHÍ, y es lo más importante de la pantalla. Desactivar no borra: la
// historia clínica de las mascotas de sus titulares sigue existiendo, y bajo la Ley 1581 esos datos
// tienen dueños que no son ni el veterinario ni nosotros.
//
// NO OFRECE «reactivar» ni «pagar»: ninguna de las dos cosas existe todavía. Un botón que no lleva a
// ningún lado en la pantalla donde alguien ya está frustrado es peor que ningún botón.

export function CuentaDesactivada({ correo }: { correo?: string | null }) {
  return (
    <main className="app-theme mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-4 px-6 py-10">
      <h1 className="font-display text-2xl font-medium tracking-[-0.01em]">
        Tu cuenta está desactivada
      </h1>
      <p className="text-sm leading-relaxed text-fg-muted">
        No puedes entrar a la clínica por ahora.{" "}
        <strong className="font-medium text-fg">Tus datos no se borraron</strong>: los pacientes, las
        historias clínicas y la facturación siguen guardados.
      </p>
      <p className="text-sm leading-relaxed text-fg-muted">
        Si crees que es un error, escríbenos desde{" "}
        {correo ? <span className="text-fg">{correo}</span> : "tu correo"} y lo revisamos.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="outline" size="sm" render={<Link href="/" />}>
          Ir al inicio
        </Button>
        <Button variant="ghost" size="sm" render={<Link href="/login" />}>
          Entrar con otra cuenta
        </Button>
      </div>
    </main>
  )
}
