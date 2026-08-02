"use client"

// Conexión de correo de la clínica — réplica del patrón `conn-card` del repo del cliente
// (integrations/ProviderCard.tsx + ConnectWhatsAppForm.tsx): tile con icono, nombre + badge de
// estado con dot, filas clave→valor con separador punteado (info-list) y form dentro de la card
// con sus clases de input/botón. Mismos tokens (fg, fg-muted, line-soft, ok, warn, brand).

import { useActionState, useState } from "react"
import { AlertTriangle, CheckCircle2, Mail } from "lucide-react"

import {
  connectEmailAction,
  connectMyEmailAction,
  disconnectEmailAction,
  disconnectMyEmailAction,
  type EmailActionState,
} from "@/lib/email/actions"

/** Clases compartidas del input (estilo .input del rediseño del cliente, calcadas). */
const inputClass =
  "mt-2 h-9 w-full rounded-md border border-input bg-card px-[11px] text-[13.5px] text-fg placeholder:text-muted-foreground transition focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-[color-mix(in_srgb,var(--accent)_16%,transparent)]"

export interface EmailIntegrationView {
  status: "pending" | "connected" | "error" | "disconnected"
  from_email: string
  from_name: string | null
  last_error: string | null
  verified_at: string | null
}

export function EmailSettings({
  integration,
  // `scope` decide de quién es la cuenta (migración 0051): la institucional de la clínica manda
  // facturas y cobranza; la personal es la bandeja del miembro y lo que Athos envía por él. El
  // formulario es el mismo — cambia a qué server action va.
  scope = "clinic",
}: {
  integration: EmailIntegrationView | null
  scope?: "clinic" | "personal"
}) {
  const personal = scope === "personal"
  const [connectState, connectAction, connecting] = useActionState<EmailActionState, FormData>(
    personal ? connectMyEmailAction : connectEmailAction,
    null,
  )
  const [disconnecting, setDisconnecting] = useState(false)
  const [showForm, setShowForm] = useState(false)

  // El estado del server component manda; el resultado del action solo adelanta el éxito hasta que
  // revalidatePath refresque la página.
  const isConnected = integration?.status === "connected" || connectState?.ok === true
  const isError = !connectState?.ok && integration?.status === "error"
  const formVisible = showForm || (!isConnected && !integration) || isError

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      await (personal ? disconnectMyEmailAction() : disconnectEmailAction())
    } finally {
      setDisconnecting(false)
      setShowForm(false)
    }
  }

  return (
    <div className="flex flex-col gap-[13px] rounded-lg border border-line-soft bg-card p-[18px] shadow-sm">
      {/* top: tile del icono + nombre + badge de estado con dot */}
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] border border-line-soft bg-muted">
          <Mail className="size-[19px] text-info" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-fg">Correo — Gmail</span>
          <span className="block truncate text-xs text-fg-muted">
            {isConnected && integration?.from_email
              ? integration.from_email
              : "Facturas y recordatorios por correo, desde la cuenta de la clínica"}
          </span>
        </span>

        {isConnected ? (
          <span className="inline-flex h-[21px] shrink-0 items-center gap-[5px] rounded-full bg-[color-mix(in_srgb,var(--ok)_14%,transparent)] px-2 text-[11.5px] font-medium text-ok">
            <span className="size-[5px] rounded-full bg-current" aria-hidden />
            Conectado
          </span>
        ) : isError ? (
          <span className="inline-flex h-[21px] shrink-0 items-center gap-[5px] rounded-full bg-[color-mix(in_srgb,var(--warn)_16%,transparent)] px-2 text-[11.5px] font-medium text-warn">
            <span className="size-[5px] rounded-full bg-current" aria-hidden />
            Reconectar
          </span>
        ) : (
          <span className="inline-flex h-[21px] shrink-0 items-center rounded-full border border-line bg-card px-2 text-[11.5px] font-medium text-fg-muted">
            No conectado
          </span>
        )}
      </div>

      {/* info-list: filas clave→valor con separador punteado */}
      {isConnected && integration && (
        <div className="flex flex-col">
          <InfoRow k="Envío (SMTP)" v="smtp.gmail.com · verificado" />
          <InfoRow k="Remitente" v={integration.from_name ?? integration.from_email} />
          <InfoRow
            k="Respuestas"
            v="Se leen por IMAP y alimentan la cobranza (próximamente)"
          />
        </div>
      )}

      {/* Motivo del último fallo, accionable */}
      {isError && integration?.last_error && (
        <div className="flex items-start gap-2 rounded-lg border border-[color-mix(in_srgb,var(--warn)_30%,transparent)] bg-card px-3.5 py-2.5 text-[13px] text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {integration.last_error}
        </div>
      )}
      {connectState?.ok && (
        <div className="flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--ok)_30%,transparent)] bg-card px-3.5 py-2.5 text-[13px] text-ok">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          Correo conectado y verificado.
        </div>
      )}

      {/* form dentro de la card (patrón ConnectWhatsAppForm) */}
      {formVisible && !isConnected ? (
        <form action={connectAction} className="space-y-4">
          <div>
            <label htmlFor="from_email" className="block text-xs font-semibold tracking-[0.02em] text-fg">
              Correo de la clínica
            </label>
            <p className="mt-0.5 text-xs text-fg-faint">La cuenta de Gmail desde la que salen las facturas.</p>
            <input
              id="from_email"
              name="from_email"
              type="email"
              required
              defaultValue={integration?.from_email ?? ""}
              placeholder="clinica@gmail.com"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="from_name" className="block text-xs font-semibold tracking-[0.02em] text-fg">
              Nombre visible
            </label>
            <p className="mt-0.5 text-xs text-fg-faint">Opcional, ej. Veterinaria San Martín.</p>
            <input
              id="from_name"
              name="from_name"
              type="text"
              defaultValue={integration?.from_name ?? ""}
              placeholder="Veterinaria San Martín"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="credential" className="block text-xs font-semibold tracking-[0.02em] text-fg">
              Contraseña de aplicación
            </label>
            <p className="mt-0.5 text-xs text-fg-faint">
              No es la contraseña de la cuenta: se genera en{" "}
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                myaccount.google.com/apppasswords
              </a>{" "}
              (requiere verificación en dos pasos). Podés pegarla con espacios.
            </p>
            <input
              id="credential"
              name="credential"
              type="password"
              required
              autoComplete="off"
              placeholder="xxxx xxxx xxxx xxxx"
              className={inputClass}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={connecting}
              className="inline-flex h-9 items-center gap-[7px] rounded-md bg-brand px-3.5 text-[13.5px] font-medium text-on-brand shadow-sm transition hover:bg-brand-deep disabled:opacity-60"
            >
              {connecting ? "Verificando…" : "Conectar correo"}
            </button>
            {!connecting && connectState && !connectState.ok && (
              <span className="inline-flex items-center gap-1 text-xs text-warn">
                <AlertTriangle className="size-3.5" aria-hidden />
                {connectState.error}
              </span>
            )}
          </div>
        </form>
      ) : (
        /* acciones por card */
        isConnected && (
          <div className="flex items-center gap-[7px]">
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex h-[30px] items-center gap-[7px] rounded-[7px] border border-input bg-card px-2.5 text-[12.5px] font-medium text-fg shadow-sm transition hover:bg-accent"
            >
              Cambiar cuenta
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="inline-flex h-[30px] items-center gap-[7px] rounded-[7px] border border-input bg-card px-2.5 text-[12.5px] font-medium text-fg shadow-sm transition hover:bg-accent disabled:opacity-60"
            >
              {disconnecting ? "Desconectando…" : "Desconectar"}
            </button>
          </div>
        )
      )}
    </div>
  )
}

function InfoRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2.5 border-b border-dashed border-line-soft py-2 text-[13px] last:border-b-0">
      <span className="text-fg-muted">{k}</span>
      <span className="text-right font-medium text-fg">{v}</span>
    </div>
  )
}
