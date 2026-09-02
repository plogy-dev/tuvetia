/**
 * Qué pasa con el estado guardado cuando un envío falla.
 *
 * El caso, reportado el 2-sep: el vet desvinculó WhatsApp desde el teléfono, la app siguió
 * mostrando «Conectado · 573107663149», y al escribir salió «El servicio de WhatsApp está fallando
 * (500)» — un mensaje que manda a esperar cuando lo que había que hacer era volver a escanear el QR.
 *
 * `whatsapp_integrations.status` es una foto: se escribe al conectar, cuando llega un
 * `connection.update` del proveedor, o cuando el vet aprieta «Verificar». Si ese evento no llega, la
 * columna se queda en `connected` para siempre. Un fallo de envío es la mejor evidencia disponible
 * de que algo pasa con la línea, y hasta ahora se tiraba a la basura.
 *
 * Lo que se fija acá es la asimetría: se confirma antes de bajar la bandera, y ANTE LA DUDA NO SE
 * BAJA. Marcar «desconectado» por un hipo del proveedor mandaría al vet a escanear un QR que no
 * necesita, y perder una conexión sana es peor que tardar un rato más en enterarse de una rota.
 */
import { describe, expect, it, vi } from "vitest"

import { laLineaSeCayo } from "@/lib/whatsapp/send-message"
import type { WhatsAppIntegrationRow, WhatsAppProvider } from "@/lib/whatsapp/provider"

const INTEG = { clinic_id: "c-1", status: "connected" } as unknown as WhatsAppIntegrationRow

const proveedorQueDice = (status: string): WhatsAppProvider =>
  ({
    refreshStatus: async () => ({ status, phoneNumber: null, phoneNumberId: null }),
  }) as unknown as WhatsAppProvider

describe("laLineaSeCayo — se confirma antes de bajar la bandera", () => {
  it("cualquier estado que no sea `connected` cuenta como caída", async () => {
    // `pending` TAMBIÉN, y es el que importa: con Evolution una instancia cerrada devuelve
    // `pending` en vez de `disconnected` según cómo estuviera la columna guardada. Mirar sólo
    // `disconnected` dejaba pasar justo el caso reportado el 2-sep.
    for (const estado of ["disconnected", "pending", "none"]) {
      expect(await laLineaSeCayo(proveedorQueDice(estado), INTEG), estado).toBe(true)
    }
  })

  it("una línea sana no se toca", async () => {
    expect(await laLineaSeCayo(proveedorQueDice("connected"), INTEG)).toBe(false)
  })

  it("un 404 del proveedor NO es una duda: la línea se fue", async () => {
    // Y es lo que hacía que el arreglo del 31-ago no se activara nunca en el caso reportado. `evo()`
    // lanza en cualquier respuesta que no sea 2xx, 404 incluido: si la instancia ya no existe del
    // lado del proveedor, la consulta de estado tiraba, se caía en el `catch` y «ante la duda»
    // devolvía false — el vet seguía viendo «El servicio de WhatsApp está fallando (500)».
    //
    // Un 404 no es no-poder-preguntar: es el proveedor CONTESTANDO que esa instancia no está.
    const noExiste = {
      refreshStatus: async () => {
        throw Object.assign(new Error("Evolution GET /instance/connectionState/x → 404: not found"), {
          status: 404,
        })
      },
    } as unknown as WhatsAppProvider
    expect(await laLineaSeCayo(noExiste, INTEG)).toBe(true)
  })

  it("si la consulta de estado TAMBIÉN falla, ante la duda queda conectada", async () => {
    // Es el caso del proveedor caído: el envío falla y la consulta también. Bajar la bandera acá
    // sería concluir «se desconectó el teléfono» a partir de «no pude preguntar».
    const roto = {
      refreshStatus: async () => {
        throw new Error("ECONNREFUSED")
      },
    } as unknown as WhatsAppProvider
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(await laLineaSeCayo(roto, INTEG)).toBe(false)
    // Y queda registrado: un fallo que no cambia nada y tampoco se anota es un fallo invisible.
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
