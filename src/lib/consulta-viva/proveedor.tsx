"use client"

// El estado de la inteligencia viva, UNO SOLO para toda la app.
//
// POR QUÉ UN CONTEXTO Y NO UN GANCHO EN CADA LADO. Hay dos superficies que muestran lo mismo —el
// notch, que flota sobre cualquier pantalla, y el cockpit, que ocupa la pantalla de la consulta— y
// son HERMANAS en el árbol: el notch se monta en el layout, el cockpit dentro de `{children}`.
//
// Con un gancho en cada una habría dos relojes disparando contra el mismo presupuesto: el techo por
// consulta se contaría mal y se pagaría el doble por la misma consulta. Y peor, cada una vería
// notas distintas — el vet ampliaría el notch y encontraría otra cosa de la que estaba leyendo.
//
// Acá el gancho corre UNA vez, mientras haya consulta, y las dos leen el mismo estado. Es también
// lo que hace que las notas sobrevivan a minimizar, que es el uso normal.

import { createContext, useContext } from "react"

import {
  useInteligenciaViva,
  type InteligenciaViva,
} from "@/lib/consulta-viva/usar-inteligencia-viva"
import { useConsultaViva } from "@/lib/consulta-viva/usar"

type Valor = InteligenciaViva & { vistoLaAlerta: () => void }

const Contexto = createContext<Valor | null>(null)

export function ProveedorDeInteligenciaViva({ children }: { children: React.ReactNode }) {
  const estado = useConsultaViva()
  const vivo = useInteligenciaViva(estado.fase === "grabando")
  return <Contexto.Provider value={vivo}>{children}</Contexto.Provider>
}

/**
 * Lo que Athos lleva armado de esta consulta.
 *
 * Lanza fuera del proveedor a propósito: devolver un estado vacío dejaría una superficie mostrando
 * "todavía no hay nada" para siempre, sin que nadie se entere de que no está conectada.
 */
export function useVivo(): Valor {
  const v = useContext(Contexto)
  if (!v) {
    throw new Error(
      "useVivo() fuera de <ProveedorDeInteligenciaViva>. Se monta en dashboard/layout.tsx, " +
        "envolviendo el contenido y el notch — las dos superficies leen el mismo estado.",
    )
  }
  return v
}
