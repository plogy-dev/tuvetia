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

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Clock, Copy, Loader2, PawPrint, Receipt, Sparkles, UserPlus } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
// servicio**. O sea que ninguna podía facturar y 14 no podían agendar con Athos — las dos
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
}: {
  clinicId: string
  initialClinicName: string
  initialLogoUrl: string | null
  /** Ausente = primera vez; nada está hecho. */
  yaHecho?: YaHecho
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [paso, setPaso] = useState(0)
  const [busy, setBusy] = useState(false)

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

  /** Cierra el onboarding: marca el flag y manda al dashboard. Único punto de salida. */
  async function terminar() {
    setBusy(true)
    const { error } = await supabase.rpc("mark_setup_completed")
    if (error) {
      // Si esto falla, el vet volvería a ver el wizard al recargar. Se dice, no se traga.
      toast.error(`No se pudo cerrar la configuración: ${error.message}`)
      setBusy(false)
      return
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
    toast.success(`Horarios guardados — Athos ya puede ofrecer citas`)
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

  async function invitarColega(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setBusy(true)
    const { data: token, error } = await supabase.rpc("create_invitation", {
      p_email: inviteEmail.trim(),
      p_role: "vet",
    })
    setBusy(false)
    if (error || !token) {
      toast.error(`No se pudo invitar: ${error?.message ?? "error desconocido"}`)
      return
    }
    setInviteLink(`${window.location.origin}/invitar/${token}`)
    toast.success("Invitación creada — comparte el enlace")
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Progreso */}
      <div className="flex items-center gap-1.5" aria-label={`Paso ${paso + 1} de ${PASOS.length}`}>
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
          sub="Athos ya puede ofrecer espacios libres y agendar con ellos."
          onSeguir={() => setPaso(P_SERVICIOS)}
        />
      )}

      {paso === P_HORARIOS && !yaHecho?.horarios && (
        <div className="flex flex-col gap-5">
          <Encabezado
            icono={<Clock className="size-5" />}
            titulo="¿Cuándo atiendes?"
            sub="Es lo que le permite a Athos ofrecer un espacio libre y agendar. Ya está lleno con lo habitual: ajusta lo que no cuadre."
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
                    className="w-28 shrink-0"
                  />
                  <Input
                    type="time"
                    aria-label={`${NOMBRE_DEL_DIA[d.weekday]}: cierra`}
                    value={d.closes_at}
                    disabled={!activo}
                    onChange={(e) => cambiarHora(d.weekday, "closes_at", e.target.value)}
                    className="w-28 shrink-0"
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
            sub="Sin al menos un servicio no se puede facturar una consulta. Pon el precio de los que uses; el resto déjalos vacíos."
          />
          <div className="flex flex-col gap-2">
            {SERVICIOS_SUGERIDOS.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-lg border border-line px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{s.nombre}</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="text-sm text-muted-foreground">$</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1000}
                    aria-label={`Precio de ${s.nombre} en pesos`}
                    placeholder="0"
                    value={precios[s.id] ?? ""}
                    onChange={(e) => {
                      const v = e.target.value
                      setPrecios((prev) => ({ ...prev, [s.id]: v === "" ? null : Number(v) }))
                    }}
                    className="w-32"
                  />
                </div>
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
          <div className="grid grid-cols-2 gap-3">
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
              <FieldDescription>
                También le llega por correo. El enlace vence en unos días.
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
                {busy && <Loader2 className="size-4 animate-spin" />} Crear invitación
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
