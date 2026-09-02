"use client"

// Conexión de WhatsApp de la clínica. Dos caminos según configuración del servidor:
//  - Meta directo (NEXT_PUBLIC_META_APP_ID + NEXT_PUBLIC_META_ES_CONFIG_ID): Embedded Signup de
//    Meta en un POPUP dentro de tuvetia — sin redirects. Coexistencia: el vet escanea el QR con su
//    app de WhatsApp Business y sigue usando el teléfono como siempre.
//  - Kapso (fallback/legado): setup link hosteado (navega fuera y vuelve con ?whatsapp=connected).

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, MessageCircle, QrCode, RefreshCw, Unplug } from "lucide-react"
import { toast } from "sonner"

import { BarraDeAutonomia } from "@/components/settings/barra-de-autonomia"
import type { NivelDeAutonomia } from "@/lib/whatsapp/nivel-de-autonomia"
import type { Requisito } from "@/lib/whatsapp/requisitos-del-modo-automatico"
import { Button } from "@/components/ui/button"

type WaStatus = "none" | "pending" | "connected" | "disconnected"

const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID
const META_ES_CONFIG_ID = process.env.NEXT_PUBLIC_META_ES_CONFIG_ID
const metaEnabled = Boolean(META_APP_ID && META_ES_CONFIG_ID)
// Evolution (Baileys, no oficial): QR dentro de tuvetia, sin trámites. Activado por env.
const evolutionEnabled = process.env.NEXT_PUBLIC_WA_PROVIDER === "evolution"

type FBLoginResponse = { authResponse?: { code?: string } | null }
type FBSdk = {
  init: (opts: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }) => void
  login: (cb: (res: FBLoginResponse) => void, opts: Record<string, unknown>) => void
}
declare global {
  interface Window {
    FB?: FBSdk
    fbAsyncInit?: () => void
  }
}

function loadFacebookSdk(): Promise<FBSdk> {
  return new Promise((resolve, reject) => {
    if (window.FB) return resolve(window.FB)
    window.fbAsyncInit = () => {
      window.FB!.init({ appId: META_APP_ID!, autoLogAppEvents: true, xfbml: false, version: "v23.0" })
      resolve(window.FB!)
    }
    const s = document.createElement("script")
    s.src = "https://connect.facebook.net/es_LA/sdk.js"
    s.async = true
    s.defer = true
    s.onerror = () => reject(new Error("No se pudo cargar el SDK de Facebook"))
    document.body.appendChild(s)
  })
}

export function WhatsappSettings({
  initialStatus,
  initialPhone,
  initialAgentMode = "review",
  initialConfirmaSolo = false,
  cupoAutoDeHoy = null,
  requisitos = [],
}: {
  initialStatus: WaStatus
  initialPhone: string | null
  initialAgentMode?: "auto" | "review" | "paused" | "intervene"
  /** Nivel 3 ya encendido (`whatsapp_integrations.confirma_citas_solo`). */
  initialConfirmaSolo?: boolean
  /** Respuestas auto que la clínica puede enviar hoy (la rampa, contada en el servidor). */
  cupoAutoDeHoy?: number | null
  /** Lo que le falta a la clínica para que el modo automático funcione de verdad. Ver la barra. */
  requisitos?: Requisito[]
}) {
  const router = useRouter()
  const [status, setStatus] = useState<WaStatus>(initialStatus)
  const [phone, setPhone] = useState<string | null>(initialPhone)
  const [agentMode, setAgentMode] = useState(initialAgentMode)
  const [confirmaSolo, setConfirmaSolo] = useState(initialConfirmaSolo)
  const [busy, setBusy] = useState(false)
  // Flujo Evolution (QR embebido + consentimiento de integración no oficial)
  const [qr, setQr] = useState<string | null>(null)
  // El servidor no tiene la integración configurada. Sólo se sabe al intentar conectar —la clave
  // vive en el servidor y no se filtra al cliente—, así que arranca en falso y lo enciende la
  // respuesta del endpoint.
  const [noHabilitado, setNoHabilitado] = useState(false)
  const [confirmandoBaja, setConfirmandoBaja] = useState(false)
  const [needsConsent, setNeedsConsent] = useState(evolutionEnabled && initialStatus === "none")
  const [consentChecked, setConsentChecked] = useState(false)
  const checked = useRef(false)
  // El evento WA_EMBEDDED_SIGNUP (postMessage del popup de Meta) trae waba_id + phone_number_id;
  // el code llega por el callback de FB.login. Se necesitan LOS DOS para /exchange.
  const sessionInfo = useRef<{ waba_id?: string; phone_number_id?: string }>({})

  useEffect(() => {
    if (!metaEnabled) return
    function onMessage(event: MessageEvent) {
      if (!event.origin.endsWith("facebook.com")) return
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data
        if (data?.type === "WA_EMBEDDED_SIGNUP" && data.data) {
          sessionInfo.current = {
            waba_id: data.data.waba_id ?? sessionInfo.current.waba_id,
            phone_number_id: data.data.phone_number_id ?? sessionInfo.current.phone_number_id,
          }
        }
      } catch {
        // mensajes de otros orígenes de FB que no son JSON: ignorar
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  // Mientras el QR de Evolution esté visible: pollear la conexión cada 3 s y refrescar el QR
  // cada 25 s (rota del lado de WhatsApp).
  useEffect(() => {
    if (!qr) return
    const poll = setInterval(() => {
      void (async () => {
        const res = await fetch("/api/whatsapp/status", { method: "POST" })
        const json = (await res.json().catch(() => ({}))) as { status?: WaStatus; phone_number?: string | null }
        if (json.status === "connected") {
          setQr(null)
          setStatus("connected")
          setPhone(json.phone_number ?? null)
          toast.success("WhatsApp conectado")
          router.refresh()
        }
      })()
    }, 3000)
    const refreshQr = setInterval(() => {
      void (async () => {
        const res = await fetch("/api/whatsapp/evolution/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
        const json = (await res.json().catch(() => ({}))) as { qr?: string | null }
        if (json.qr) setQr(json.qr)
      })()
    }, 25000)
    return () => {
      clearInterval(poll)
      clearInterval(refreshQr)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qr === null])

  // Al volver del setup link de Kapso (?whatsapp=connected), verificar la conexión una vez.
  useEffect(() => {
    if (checked.current) return
    const url = new URL(window.location.href)
    if (url.searchParams.get("whatsapp") !== "connected") return
    checked.current = true
    url.searchParams.delete("whatsapp")
    window.history.replaceState({}, "", url.toString())
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function connectMeta() {
    setBusy(true)
    try {
      const FB = await loadFacebookSdk()
      sessionInfo.current = {}
      const code = await new Promise<string>((resolve, reject) => {
        FB.login(
          (res) => {
            const c = res.authResponse?.code
            if (c) resolve(c)
            else reject(new Error("Conexión cancelada"))
          },
          {
            config_id: META_ES_CONFIG_ID,
            response_type: "code",
            override_default_response_type: true,
            extras: {
              sessionInfoVersion: "3",
              // Coexistencia: QR + opción de compartir el historial; el vet conserva su app.
              featureType: "whatsapp_business_app_onboarding",
            },
          },
        )
      })
      // El postMessage puede llegar unos ms después del callback del login.
      const info = await new Promise<{ waba_id?: string; phone_number_id?: string }>((resolve) => {
        let tries = 0
        const t = setInterval(() => {
          tries += 1
          if ((sessionInfo.current.waba_id && sessionInfo.current.phone_number_id) || tries > 20) {
            clearInterval(t)
            resolve(sessionInfo.current)
          }
        }, 250)
      })
      if (!info.waba_id || !info.phone_number_id) {
        throw new Error("Meta no devolvió los datos del número. Vuelve a intentar la conexión.")
      }
      const res = await fetch("/api/whatsapp/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, waba_id: info.waba_id, phone_number_id: info.phone_number_id }),
      })
      const json = (await res.json().catch(() => ({}))) as { phone_number?: string | null; error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setStatus("connected")
      setPhone(json.phone_number ?? null)
      toast.success("WhatsApp conectado")
      router.refresh()
    } catch (e) {
      toast.error(`No se pudo conectar: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function connectKapso() {
    setBusy(true)
    try {
      const res = await fetch("/api/whatsapp/connect", { method: "POST" })
      const json = (await res.json()) as { setup_url?: string; error?: string; no_habilitado?: boolean }
      // «No está habilitado en esta instalación» NO es un toast. Un toast dice «fallá y volvé a
      // intentar», y acá no hay nada que reintentar: sin `KAPSO_API_KEY` en el servidor el botón no
      // va a funcionar nunca. Se queda escrito en la pantalla y el botón desaparece, que es lo que
      // ya hace Correo cuando Composio no está configurado.
      if (res.status === 503 && json.no_habilitado) {
        setNoHabilitado(true)
        setBusy(false)
        return
      }
      if (!res.ok || !json.setup_url) throw new Error(json.error ?? `HTTP ${res.status}`)
      window.location.href = json.setup_url // el QR vive en la página hosteada de Kapso
    } catch (e) {
      toast.error(`No se pudo iniciar la conexión: ${(e as Error).message}`)
      setBusy(false)
    }
  }

  // Evolution: QR dentro de la app. El QR rota (~40 s) → se re-pide cada 25 s mientras esté
  // visible, y se pollea /status cada 3 s hasta que el escaneo conecte.
  async function connectEvolution() {
    if (needsConsent && !consentChecked) {
      toast.error("Debes aceptar el aviso para conectar")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/whatsapp/evolution/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: consentChecked }),
      })
      const json = (await res.json().catch(() => ({}))) as { qr?: string | null; state?: string; error?: string }
      if (res.status === 428) {
        setNeedsConsent(true)
        toast.info("Lee y acepta el aviso para continuar")
        return
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      if (json.state === "open") {
        setStatus("connected")
        toast.success("WhatsApp conectado")
        router.refresh()
        return
      }
      if (json.qr) setQr(json.qr)
      else toast.info("Generando el código QR… intenta de nuevo en unos segundos")
    } catch (e) {
      toast.error(`No se pudo iniciar la conexión: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const connect = evolutionEnabled ? connectEvolution : metaEnabled ? connectMeta : connectKapso

  async function refresh(silencioso = false) {
    if (!silencioso) setBusy(true)
    try {
      const res = await fetch("/api/whatsapp/status", { method: "POST" })
      const json = (await res.json()) as {
        status?: WaStatus
        phone_number?: string | null
        reason?: string
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setStatus(json.status ?? "pending")
      setPhone(json.phone_number ?? null)
      // En la comprobación automática de la carga no se avisa NADA cuando todo está bien: un toast
      // «WhatsApp conectado» cada vez que se abre la pantalla es ruido. Sí se avisa si la línea se
      // cayó, porque eso es exactamente lo que el vet vino a saber sin saberlo.
      if (silencioso) {
        if (json.status !== "connected") {
          toast.warning("WhatsApp se desconectó. Volvé a escanear el QR para seguir recibiendo mensajes.")
          router.refresh()
        }
        return
      }
      if (json.status === "connected") toast.success("WhatsApp conectado")
      else if (json.reason === "sin_numero_todavia")
        toast.info("Todavía no hay un número vinculado. Completa el escaneo del QR y vuelve a verificar.")
      else if (json.reason === "numero_desvinculado")
        toast.warning("El número se desvinculó (¿se desconectó desde el teléfono?). Reconecta para seguir recibiendo mensajes.")
      router.refresh()
    } catch (e) {
      // La comprobación automática NO grita cuando falla: el vet no la pidió, y un error rojo al
      // abrir la pantalla por un hipo del proveedor asusta sin darle nada que hacer. Se queda con
      // el estado guardado, que es el comportamiento de siempre.
      if (silencioso) console.warn("whatsapp: no se pudo comprobar el estado al abrir:", e)
      else toast.error(`No se pudo verificar la conexión: ${(e as Error).message}`)
    } finally {
      if (!silencioso) setBusy(false)
    }
  }

  // ── DESCONECTAR, QUE ERA UNA PROMESA SIN CUMPLIR ────────────────────────────────────────────
  //
  // El aviso que el vet acepta para conectar dice, literal: «el riesgo sobre el número es de la
  // clínica. Puedo desconectar cuando quiera». Se podía conectar y no se podía desconectar — la
  // ruta existía desde el 30-ago y ningún botón la llamaba. Y sin desconectar tampoco se puede
  // CAMBIAR de número, que es lo que lo hizo evidente.
  async function desconectar() {
    setBusy(true)
    try {
      const res = await fetch("/api/whatsapp/disconnect", { method: "POST" })
      const json = (await res.json().catch(() => ({}))) as { error?: string; proveedor_avisado?: boolean }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setStatus("disconnected")
      setPhone(null)
      // El modo automático vuelve a «sólo sugerir» del lado del servidor: reconectar tiene que ser
      // reconectar y nada más, no reanudar un bot que nadie volvió a autorizar.
      setAgentMode("review")
      setConfirmaSolo(false)
      setConfirmandoBaja(false)
      if (json.proveedor_avisado === false) {
        toast.warning(
          "Tuvetia quedó desconectado, pero no pudimos cerrar la sesión en tu teléfono. Sacá «Tuvetia» de Dispositivos vinculados en WhatsApp.",
        )
      } else {
        toast.success("WhatsApp desconectado. Podés vincular otro número escaneando el QR.")
      }
      router.refresh()
    } catch (e) {
      toast.error(`No se pudo desconectar: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  // ── LA PANTALLA SE CORRIGE SOLA AL ABRIRLA (2-sep) ──────────────────────────────────────────
  //
  // `whatsapp_integrations.status` es una foto: se escribe al conectar, cuando llega un
  // `connection.update` del proveedor, o cuando alguien aprieta «Verificar». Si el vet desvincula
  // desde el teléfono y ese evento no llega, la columna se queda en `connected` PARA SIEMPRE y esta
  // pantalla la pinta tal cual — «Conectado · 573107663149» sobre una línea muerta. Reportado con
  // captura: el vet ve verde, escribe, y recibe un 500 que no explica nada.
  //
  // Que el estado real dependa de que alguien se acuerde de apretar un botón es el defecto. Ésta es
  // la pantalla de las conexiones: comprobarlo es literalmente su trabajo.
  //
  // Sólo cuando dice «conectado», y sólo una vez por montaje: es el único caso donde la foto puede
  // estar mintiendo en la dirección peligrosa. Si ya dice desconectado o pendiente, la pantalla ya
  // muestra el QR y no hay nada que corregir.
  const comprobado = useRef(false)
  useEffect(() => {
    if (comprobado.current || initialStatus !== "connected") return
    comprobado.current = true
    void refresh(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function cambiarModo(next: NivelDeAutonomia) {
    setBusy(true)
    try {
      const res = await fetch("/api/whatsapp/agent-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      // Las dos mitades del estado se mueven juntas, igual que en el servidor: bajar de `confirma`
      // a `auto` tiene que apagar la confirmación automática también acá, o la barra pintaría el
      // nivel 3 hasta la próxima recarga.
      setAgentMode(next === "review" ? "review" : "auto")
      setConfirmaSolo(next === "confirma")
      toast.success(
        next === "confirma"
          ? "VetGPT agenda y confirma solo: crea el titular, la mascota y la cita, y le avisa al titular"
          : next === "auto"
            ? "Encendidas: VetGPT le responde a todo el que escriba — sólo lo no clínico"
            : "Apagadas: VetGPT vuelve a solo sugerir — nada sale sin tu aprobación",
      )
    } catch (e) {
      toast.error(`No se pudo cambiar el modo: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  if (status === "connected") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm">
            <MessageCircle className="size-4 text-ok" />
            Conectado{phone ? <span className="text-muted-foreground">· {phone}</span> : null}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Verificar
            </Button>
            {/* DESCONECTAR CUESTA UN PASO MÁS, igual que desactivar una cuenta: corta la línea
                ENTERA de la clínica y lo que entre mientras tanto no llega a la bandeja ni se
                encola. Un clic suelto no puede hacer eso. */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmandoBaja((v) => !v)}
              disabled={busy}
              title="Desconectar este número"
            >
              <Unplug className="size-4" />
              Desconectar
            </Button>
          </div>
        </div>

        {confirmandoBaja && (
          <div className="flex flex-col gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3">
            {/* Qué se pierde y qué NO. «Desconectar» se lee como «borrar las conversaciones», y no
                lo es: se corta el cable, no lo que se dijo. Decirlo es lo que hace que el botón se
                pueda usar sin miedo — y lo que hace posible cambiar de número, que es para lo que
                la mayoría lo va a apretar. */}
            <p className="text-sm">
              Se corta la línea: mientras esté desconectado, <b>los mensajes que te escriban no van a
              llegar</b> a Tuvetia ni quedan guardados en ningún lado. Las conversaciones que ya
              tenés <b>no se borran</b>, y podés vincular otro número escaneando el QR.
            </p>
            <p className="text-xs text-muted-foreground">
              VetGPT vuelve a «sólo sugerir»: al reconectar tenés que volver a encender las
              respuestas automáticas.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmandoBaja(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button size="sm" variant="destructive" onClick={() => void desconectar()} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Unplug className="size-4" />}
                Desconectar
              </Button>
            </div>
          </div>
        )}
        {/* ── LA BARRA DE AUTONOMÍA (28-ago, pedido de Luciano) ──────────────────────────────
            Reemplaza al switch binario del mismo día: la barrita gradúa el nivel de libertad del
            agente y muestra a dónde va (el tercer nivel, bloqueado, «se gana con el uso»). El
            endpoint es el mismo; los dos niveles operables son los dos valores que la API acepta. */}
        <BarraDeAutonomia
          modo={agentMode}
          confirmaSolo={confirmaSolo}
          ocupado={busy}
          onCambiar={(siguiente) => void cambiarModo(siguiente)}
          cupoAutoDeHoy={cupoAutoDeHoy}
          requisitos={requisitos}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Conecta el WhatsApp de tu clínica para centralizar la comunicación con los titulares.
        Escaneás un código QR y <b>seguís usando tu teléfono como siempre</b>; los mensajes también
        llegan a Tuvetia.
      </p>
      {!evolutionEnabled && (
        <p className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
          <b>Requisito:</b> el número debe usar la app <b>WhatsApp Business</b> (la aplicación gratuita
          de Meta). Si hoy usás WhatsApp personal, convertí el número desde la app WhatsApp Business —
          conservás chats y contactos.
        </p>
      )}
      {status === "disconnected" && (
        <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
          El número se desvinculó y los mensajes nuevos <b>no están llegando a Tuvetia</b>. Reconecta
          escaneando el QR de nuevo.
        </p>
      )}
      {evolutionEnabled && needsConsent && !qr && (
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={consentChecked}
            onChange={(e) => setConsentChecked(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Entiendo que esta integración usa el protocolo de WhatsApp Web y <b>no es una API oficial
            de Meta</b>. Existe un riesgo de que WhatsApp restrinja o suspenda el número si detecta
            automatización. Tuvetia aplica protecciones (solo responde mensajes entrantes, con
            límites y cadencia humana) y guarda copia de todas las conversaciones, pero el riesgo
            sobre el número es de la clínica. Puedo desconectar cuando quiera.
          </span>
        </label>
      )}
      {qr && (
        <div className="flex flex-col items-center gap-2 rounded-lg border p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Código QR para vincular WhatsApp" className="size-52 rounded-md bg-white p-2" />
          <p className="text-center text-xs text-muted-foreground">
            En tu teléfono: <b>WhatsApp → Ajustes → Dispositivos vinculados → Vincular dispositivo</b>{" "}
            y escanea este código. Se refresca solo si expira.
          </p>
          <Button size="sm" variant="ghost" onClick={() => setQr(null)}>
            Cancelar
          </Button>
        </div>
      )}
      {/* ── LO QUE ANTES ERA UN TOAST QUE SE IBA ────────────────────────────────────────────────
          Sin la integración configurada en el servidor, el vet apretaba «Conectar WhatsApp», veía
          un mensaje rojo unos segundos y volvía a un botón idéntico al de antes. Nada le decía que
          no era él: apretaba otra vez, y otra. Esto se queda escrito y retira el botón, porque no
          hay nada que él pueda hacer — es la misma distinción que hace Correo con Composio. */}
      {noHabilitado && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-xs text-fg-muted">
          <p>
            <b className="text-fg">WhatsApp todavía no está habilitado en esta instalación.</b> No es
            algo que puedas configurar vos: cuando quede lista, vas a poder conectar el número desde
            acá sin hacer nada más.
          </p>
          <p>
            Mientras tanto el resto de Tuvetia funciona igual, y los recordatorios de cita se pueden
            mandar por correo.
          </p>
        </div>
      )}
      {!qr && !noHabilitado && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={connect} disabled={busy || (evolutionEnabled && needsConsent && !consentChecked)}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
            {status === "pending" ? "Continuar conexión" : status === "disconnected" ? "Reconectar WhatsApp" : "Conectar WhatsApp"}
          </Button>
          {/* En arrow y no `onClick={refresh}`: desde que `refresh` toma un parámetro, pasarlo
              directo le entregaría el evento del clic como `silencioso` — y un MouseEvent es
              truthy, así que la verificación que el vet pidió a mano correría en silencio. */}
          {(status === "pending" || status === "disconnected") && (
            <Button variant="outline" onClick={() => void refresh()} disabled={busy}>
              Verificar conexión
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
