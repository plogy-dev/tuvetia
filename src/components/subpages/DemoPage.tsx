"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
// Import estático a propósito, sin `fill`: el CSS de `.demo-bg img` ya fuerza
// `width:100%;height:100%;object-fit:cover`, así que pisa las medidas intrínsecas y el layout queda
// exactamente igual que con el <img> crudo. `fill` habría cambiado el posicionamiento del elemento.
import demoBg from "@/public/media/demo.png";
import { initSubpage } from "@/lib/landing/subpage";
import { v } from "@/lib/landing/vars";
import { buildWaLink, MEET_SCHEDULING_URL } from "@/lib/landing/contact";
import Background from "@/components/landing/Background";
import Nav from "@/components/landing/Nav";

const MUDANZAS = ["VetSoft", "Clinvet", "VetPraxis", "Vet Cloud", "Papel / Excel", "Otro", "Nada aún"];
const EQUIPOS = ["Solo yo", "2–3", "4–6", "7 o más"];
const CONSULTAS = ["Menos de 10", "10–20", "20–40", "Más de 40"];

function buildMessage(
  nombre: string,
  clinica: string,
  ciudad: string,
  equipo: string,
  consultas: string,
  mudanza: string,
): string {
  const n = nombre.trim(),
    c = clinica.trim(),
    ci = ciudad.trim();
  const parts: string[] = [n ? `Hola, soy ${n}${c ? `, de ${c}` : ""}${ci ? ` (${ci})` : ""}.` : "Hola."];
  if (equipo)
    parts.push(equipo === "Solo yo" ? "En la clínica atiendo solo yo." : `En la clínica somos ${equipo} veterinarios.`);
  if (consultas) {
    const verbo = equipo === "Solo yo" ? "Atiendo" : "Atendemos";
    parts.push(
      /^(Menos|Más)/.test(consultas)
        ? `${verbo} ${consultas.toLowerCase()} consultas al día.`
        : `${verbo} unas ${consultas} consultas al día.`,
    );
  }
  if (mudanza === "Papel / Excel") parts.push("Hoy llevo mis fichas en papel / Excel.");
  else if (mudanza === "Nada aún") parts.push("Aún no uso ningún software clínico.");
  else if (mudanza) parts.push(`Hoy uso ${mudanza}.`);
  parts.push("Quiero agendar una demo de TU VET IA.");
  return parts.join(" ");
}

export default function DemoPage() {
  useEffect(() => initSubpage(), []);

  const [mode, setMode] = useState<"wa" | "meet">("wa");
  const [nombre, setNombre] = useState("");
  const [clinica, setClinica] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [equipo, setEquipo] = useState("");
  const [consultas, setConsultas] = useState("");
  const [mudanza, setMudanza] = useState("");
  const [errNombre, setErrNombre] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    const bad = !(nombre.trim().length > 1);
    setErrNombre(bad);
    if (bad) return;
    window.open(buildWaLink(buildMessage(nombre, clinica, ciudad, equipo, consultas, mudanza)), "_blank", "noopener");
  }

  const chipGroup = (label: string, opts: string[], val: string, set: (s: string) => void) => (
    <>
      <span className="mudlabel">{label}</span>
      <div className="mudchips">
        {opts.map((o) => (
          <button
            type="button"
            key={o}
            className={`mudchip${val === o ? " sel" : ""}`}
            onClick={() => set(val === o ? "" : o)}
          >
            {o}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <>
      <Background />
      <Nav back />
      <div className="pg pg-demo">
        <section className="demo in">
          <div className="demo-bg">
            <Image src={demoBg} alt="" priority sizes="100vw" placeholder="blur" />
          </div>

          <div className="wrap">
            <div className="demo-col">
              <div className="demo-head">
                <div className="kicker st" style={v({ i: 0 }, { justifyContent: "center" })}>
                  Agenda una demo
                </div>
                <h1 className="st" style={v({ i: 1, d: ".9s" })}>
                  Que VetGPT escriba <b>una consulta tuya</b>.
                </h1>
                <p className="st" style={v({ i: 2 })}>
                  <b>20 minutos</b>, un caso real, y ves la ficha escribirse sola.
                </p>
              </div>

              <div className="demo-form st" style={v({ i: 3, d: "1s" })}>
                <div className="fwrap">
                  <p className="sub">Te contesta un fundador, no un vendedor.</p>

                  <div className="segwrap">
                    <div className="seg" aria-label="Cómo prefieres agendar">
                      <button type="button" aria-pressed={mode === "wa"} onClick={() => setMode("wa")}>
                        WhatsApp
                      </button>
                      <button type="button" aria-pressed={mode === "meet"} onClick={() => setMode("meet")}>
                        Meet
                      </button>
                    </div>
                  </div>

                  {mode === "wa" ? (
                    <form onSubmit={submit} noValidate>
                      <div className={`field${errNombre ? " show-err" : ""}`}>
                        <label>
                          Tu nombre <span className="req">*</span>
                        </label>
                        <input
                          type="text"
                          name="nombre"
                          placeholder="Dra. Laura Peña"
                          autoComplete="name"
                          value={nombre}
                          onChange={(e) => setNombre(e.target.value)}
                          className={errNombre ? "err" : undefined}
                        />
                        <div className="msg">Escribe tu nombre.</div>
                      </div>

                      <div className="frow2">
                        <div className="field">
                          <label>Tu clínica</label>
                          <input
                            type="text"
                            name="clinica"
                            placeholder="Clínica Andes"
                            autoComplete="organization"
                            value={clinica}
                            onChange={(e) => setClinica(e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label>Ciudad</label>
                          <input
                            type="text"
                            name="ciudad"
                            placeholder="Bogotá"
                            autoComplete="address-level2"
                            value={ciudad}
                            onChange={(e) => setCiudad(e.target.value)}
                          />
                        </div>
                      </div>

                      {chipGroup("¿Cuántos veterinarios atienden?", EQUIPOS, equipo, setEquipo)}
                      {chipGroup("¿Consultas al día, más o menos?", CONSULTAS, consultas, setConsultas)}
                      {chipGroup("¿De dónde te estás mudando?", MUDANZAS, mudanza, setMudanza)}

                      <button type="submit" className="demo-submit">
                        Agendar por WhatsApp <span>→</span>
                      </button>
                      <p className="demo-alt">
                        Se abre WhatsApp con tu mensaje listo — ahí cuadramos fecha y hora.
                      </p>
                      <p className="demo-foot">Sin instalar nada · Sin tarjeta · Migramos tus fichas</p>
                    </form>
                  ) : (
                    <div className="meet-pane">
                      <p>
                        Elige directo un espacio en nuestra agenda: 20 minutos por Meet, y la invitación te llega al
                        correo.
                      </p>
                      <a className="demo-submit" href={MEET_SCHEDULING_URL} target="_blank" rel="noopener">
                        Abrir la agenda <span>→</span>
                      </a>
                      <p className="demo-alt">
                        ¿Prefieres WhatsApp?{" "}
                        <a href={buildWaLink()} target="_blank" rel="noopener">
                          Escríbenos
                        </a>
                      </p>
                      <p className="demo-foot">Sin instalar nada · Sin tarjeta · Migramos tus fichas</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
