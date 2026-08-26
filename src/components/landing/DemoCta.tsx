"use client";
import { useState } from "react";
import Image from "next/image";
import { v } from "@/lib/landing/vars";
import { buildWaLink, MEET_SCHEDULING_URL } from "@/lib/landing/contact";
import demoBg from "@/public/media/pilar-conversacion.png";

const CHIPS = ["VetSoft", "Clinvet", "VetPraxis", "Vet Cloud", "Otro", "Papel / Excel"];

function buildDemoMessage(name: string, clinic: string, software: string | null): string {
  const n = name.trim(),
    c = clinic.trim();
  const parts: string[] = [n ? `Hola, soy ${n}${c ? `, de ${c}` : ""}.` : "Hola."];
  if (software)
    parts.push(software === "Papel / Excel" ? "Hoy llevo mis fichas en papel / Excel." : `Hoy uso ${software}.`);
  parts.push("Quiero agendar una demo de TU VET IA.");
  return parts.join(" ");
}

export default function DemoCta() {
  const [mode, setMode] = useState<"wa" | "meet">("wa");
  const [name, setName] = useState("");
  const [clinic, setClinic] = useState("");
  const [software, setSoftware] = useState<string | null>(null);

  return (
    <section className="dem" id="demo">
      <div className="dem-bg" aria-hidden="true">
        <Image src={demoBg} alt="" fill placeholder="blur" sizes="100vw" />
      </div>
      <div className="dbox">
        <div className="kicker st" style={v({ i: 0, y: "10px", d: ".65s" })}>
          Demo
        </div>
        <h2 style={{ fontSize: "clamp(28px,3.4vw,42px)" }}>
          <span className="ln" style={v({ i: 1 })}>
            <span>Que VetGPT escriba</span>
          </span>
          <span className="ln" style={v({ i: 2 })}>
            <span>una consulta tuya.</span>
          </span>
        </h2>
        <p className="lede st" style={v({ i: 5, y: "22px", d: "1s" }, { marginBottom: 30 })}>
          15 minutos. Traes un caso real, lo cuentas en voz alta, y ves la nota escribirse. Si no te sirve, nos lo
          dices y ya.
        </p>
        <div className="seg st" style={v({ i: 7, y: "14px" })} aria-label="Cómo prefieres agendar">
          <button type="button" aria-pressed={mode === "wa"} onClick={() => setMode("wa")}>
            WhatsApp
          </button>
          <button type="button" aria-pressed={mode === "meet"} onClick={() => setMode("meet")}>
            Meet
          </button>
        </div>
        {mode === "wa" ? (
          <div className="form">
            <div className="frow">
              <input
                className="inp st"
                style={v({ i: 8, y: "16px" })}
                placeholder="Tu nombre"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className="inp st"
                style={v({ i: 9, y: "16px" })}
                placeholder="Nombre de tu clínica (opcional)"
                value={clinic}
                onChange={(e) => setClinic(e.target.value)}
              />
            </div>
            <div className="qlab st" style={v({ i: 10, y: "12px" })}>
              ¿De dónde te estás mudando?
            </div>
            <div className="chips">
              {CHIPS.map((c, i) => (
                <button
                  type="button"
                  key={c}
                  className={`chip st${software === c ? " sel" : ""}`}
                  style={v({ i: 11 + i, y: "12px", gap: "55ms" })}
                  onClick={() => setSoftware((s) => (s === c ? null : c))}
                >
                  {c}
                </button>
              ))}
            </div>
            <a
              className="sbmt st"
              style={v({ i: 18, y: "18px" })}
              href={buildWaLink(buildDemoMessage(name, clinic, software))}
              target="_blank"
              rel="noopener"
            >
              Agendar por WhatsApp →
            </a>
          </div>
        ) : (
          <div className="form">
            <p className="mlede">
              Elige directo un espacio en nuestra agenda: te llega la invitación con el link de Meet al correo.
            </p>
            <a className="sbmt" href={MEET_SCHEDULING_URL} target="_blank" rel="noopener">
              Abrir la agenda →
            </a>
          </div>
        )}
        <div className="dalt st" style={v({ i: 20, y: "12px" })}>
          Te contesta un fundador, no un vendedor.
        </div>
      </div>
    </section>
  );
}
