/**
 * Un botón que se apagó para trabajar tiene que volver a encenderse. Siempre.
 *
 * ── LO QUE PASÓ (28-ago, reporte de David) ────────────────────────────────────────────────────
 *
 * «Hay cosas que sirven una vez o dos y después fallan, esas son: consultas, nuevos chats, el
 * athos, y botones en general.»
 *
 * «Botones en general» no era una exageración ni cuatro defectos sueltos: era UN mecanismo. Una
 * bandera booleana que se pone en `true` antes de trabajar, gobierna el `disabled` del botón, y se
 * apaga A MANO en cada camino de salida. Cualquier EXCEPCIÓN se salta todos esos caminos y la deja
 * encendida — el botón queda deshabilitado con su rueda girando, para siempre.
 *
 * Y sí hay una excepción posible donde nadie la busca: `supabase.auth.getUser()` LANZA. Su
 * `_getUser` sólo convierte a `{ data, error }` lo que es `isAuthError`; todo lo demás se propaga,
 * y ahí adentro está el timeout del lock de Navigator, que se disputa ENTRE PESTAÑAS y en la
 * rotación del token. Por eso no falla en el primer uso: falla en el tercero. Es, palabra por
 * palabra, «sirve una o dos veces y después falla».
 *
 * En «Iniciar consulta» era permanente además por dónde vive: el cajón está montado en la barra
 * lateral (`nav-main.tsx`), dentro del layout del dashboard, así que NO se desmonta al navegar.
 * Sin desmontaje no hay estado nuevo, y `resetForm()` tampoco tocaba la bandera: cerrar y reabrir
 * el cajón tampoco lo recuperaba. Sólo recargar la página.
 *
 * ── POR QUÉ ESTA PRUEBA MONTA EL COMPONENTE ───────────────────────────────────────────────────
 *
 * No hay función pura que extraer: el defecto ESTÁ en el ciclo de vida. La convención del repo
 * —sacar la lógica a un `.ts` y probar eso— no alcanza acá, y por eso existe
 * `vitest.componentes.config.mts`. Se corre con `npm run test:componentes`.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// El fallo que se inyecta: `getUser` RECHAZA, como cuando el lock de auth vence.
const getUser = vi.fn()
const push = vi.fn()

const PACIENTES = [
  { id: "p1", name: "Luna", species: "Perro", owner_id: "o1", owner: { full_name: "Marta" } },
]

const RESPUESTAS: Record<string, unknown> = {
  patients: PACIENTES,
  profiles: { clinic_id: "c1" },
  consultations: { id: "consulta-nueva" },
}

// Doble encadenable y *thenable*: el builder de PostgREST es las dos cosas a la vez, y sin el
// `then` un `await` sobre la cadena nunca resuelve. Mismo patrón que `cupos-por-vet.test.ts`.
function tabla(nombre: string) {
  const datos = RESPUESTAS[nombre] ?? null
  const nodo: Record<string, unknown> = {}
  for (const m of ["select", "eq", "order", "limit", "insert"]) nodo[m] = () => tabla(nombre)
  nodo.single = () => Promise.resolve({ data: datos, error: null })
  nodo.maybeSingle = () => Promise.resolve({ data: datos, error: null })
  nodo.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: datos, error: null }).then(r)
  return nodo
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: () => getUser() },
    from: (t: string) => tabla(t),
  }),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))
vi.mock("@/components/planes/plan-provider", () => ({ useCapacidad: () => ({ puede: true }) }))
vi.mock("@/components/planes/modal-subir-a-pro", () => ({
  useModalPro: () => ({ pedirPro: vi.fn(), ventana: null }),
}))
// El alta de paciente no participa del defecto y arrastra su propio árbol.
vi.mock("@/components/create-patient-drawer", () => ({ CreatePatientDrawer: () => null }))

const { NewConsultationDrawer } = await import("@/components/new-consultation-drawer")

const boton = (nombre: RegExp) =>
  screen.getByRole("button", { name: nombre }) as HTMLButtonElement

/** Abre el cajón y deja elegido el único paciente: el punto de partida de los tres casos. */
async function abrirYElegirPaciente() {
  fireEvent.click(boton(/nueva consulta/i))
  fireEvent.click(await screen.findByRole("option", { name: /luna/i }))
}

describe("«Iniciar consulta» cuando la sesión falla", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } })
  })

  it("vuelve a estar disponible después de que `getUser` RECHACE", async () => {
    // Es el caso exacto del reporte: no un error DEVUELTO —que el código ya contemplaba— sino una
    // promesa rechazada, que se salta los cuatro `setLoading(false)` escritos a mano.
    getUser.mockRejectedValue(
      new Error("Acquiring an exclusive Navigator LockManager lock timed out"),
    )

    render(<NewConsultationDrawer />)
    await abrirYElegirPaciente()

    const iniciar = boton(/iniciar consulta/i)
    expect(iniciar.disabled, "con el paciente elegido el botón arranca disponible").toBe(false)
    fireEvent.click(iniciar)

    // ESTA es la aserción del defecto. Sin el `finally`, `loading` queda en `true` y el botón no
    // vuelve nunca: el vet lo ve girando y sólo recargando la página puede iniciar otra consulta.
    await waitFor(() => {
      expect(
        boton(/iniciar consulta/i).disabled,
        "el botón quedó deshabilitado para siempre: es el defecto que reportó David",
      ).toBe(false)
    })

    // Y no se navega a ninguna consulta, porque no se creó ninguna.
    expect(push).not.toHaveBeenCalled()
  })

  it("le dice al veterinario qué pasó, en vez de dejarlo mirando la rueda", async () => {
    // El defecto tenía dos mitades: el botón muerto y el SILENCIO. Un rechazo no pintaba ningún
    // mensaje, así que la pantalla no daba ninguna pista de por qué no arrancaba la consulta.
    getUser.mockRejectedValue(new Error("La sesión venció"))

    render(<NewConsultationDrawer />)
    await abrirYElegirPaciente()
    fireEvent.click(boton(/iniciar consulta/i))

    expect(await screen.findByText(/la sesión venció/i)).toBeTruthy()
  })

  it("en el camino normal crea la consulta y navega a grabarla", async () => {
    // La red de seguridad del arreglo: que el `try/finally` no se haya llevado puesto el éxito.
    render(<NewConsultationDrawer />)
    await abrirYElegirPaciente()
    fireEvent.click(boton(/iniciar consulta/i))

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(push.mock.calls[0][0]).toBe("/dashboard/consultas/consulta-nueva?grabar=1")
  })
})
