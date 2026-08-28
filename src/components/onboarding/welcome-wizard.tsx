"use client"

// Wizard de bienvenida. Recupera los pasos que el commit 7c00ec1 (27-jul) borró al reducir el
// onboarding a una sola pantalla: primer paciente, datos de ejemplo e invitar al equipo volvieron,
// porque son los que dejan la cuenta USABLE — una clínica con el nombre puesto y cero pacientes
// sigue siendo una pantalla vacía.
//
// Reglas del flujo:
//   · Sólo el paso 1 (clínica) es obligatorio. Los otros tres se saltan con un clic.
//   · `mark_setup_completed()` se llama AL FINAL. Si el vet abandona a mitad, vuelve a ver el
//     wizard la próxima vez — que es lo correcto: no lo terminó.
//   · Nada de lo que se hace acá es irreversible ni difícil de deshacer después.

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Loader2,
  PawPrint,
  Receipt,
  Sparkles,
  UserPlus,
} from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputMoneda } from "@/components/ui/input-moneda"
import { WorkspaceSetup } from "@/components/onboarding/workspace-setup"
import {
  SERVICIOS_SUGERIDOS,
  cuantosServicios,
  filasDeCatalogo,
} from "@/lib/onboarding/catalogo-sugerido"
import {
  HORARIO_SUGERIDO,
  NOMBRE_DEL_DIA,
  filasDeHorario,
  type DiaSugerido,
} from "@/lib/onboarding/horarios-sugeridos"

// HORARIOS Y SERVICIOS ENTRARON ACÁ EL 2026-08-16, y son la mitad del wizard que faltaba.
//
// La auditoría midió las 15 clínicas del principal: 1 de 15 tenía horarios y **0 de 15 tenían un
// servicio**. O sea que ninguna podía facturar y 14 no podían agendar con VetGPT — las dos
// capacidades insignia, apagadas. La causa no era un fallo: los tres pasos que las habilitan estaban
// FUERA de este wizard, en el riel plegable del dashboard. Lo que el wizard acompaña se hace (de 9
// que lo vieron, 8 lo terminaron); lo que queda en el riel, no.
//
// Van en 2º y 3º lugar, pegados a "Clínica", porque son la misma cosa —configurar la clínica— y
// porque el abandono crece con la profundidad: lo que más desbloquea tiene que ir arriba.
const PASOS = ["Clínica", "Horarios", "Servicios", "Primer paciente", "Ejemplo", "Equipo"] as const

/** Índices de los pasos. Con seis, contarlos a mano en cada `setPaso` es cómo se desincronizan. */
const P_CLINICA = 0
const P_HORARIOS = 1
const P_SERVICIOS = 2
const P_PACIENTE = 3
const P_EJEMPLO = 4
const P_EQUIPO = 5

/**
 * Lo que la clínica YA tiene, para no volver a pedirlo.
 *
 * El onboarding se puede repetir desde Ayuda, y ese botón promete "no borra nada de lo que ya
 * cargaste". Sin esto, cumplir esa promesa significaría además DUPLICAR: un segundo titular con su
 * paciente y otro juego de servicios, porque ni `create_owner` ni `catalog_items` tienen guarda de
 * unicidad. Los horarios sí la tienen (`unique (clinic_id, weekday, opens_at)`), así que ahí el
 * choque se maneja; los otros dos entrarían dos veces sin protestar.
 */
export type YaHecho = {
  horarios: boolean
  servicios: boolean
  paciente: boolean
}

export function WelcomeWizard({
  clinicId,
  initialClinicName,
  initialLogoUrl,
  yaHecho,
  onPasoChange,
}: {
  clinicId: string
  initialClinicName: string
  initialLogoUrl: string | null
  /** Ausente = primera vez; nada está hecho. */
  yaHecho?: YaHecho
  /**
   * Avisa hacia arriba en qué paso va el wizard (también una vez al montar). Existe para que el
   * panel de VetGPT acompañe con texto atado al paso ACTUAL (pedido de la reunión del 24-ago).
   * Opcional a propósito: el wizard funciona idéntico sin nadie escuchando.
   */
  onPasoChange?: (paso: number) => void
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [paso, setPaso] = useState(0)
  const [busy, setBusy] = useState(false)

  // Se avisa por efecto y no en cada `setPaso`: hay ocho sitios que avanzan de paso, y con avisos a
  // mano bastaría olvidar uno para que el panel de al lado se quede hablando del paso anterior sin
  // que nada falle a la vista. El efecto además corre al montar, que es lo que deja al panel
  // arrancar ya en "Clínica" sin caso especial.
  useEffect(() => {
    onPasoChange?.(paso)
  }, [paso, onPasoChange])

  // Paso 2 — horarios. Arrancan LLENOS con la sugerencia: el caso común es confirmar, no escribir.
  const [dias, setDias] = useState<DiaSugerido[]>(() => HORARIO_SUGERIDO.map((d) => ({ ...d })))
  const [diasActivos, setDiasActivos] = useState<Set<number>>(
    () => new Set(HORARIO_SUGERIDO.map((d) => d.weekday)),
  )

  // Paso 3 — servicios. Los nombres los propone el módulo; los PRECIOS los escribe el vet, siempre.
  const [precios, setPrecios] = useState<Record<string, number | null>>({})

  // Paso 4 — primer paciente
  const [ownerName, setOwnerName] = useState("")
  const [ownerPhone, setOwnerPhone] = useState("")
  const [petName, setPetName] = useState("")
  const [petSpecies, setPetSpecies] = useState("Perro")

  // Paso 6 — invitación
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  /** ¿Salió el correo? `null` mientras no se sabe. Decide qué se le promete al vet en pantalla. */
  const [inviteEnviado, setInviteEnviado] = useState<boolean | null>(null)

  /** Cierra el onboarding: marca el flag y manda al dashboard. Único punto de salida. */
  async function terminar() {
    setBusy(true)
    const { error } = await supabase.rpc("mark_setup_completed")
    if (error) {
      // ── UN REINTENTO ANTES DE DEJARLO ENCERRADO ─────────────────────────────────────────────
      //
      // Acá había sólo el toast y el `return`, y eso dejaba al vet ATRAPADO: `dashboard/layout.tsx`
      // manda a `/bienvenida` mientras falte `setup_completed_at`, así que el único camino a la app
      // pasa por esta llamada. Si falla —red intermitente, un token vencido— el vet leía el error,
      // apretaba otra vez y volvía a leerlo, sin ninguna otra puerta.
      //
      // El reintento es lo primero porque el fallo más probable de un RPC suelto es transitorio. Si
      // el segundo también falla, ya no es transitorio y hay que decirlo con esas palabras: el toast
      // se queda hasta que lo cierren —no se va solo a los cuatro segundos— y nombra la salida real,
      // que es recargar. La llamada es idempotente, así que reintentar no cuesta nada.
      const segundo = await supabase.rpc("mark_setup_completed")
      if (segundo.error) {
        toast.error("No se pudo cerrar la configuración", {
          description: `${segundo.error.message}. Recargá la página y tocá «Terminar» otra vez; lo que configuraste ya quedó guardado.`,
          duration: Infinity,
        })
        setBusy(false)
        return
      }
    }
    router.push("/dashboard")
    router.refresh()
  }

  /** Marca o desmarca un día. Desmarcado = ese día no se guarda; la clínica no abre. */
  function alternarDia(weekday: number) {
    setDiasActivos((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(weekday)) siguiente.delete(weekday)
      else siguiente.add(weekday)
      return siguiente
    })
  }

  function cambiarHora(weekday: number, campo: "opens_at" | "closes_at", valor: string) {
    setDias((prev) => prev.map((d) => (d.weekday === weekday ? { ...d, [campo]: valor } : d)))
  }

  async function guardarHorarios() {
    const filas = filasDeHorario(clinicId, dias.filter((d) => diasActivos.has(d.weekday)))
    if (!filas.length) {
      // Sin días válidos no hay nada que guardar, pero tampoco es un error del vet: puede haber
      // desmarcado todo a propósito. Se sigue, como con "Ahora no".
      setPaso(P_SERVICIOS)
      return
    }
    setBusy(true)
    const { error } = await supabase.from("clinic_hours").insert(filas)
    setBusy(false)
    if (error) {
      // `unique (clinic_id, weekday, opens_at)`: si ya los había cargado en Configuración, esto choca.
      // No es un fallo que deba frenar el onboarding — significa que el paso ya está hecho.
      if (/duplicate key|unique/i.test(error.message)) {
        toast.success("Ya tenías horarios cargados")
        setPaso(P_SERVICIOS)
        return
      }
      toast.error(`No se pudieron guardar los horarios: ${error.message}`)
      return
    }
    toast.success(`Horarios guardados — VetGPT ya puede ofrecer citas`)
    setPaso(P_SERVICIOS)
  }

  async function crearServicios() {
    const filas = filasDeCatalogo(clinicId, precios)
    if (!filas.length) {
      setPaso(P_PACIENTE)
      return
    }
    setBusy(true)
    const { error } = await supabase.from("catalog_items").insert(filas)
    setBusy(false)
    if (error) {
      toast.error(`No se pudieron crear los servicios: ${error.message}`)
      return
    }
    toast.success(
      filas.length === 1 ? "Servicio creado — ya puedes facturar" : `${filas.length} servicios creados — ya puedes facturar`,
    )
    setPaso(P_PACIENTE)
  }

  async function crearPrimerPaciente() {
    if (!ownerName.trim() || !petName.trim()) return
    setBusy(true)
    try {
      const { data: ownerId, error: oErr } = await supabase.rpc("create_owner", {
        p_full_name: ownerName.trim(),
        p_phone: ownerPhone.trim() || null,
      })
      if (oErr || !ownerId) throw new Error(oErr?.message ?? "no se pudo crear el titular")
      const { error: pErr } = await supabase.rpc("create_patient", {
        p_owner_id: ownerId,
        p_name: petName.trim(),
        p_species: petSpecies.trim() || "Perro",
      })
      if (pErr) throw new Error(pErr.message)
      toast.success(`${petName.trim()} quedó registrado 🐾`)
      setPaso(P_EJEMPLO)
    } catch (e) {
      toast.error(`No se pudo crear el paciente: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function crearDatosDeEjemplo() {
    setBusy(true)
    try {
      // Endpoint que quedó huérfano al borrarse el wizard viejo: sigue vivo, es idempotente, y
      // siembra "Luna (ejemplo)" con consulta transcrita y nota SOAP en borrador.
      const res = await fetch("/api/onboarding/demo-data", { method: "POST" })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      toast.success("Paciente de ejemplo creado — explóralo en Pacientes")
      setPaso(P_EQUIPO)
    } catch (e) {
      toast.error(`No se pudo crear el ejemplo: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Crea la invitación Y LA MANDA POR CORREO.
   *
   * EL DEFECTO QUE ESTO CIERRA. Acá se llamaba sólo al RPC `create_invitation`, que escribe la fila
   * y devuelve el token — pero nadie llamaba a `/api/team/invite-email`, que es lo que la envía. La
   * invitación quedaba creada y el correo no salía nunca, mientras la pantalla decía «También le
   * llega por correo» tres líneas más abajo. El colega esperaba un mail que nadie había mandado.
   *
   * Pasaba SÓLO acá: el mismo flujo en Configuración (`team-settings.tsx`) sí llama a la ruta.
   *
   * POR QUÉ ACÁ SE MANDA SOLO Y EN CONFIGURACIÓN ES UN BOTÓN APARTE. No es incoherencia. En
   * Configuración el admin ya tiene la invitación creada delante y decide qué hacer con ella —el
   * comentario de ese archivo explica que el envío se separó a propósito, para poder reintentar—.
   * Acá el vet está en un wizard de un solo paso: escribió un correo y apretó un botón que dice
   * «invitar». Pedirle un segundo clic para que el correo salga es justamente el paso que nadie da.
   *
   * LO QUE NO CAMBIA: el resultado se DICE. Si el correo no sale, no se traga el error — se avisa y
   * el enlace queda igual en pantalla, que es el camino garantizado. Eso es lo que sí hay que
   * conservar del diseño de Configuración.
   */
  async function invitarColega(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    const correo = inviteEmail.trim()
    setBusy(true)

    const { data: token, error } = await supabase.rpc("create_invitation", {
      p_email: correo,
      p_role: "vet",
    })

    if (error || !token) {
      setBusy(false)
      toast.error(`No se pudo invitar: ${error?.message ?? "error desconocido"}`)
      return
    }

    // El enlace se muestra ANTES de intentar el correo: ya es utilizable, y si el envío falla o
    // tarda, el vet igual tiene con qué invitar. Nada de lo que sigue puede quitárselo.
    setInviteLink(`${window.location.origin}/invitar/${token}`)

    const res = await fetch("/api/team/invite-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null)
    const cuerpo = (await res?.json().catch(() => ({}))) as { sent?: boolean; reason?: string }
    setBusy(false)

    if (cuerpo.sent) {
      setInviteEnviado(true)
      toast.success(`Invitación enviada a ${correo}`)
      return
    }

    // La invitación EXISTE aunque el correo no haya salido, así que esto no es un fallo total y no
    // se cuenta como tal: se dice qué pasó y se señala el enlace, que sigue funcionando.
    setInviteEnviado(false)
    toast.error(
      cuerpo.reason
        ? `Invitación creada, pero el correo no salió: ${cuerpo.reason}. Compartí el enlace.`
        : "Invitación creada, pero el correo no salió. Compartí el enlace.",
    )
  }

  return (
    <div className="flex w-full flex-col gap-6">
{/* ── Progreso, y por fin con marcha atrás ──────────────────────────────────────────────
          Pedido del cliente (24-ago): «flechas para devolverse (adelante/atrás) en el onboarding».
          El wizard sólo avanzaba: quien se equivocaba en el horario del sábado o quería revisar un
          precio ya escrito no tenía forma de volver — salvo abandonar el onboarding entero y
          repetirlo desde Ayuda.

          VOLVER NO PIERDE NADA. Lo tecleado vive en el estado de ESTE componente y los pasos se
          pintan condicionalmente, así que salir de un paso no lo desmonta: los horarios, los
          precios y el primer paciente siguen ahí al regresar.

          LA FLECHA DE ADELANTE NO SE SALTA EL PRIMER PASO. Los otros cinco son opcionales —el
          wizard ya los deja saltar de a uno con «Ahora no»— pero sin la clínica guardada no hay
          contra qué colgar un horario ni un servicio. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPaso((p) => Math.max(0, p - 1))}
          disabled={paso === P_CLINICA || busy}
          aria-label="Volver al paso anterior"
          className="rounded-md p-1 text-fg-faint transition hover:bg-muted hover:text-fg disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>

        <div
          className="flex flex-1 items-center gap-1.5"
          aria-label={`Paso ${paso + 1} de ${PASOS.length}`}
        >
          {PASOS.map((s, i) => (
            <span
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= paso ? "bg-primary" : "bg-muted"
              }`}
              title={s}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => setPaso((p) => Math.min(PASOS.length - 1, p + 1))}
          disabled={paso === P_CLINICA || paso === PASOS.length - 1 || busy}
          aria-label="Ir al paso siguiente"
          className="rounded-md p-1 text-fg-faint transition hover:bg-muted hover:text-fg disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>

      {/* El nombre del paso, que hasta ahora sólo vivía en el `title` de una rayita: al poder
          moverse entre pasos hace falta saber en cuál se está sin pasar el mouse por encima. */}
      <p className="-mt-4 text-xs text-fg-faint">
        Paso {paso + 1} de {PASOS.length} · {PASOS[paso]}
      </p>

      {paso === P_CLINICA && (
        <WorkspaceSetup
          clinicId={clinicId}
          initialClinicName={initialClinicName}
          initialLogoUrl={initialLogoUrl}
          onSaved={() => setPaso(P_HORARIOS)}
        />
      )}

      {paso === P_HORARIOS && yaHecho?.horarios && (
        <YaEstaListo
          icono={<Clock className="size-5" />}
          titulo="Tus horarios ya están cargados"
          sub="VetGPT ya puede ofrecer espacios libres y agendar con ellos."
          onSeguir={() => setPaso(P_SERVICIOS)}
        />
      )}

      {paso === P_HORARIOS && !yaHecho?.horarios && (
        <div className="flex flex-col gap-5">
          <Encabezado
            icono={<Clock className="size-5" />}
            titulo="¿Cuándo atiendes?"
            sub="Es lo que le permite a VetGPT ofrecer un espacio libre y agendar. Ya está lleno con lo habitual: ajusta lo que no cuadre."
          />
          <div className="flex flex-col gap-2">
            {dias.map((d) => {
              const activo = diasActivos.has(d.weekday)
              return (
                <div
                  key={d.weekday}
                  className="flex items-center gap-3 rounded-lg border border-line px-3 py-2"
                >
                  <label className="flex min-w-0 flex-1 items-center gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={activo}
                      onChange={() => alternarDia(d.weekday)}
                      className="size-4 shrink-0 accent-primary"
                    />
                    <span className={activo ? "" : "text-muted-foreground line-through"}>
                      {NOMBRE_DEL_DIA[d.weekday]}
                    </span>
                  </label>
                  <Input
                    type="time"
                    aria-label={`${NOMBRE_DEL_DIA[d.weekday]}: abre`}
                    value={d.opens_at}
                    disabled={!activo}
                    onChange={(e) => cambiarHora(d.weekday, "opens_at", e.target.value)}
                    className="w-36 shrink-0"
                  />
                  <Input
                    type="time"
                    aria-label={`${NOMBRE_DEL_DIA[d.weekday]}: cierra`}
                    value={d.closes_at}
                    disabled={!activo}
                    onChange={(e) => cambiarHora(d.weekday, "closes_at", e.target.value)}
                    className="w-36 shrink-0"
                  />
                </div>
              )
            })}
          </div>
          <FieldDescription>
            El domingo y los turnos partidos se agregan después en Configuración.
          </FieldDescription>
          <Acciones
            onSaltar={() => setPaso(P_SERVICIOS)}
            principal={
              <Button onClick={guardarHorarios} disabled={busy || diasActivos.size === 0}>
                {busy && <Loader2 className="size-4 animate-spin" />} Guardar horarios
              </Button>
            }
          />
        </div>
      )}

      {paso === P_SERVICIOS && yaHecho?.servicios && (
        <YaEstaListo
          icono={<Receipt className="size-5" />}
          titulo="Ya tienes servicios en el catálogo"
          sub="Con eso alcanza para facturar una consulta."
          onSeguir={() => setPaso(P_PACIENTE)}
        />
      )}

      {paso === P_SERVICIOS && !yaHecho?.servicios && (
        <div className="flex flex-col gap-5">
          <Encabezado
            icono={<Receipt className="size-5" />}
            titulo="¿Qué cobras?"
            sub="Sin al menos un servicio no se puede facturar una consulta. Los precios van en pesos colombianos (COP), sin centavos. Pon el de los que uses; el resto déjalos vacíos."
          />
          <div className="flex flex-col gap-2">
            {SERVICIOS_SUGERIDOS.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-lg border border-line px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{s.nombre}</span>
                <InputMoneda
                  aria-label={`Precio de ${s.nombre} en pesos colombianos`}
                  value={precios[s.id] ?? null}
                  onValueChange={(pesos) => setPrecios((prev) => ({ ...prev, [s.id]: pesos }))}
                  className="w-40 shrink-0"
                />
              </div>
            ))}
          </div>
          <FieldDescription>
            Se crean con IVA 19% (gravado), que es el valor por defecto del catálogo. Puedes cambiarlo
            —y agregar productos y medicamentos— en Facturación → Catálogo.
          </FieldDescription>
          <Acciones
            onSaltar={() => setPaso(P_PACIENTE)}
            principal={
              <Button onClick={crearServicios} disabled={busy || cuantosServicios(precios) === 0}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {cuantosServicios(precios) === 1
                  ? "Crear 1 servicio"
                  : `Crear ${cuantosServicios(precios)} servicios`}
              </Button>
            }
          />
        </div>
      )}

      {paso === P_PACIENTE && yaHecho?.paciente && (
        <YaEstaListo
          icono={<PawPrint className="size-5" />}
          titulo="Ya tienes pacientes cargados"
          sub="No hace falta volver a empezar: los nuevos se agregan desde Pacientes."
          onSeguir={() => setPaso(P_EJEMPLO)}
        />
      )}

      {paso === P_PACIENTE && !yaHecho?.paciente && (
        <div className="flex flex-col gap-5">
          <Encabezado
            icono={<PawPrint className="size-5" />}
            titulo="Tu primer paciente"
            sub="Cárgalo ahora o hazlo después desde Pacientes — como prefieras."
          />
          <Field>
            <FieldLabel htmlFor="owner-name">Nombre del titular</FieldLabel>
            <Input
              id="owner-name"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Ana Restrepo"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="owner-phone">Teléfono (opcional)</FieldLabel>
            <Input
              id="owner-phone"
              value={ownerPhone}
              onChange={(e) => setOwnerPhone(e.target.value)}
              placeholder="+57 300 123 4567"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
            <Field>
              <FieldLabel htmlFor="pet-name">Nombre de la mascota</FieldLabel>
              <Input
                id="pet-name"
                value={petName}
                onChange={(e) => setPetName(e.target.value)}
                placeholder="Luna"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="pet-species">Especie</FieldLabel>
              <Input
                id="pet-species"
                value={petSpecies}
                onChange={(e) => setPetSpecies(e.target.value)}
                placeholder="Perro"
              />
            </Field>
          </div>
          <Acciones
            onSaltar={() => setPaso(P_EJEMPLO)}
            principal={
              <Button onClick={crearPrimerPaciente} disabled={busy || !ownerName.trim() || !petName.trim()}>
                {busy && <Loader2 className="size-4 animate-spin" />} Registrar paciente
              </Button>
            }
          />
        </div>
      )}

      {paso === P_EJEMPLO && (
        <div className="flex flex-col gap-5">
          <Encabezado
            icono={<Sparkles className="size-5" />}
            titulo="¿Quieres un ejemplo para explorar?"
            sub="Creamos a “Luna (ejemplo)” con una consulta ya transcrita y su nota SOAP en borrador, para que veas el Modo Fantasma sin grabar nada. Se borra de un clic cuando quieras."
          />
          <Acciones
            onSaltar={() => setPaso(P_EQUIPO)}
            principal={
              <Button onClick={crearDatosDeEjemplo} disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />} Crear ejemplo
              </Button>
            }
          />
        </div>
      )}

      {paso === P_EQUIPO && (
        <div className="flex flex-col gap-5">
          <Encabezado
            icono={<UserPlus className="size-5" />}
            titulo="Invita a tu equipo"
            sub="Quien acepte entra directo a esta clínica, sin volver a configurar nada."
          />
          {inviteLink ? (
            <div className="flex flex-col gap-2 rounded-xl border bg-muted/40 p-4">
              <p className="text-sm font-medium">Invitación lista</p>
              <div className="flex items-center gap-2">
                <Input readOnly value={inviteLink} className="text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(inviteLink)
                    toast.success("Enlace copiado")
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              {/* ANTES DECÍA SIEMPRE «También le llega por correo», pasara lo que pasara — y como
                  el correo no se mandaba nunca, era literalmente falso. Ahora la frase depende de
                  lo que ocurrió de verdad: si salió lo dice, y si no salió lo dice también, en vez
                  de dejar al vet esperando un mail que no existe. */}
              <FieldDescription>
                {inviteEnviado === true
                  ? "Ya le llegó por correo. El enlace vence en unos días."
                  : inviteEnviado === false
                    ? "El correo no salió — pasale este enlace por WhatsApp o donde prefieras. Vence en unos días."
                    : "El enlace vence en unos días."}
              </FieldDescription>
            </div>
          ) : (
            <form onSubmit={invitarColega} className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="invite-email">Correo del colega</FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colega@clinica.com"
                />
              </Field>
              <Button type="submit" variant="outline" disabled={busy || !inviteEmail.trim()}>
                {busy && <Loader2 className="size-4 animate-spin" />} Enviar invitación
              </Button>
            </form>
          )}
          <Button onClick={terminar} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Entrar a Tuvetia
          </Button>
        </div>
      )}

      {/* Salida rápida, siempre visible salvo en el último paso (que ya tiene su botón). */}
      {paso > P_CLINICA && paso < P_EQUIPO && (
        <button
          type="button"
          onClick={terminar}
          disabled={busy}
          className="text-xs text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
        >
          Saltar todo y entrar
        </button>
      )}
    </div>
  )
}

function Encabezado({ icono, titulo, sub }: { icono: React.ReactNode; titulo: string; sub: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        {icono}
      </div>
      <h1 className="text-xl font-bold">{titulo}</h1>
      <p className="text-sm text-muted-foreground">{sub}</p>
    </div>
  )
}

/**
 * Un paso que la clínica ya resolvió.
 *
 * NO SE SALTA SOLO, se muestra. Avanzar en silencio dejaría al vet viendo pasar pantallas sin
 * entender por qué, y el wizard perdería lo único que aporta sobre el riel del dashboard: contar qué
 * hace falta y por qué. Acá el mensaje es el contenido — "esto ya está, seguimos".
 *
 * Tampoco ofrece editar: para eso están las pantallas de verdad, que hacen bien ese trabajo. Un
 * segundo lugar donde tocar los horarios es un segundo lugar donde puedan quedar distintos.
 */
function YaEstaListo({
  icono,
  titulo,
  sub,
  onSeguir,
}: {
  icono: React.ReactNode
  titulo: string
  sub: string
  onSeguir: () => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <Encabezado icono={icono} titulo={titulo} sub={sub} />
      <div className="flex items-center justify-center gap-2 rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
        <Check aria-hidden className="size-4 shrink-0 text-primary" />
        Lo puedes cambiar cuando quieras desde Configuración.
      </div>
      <Button onClick={onSeguir}>Continuar</Button>
    </div>
  )
}

function Acciones({ onSaltar, principal }: { onSaltar: () => void; principal: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Button type="button" variant="ghost" onClick={onSaltar}>
        Ahora no
      </Button>
      {principal}
    </div>
  )
}
