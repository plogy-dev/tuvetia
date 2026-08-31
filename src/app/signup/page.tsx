import { PuertaConCodigo } from "@/components/puerta-con-codigo"
import { normalizarCodigo, veredictoDelCodigo, type PaseDeRegistro } from "@/lib/puerta"
import { leerCodigo, modoDeLaPuerta } from "@/lib/puerta/servidor"

export const metadata = { title: "Crear cuenta · Tuvetia" }

/**
 * Por qué alguien puede llegar acá rebotado, en su idioma.
 *
 * `?motivo=` lo pone `/auth/callback` cuando devuelve a alguien: son las únicas dos formas de
 * aterrizar en esta pantalla sin haberla pedido, y las dos necesitan explicarse solas. Sin el
 * renglón, el vet ve un formulario de registro que él no abrió y concluye que la app se rompió.
 */
const AVISOS: Record<string, string> = {
  "sin-cuenta":
    "Esa cuenta todavía no existe en Tuvetia. Para crear una nueva hace falta un código de acceso — si ya tenías cuenta, revisá con qué correo la abriste.",
  "codigo-vencido":
    "El código del enlace que abriste ya no sirve. Pedile uno nuevo a quien te lo compartió.",
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ codigo?: string; motivo?: string }>
}) {
  const { codigo: codigoDelEnlace, motivo } = await searchParams

  // LAS DOS CONSULTAS EN PARALELO, no una detrás de otra: son independientes y esta pantalla es la
  // primera que ve alguien que llega por un enlace compartido.
  const [modo, fila] = await Promise.all([
    modoDeLaPuerta(),
    codigoDelEnlace ? leerCodigo(codigoDelEnlace) : Promise.resolve(null),
  ])

  // EL CÓDIGO DEL ENLACE SE VALIDA ACÁ, EN EL SERVIDOR, y no se le cree al parámetro: `?codigo=` lo
  // escribe cualquiera en la barra de direcciones. Lo que baja al navegador es el resultado —el
  // código real y sus días— nunca la promesa de que lo que venía en la URL era bueno.
  const veredicto = veredictoDelCodigo(fila, new Date())
  const pase: PaseDeRegistro | null =
    fila && veredicto.sirve ? { codigo: fila.codigo, dias: fila.dias } : null

  const cerrada = modo === "cerrado"

  // UN CÓDIGO MUERTO EN EL ENLACE SÓLO SE AVISA CON LA PUERTA CERRADA. Con la puerta abierta quien
  // llegó con un enlace viejo se registra normal, con su prueba de siempre: no se le castiga por
  // haber guardado un enlace, y un error rojo en una pantalla donde igual puede seguir sólo asusta.
  const aviso =
    (motivo && AVISOS[motivo]) ??
    (cerrada && normalizarCodigo(codigoDelEnlace) && !pase ? AVISOS["codigo-vencido"] : null)

  return (
    <div className="app-theme relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="relative z-[1] w-full max-w-sm">
        <PuertaConCodigo pase={pase} puertaCerrada={cerrada} aviso={aviso} />
      </div>
    </div>
  )
}
