"use client";

import { useEffect } from "react";
import Image from "next/image";
// Ver la nota de `DemoPage.tsx`: import estático sin `fill` porque el CSS ya dimensiona el <img>.
import prodCierre from "@/public/media/prod-cierre.png";
import { initSubpage } from "@/lib/landing/subpage";
import { v } from "@/lib/landing/vars";
import Background from "@/components/landing/Background";
import Nav from "@/components/landing/Nav";

const WAVE = [6, 13, 18, 9, 15, 20, 11, 7, 16, 19, 10, 14, 6, 17, 12, 8];

function ApSide({ active }: { active: "athos" | "pacientes" | "comunicaciones" }) {
  return (
    <aside className="ap-side">
      <div className="ap-brand">
        <span className="d" />
        <b>Tuvetia</b>
        <em>beta</em>
      </div>
      <div className={`ap-nav athos${active === "athos" ? " on" : ""}`}>
        <s />
        VetGPT
      </div>
      <div className={`ap-nav${active === "pacientes" ? " on" : ""}`}>
        <s />
        Pacientes
      </div>
      <div className="ap-nav">
        <s />
        Calendario
      </div>
      <div className={`ap-nav${active === "comunicaciones" ? " on" : ""}`}>
        <s />
        Comunicaciones
      </div>
      <div className="ap-nav">
        <s />
        Conexiones
      </div>
      <div className="ap-cta">Iniciar consulta</div>
      <div className="ap-foot">laura.pena@vetbogota.co</div>
    </aside>
  );
}

export default function ProductoPage() {
  useEffect(() => initSubpage(), []);

  return (
    <>
      <Background />
      <Nav active="producto" />
      <div className="pg pg-prod">
        <div className="wrap">
          <header className="phero in">
            <h1>
              <span className="ln" style={v({ i: 1 })}>
                <span>El primer segundo</span>
              </span>
              <span className="ln" style={v({ i: 2 })}>
                <span>cerebro veterinario</span>
              </span>
              <span className="ln" style={v({ i: 3 })}>
                <span>
                  de <b>Latinoamérica</b>
                </span>
              </span>
            </h1>
            <p className="lede st" style={v({ i: 6, y: "20px", d: ".9s" })}>
              VetGPT oye tu consulta, escribe la ficha y contesta el WhatsApp. Tú firmas. Una sola inteligencia, tres
              caras — conectada a todo tu día.
            </p>
            <div className="cta-row st" style={v({ i: 8, y: "16px" })}>
              <a className="navb navb-1" href="/demo">
                Agenda una demo <span>→</span>
              </a>
              <a className="navb navb-2" href="#tour">
                Ver cómo funciona
              </a>
            </div>
          </header>

          <section className="stage" data-io>
            <div className="stage-shot st" style={v({ i: 0, y: "30px", d: "1.1s" })}>
              <div className="blur-app">
                <div className="blur-side">
                  <b />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <div className="blur-main">
                  <div className="r" style={{ width: "40%" }} />
                  <div className="blur-cols">
                    <div className="blur-card" />
                    <div className="blur-card" />
                    <div className="blur-card" />
                  </div>
                </div>
              </div>
            </div>
            <div className="faces">
              <div className="face st" style={v({ i: 1, y: "24px", gap: "120ms" })}>
                <div className="cn">
                  <s />
                  Cara 01 · Oye
                </div>
                <h3>Escucha la consulta</h3>
                <p>Le das al botón y atiendes. VetGPT oye, toma notas, no interrumpe. El audio se borra a los 4 días.</p>
              </div>
              <div className="face st" style={v({ i: 2, y: "24px", gap: "120ms" })}>
                <div className="cn">
                  <s />
                  Cara 02 · Escribe
                </div>
                <h3>Redacta la ficha</h3>
                <p>Sale escrita antes de que el paciente cruce la puerta. Sin firmar, hasta que tú la revisas.</p>
              </div>
              <div className="face st" style={v({ i: 3, y: "24px", gap: "120ms" })}>
                <div className="cn">
                  <s />
                  Cara 03 · Contesta
                </div>
                <h3>Sostiene el WhatsApp</h3>
                <p>Agenda, confirma, reprograma. Y frena todo lo clínico hasta que tú lo apruebes.</p>
              </div>
            </div>
            <div className="seam st" style={v({ i: 5, y: "16px" })}>
              <div className="sk">Y son una sola</div>
              <p>
                El que oyó la consulta de las 9:40 es el mismo que contesta el WhatsApp de las 10:06.{" "}
                <b>Una memoria, indexada por paciente.</b>
              </p>
            </div>
          </section>

          <div className="tour" id="tour">
            <section className="step" data-io>
              <div className="step-txt">
                <div className="kicker st" style={v({ i: 0, y: "10px" })}>
                  Cara 01 · Oye
                </div>
                <h2 className="st" style={v({ i: 1, y: "16px", d: ".9s" })}>
                  Pones el micrófono <b>y atiendes</b>.
                </h2>
                <p className="st" style={v({ i: 3, y: "18px" })}>
                  VetGPT escucha desde una barra flotante que te sigue por toda la app. Abres la ficha, miras el
                  calendario, contestas un chat: sigue grabando. No hay ventana que cuidar.
                </p>
                <ul className="bul">
                  <li className="st" style={v({ i: 5, y: "12px" })}>
                    Pausa cuando sales del consultorio, se retoma sola
                  </li>
                  <li className="st" style={v({ i: 6, y: "12px" })}>
                    El audio se borra a los 4 días. No entrenamos con él
                  </li>
                  <li className="st" style={v({ i: 7, y: "12px" })}>
                    Al minimizar corre como «VetGPT en silencio»
                  </li>
                </ul>
              </div>
              <div className="st" style={v({ i: 2, y: "26px", d: "1s" })}>
                <div className="ap">
                  <div className="ap-bar">
                    <i />
                    <i />
                    <i />
                    <div className="ap-url">tuvetia.co/app/crm/rocky</div>
                  </div>
                  <div className="ap-body">
                    <ApSide active="pacientes" />
                    <div className="ap-main">
                      <div className="ap-h">
                        <b>Rocky</b>
                        <span style={{ fontSize: 11.5, color: "var(--a-soft)" }}>Bulldog francés · 4 a</span>
                        <span className="ap-tag warn">Alergia: pollo</span>
                      </div>
                      <div className="ap-sunk">
                        <div className="ap-mono" style={{ marginBottom: 7 }}>
                          VetGPT está oyendo · transcripción en vivo
                        </div>
                        <div className="ap-wave" style={{ marginBottom: 8 }}>
                          {WAVE.map((h, k) => (
                            <i key={k} style={{ height: h }} />
                          ))}
                        </div>
                        <div
                          style={{
                            fontFamily: "var(--font-mono-landing),monospace",
                            fontSize: 10,
                            lineHeight: 1.75,
                            color: "var(--a-soft)",
                          }}
                        >
                          «…se rasca la cara hace unas tres semanas,
                          <br />
                          sobre todo en la noche. Cambiamos el
                          <br />
                          alimento en marzo, el nuevo trae pollo…»
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 9, fontSize: 11, color: "var(--a-soft)" }}>
                        <span className="ap-btn">Ver ficha completa</span>
                        <span className="ap-btn">Mis notas</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="step flip" data-io>
              <div className="step-txt">
                <div className="kicker st" style={v({ i: 0, y: "10px" })}>
                  Cara 02 · Escribe
                </div>
                <h2 className="st" style={v({ i: 1, y: "16px", d: ".9s" })}>
                  La ficha, escrita <b>antes de que salgas</b>.
                </h2>
                <p className="st" style={v({ i: 3, y: "18px" })}>
                  Motivo, anamnesis, examen, diagnóstico y plan. En el orden en que ya escribes. Sale sin firmar —
                  hasta que la lees y apruebas, no entra al historial.
                </p>
                <ul className="bul">
                  <li className="st" style={v({ i: 5, y: "12px" })}>
                    Ley 576: la historia clínica es obligatoria por escrito
                  </li>
                  <li className="st" style={v({ i: 6, y: "12px" })}>
                    Editas cualquier línea antes de firmar
                  </li>
                  <li className="st" style={v({ i: 7, y: "12px" })}>
                    Al lado queda la transcripción, por si quieres comparar
                  </li>
                </ul>
              </div>
              <div className="st" style={v({ i: 2, y: "26px", d: "1s" })}>
                <div className="ap">
                  <div className="ap-bar">
                    <i />
                    <i />
                    <i />
                    <div className="ap-url">tuvetia.co/app/vetgpt/consulta-rocky</div>
                  </div>
                  <div className="ap-body">
                    <ApSide active="athos" />
                    <div className="ap-main">
                      <div className="ap-h">
                        <b>Consulta · Rocky</b>
                        <span style={{ fontSize: 11.5, color: "var(--a-soft)" }}>17 jul · 09:40–09:52</span>
                        <span className="ap-tag warn">Sin firmar</span>
                      </div>
                      <div className="ap-tabs">
                        <span className="ap-tab on">Nota clínica</span>
                        <span className="ap-tab">Transcripción</span>
                        <span className="ap-tab">Sugerencias</span>
                        <span className="ap-tab">Chat</span>
                      </div>
                      <div className="ap-card">
                        <div className="ap-doc">
                          <section>
                            <b>Motivo</b>Prurito facial de 3 semanas, de predominio nocturno.
                          </section>
                          <section>
                            <b>Anamnesis</b>Cambio de alimento en marzo. El nuevo lista pollo como primer ingrediente.
                            Alergia a pollo en ficha desde marzo 2025.
                          </section>
                          <section>
                            <b>Examen</b>Otitis externa bilateral. Cerumen oscuro, olor a levadura.
                          </section>
                          <section style={{ marginBottom: 0 }}>
                            <b>Plan</b>Citología ótica. Retirar alimento con pollo. Control en 8 días.
                          </section>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <span className="ap-btn pri">Revisar y firmar</span>
                        <span className="ap-btn">Editar</span>
                        <span className="ap-mono" style={{ marginLeft: "auto" }}>
                          Nada entra sin tu firma
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="step" data-io>
              <div className="step-txt">
                <div className="kicker st" style={v({ i: 0, y: "10px" })}>
                  Cara 03 · Contesta
                </div>
                <h2 className="st" style={v({ i: 1, y: "16px", d: ".9s" })}>
                  Los otros mandan recordatorios. <b>VetGPT contesta.</b>
                </h2>
                <p className="st" style={v({ i: 3, y: "18px" })}>
                  Un buzón con los chats de tus titulares. VetGPT sostiene la conversación de ida y vuelta — agenda,
                  confirma, reprograma. Y frena en seco todo lo clínico: te deja el borrador y espera.
                </p>
                <ul className="bul">
                  <li className="st" style={v({ i: 5, y: "12px" })}>
                    Nada clínico sale sin tu aprobación. Nunca
                  </li>
                  <li className="st" style={v({ i: 6, y: "12px" })}>
                    Sabe lo que oyó en la consulta: no pregunta lo que ya sabe
                  </li>
                  <li className="st" style={v({ i: 7, y: "12px" })}>
                    Lo que responde queda en la ficha del paciente
                  </li>
                </ul>
              </div>
              <div className="st" style={v({ i: 2, y: "26px", d: "1s" })}>
                <div className="ap">
                  <div className="ap-bar">
                    <i />
                    <i />
                    <i />
                    <div className="ap-url">tuvetia.co/app/comunicaciones</div>
                  </div>
                  <div className="ap-body">
                    <ApSide active="comunicaciones" />
                    <div className="ap-main">
                      <div className="ap-h">
                        <b>Carlos Restrepo</b>
                        <span style={{ fontSize: 11.5, color: "var(--a-soft)" }}>WhatsApp · Rocky</span>
                        <span className="ap-tag warn">1 espera aprobación</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div className="ap-bub them">
                          Doctora, ¿le dejo a Rocky o me lo llevo?
                          <div className="ap-mono" style={{ marginTop: 3, letterSpacing: ".06em" }}>
                            10:06
                          </div>
                        </div>
                        <div className="ap-bub us">
                          La doctora está con Rocky ahora. Te escribimos apenas termine.
                          <div
                            className="ap-mono"
                            style={{ marginTop: 3, color: "rgba(255,255,255,.55)", letterSpacing: ".06em" }}
                          >
                            10:06 · VetGPT
                          </div>
                        </div>
                      </div>
                      <div className="ap-gate">
                        <div className="ap-mono" style={{ color: "var(--athos)", marginBottom: 6 }}>
                          ⏸ VetGPT se detuvo · requiere tu aprobación
                        </div>
                        <div style={{ fontSize: 12, lineHeight: 1.55, marginBottom: 9 }}>
                          Borrador: «Salió la citología: Malassezia. Te dejo el limpiador ótico y nos vemos en 8
                          días.»
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <span className="ap-btn pri">Aprobar y enviar</span>
                          <span className="ap-btn">Editar</span>
                          <span className="ap-btn">Yo respondo</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="step flip" data-io>
              <div className="step-txt">
                <div className="kicker st" style={v({ i: 0, y: "10px" })}>
                  Y detrás de las tres
                </div>
                <h2 className="st" style={v({ i: 1, y: "16px", d: ".9s" })}>
                  Te dice <b>de dónde lo sacó</b>.
                </h2>
                <p className="st" style={v({ i: 3, y: "18px" })}>
                  Cuando VetGPT sugiere algo, muestra la fuente: revista, año, DOI. Ábrelo tú mismo. Es evidencia
                  veterinaria revisada por pares, conociendo la ficha del paciente que tienes abierto.
                </p>
                <ul className="bul">
                  <li className="st" style={v({ i: 5, y: "12px" })}>
                    Cada afirmación va con su fuente, enlazada y abrible
                  </li>
                  <li className="st" style={v({ i: 6, y: "12px" })}>
                    Las dosis, con el registro ICA del producto que existe acá
                  </li>
                  <li className="st" style={v({ i: 7, y: "12px" })}>
                    VetGPT sugiere. No diagnostica, no firma, no decide
                  </li>
                </ul>
              </div>
              <div className="st" style={v({ i: 2, y: "26px", d: "1s" })}>
                <div className="ap">
                  <div className="ap-bar">
                    <i />
                    <i />
                    <i />
                    <div className="ap-url">tuvetia.co/app/vetgpt/chat</div>
                  </div>
                  <div className="ap-body">
                    <ApSide active="athos" />
                    <div className="ap-main">
                      <div className="ap-h">
                        <span className="ap-dot" />
                        <b>VetGPT</b>
                        <span style={{ fontSize: 11.5, color: "var(--a-soft)" }}>sobre Rocky</span>
                        <span className="ap-tag">Ficha abierta</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <div className="ap-bub them" style={{ alignSelf: "flex-end", background: "var(--a-sunk)" }}>
                          Prurito facial + otitis bilateral en bulldog. ¿Por dónde arranco?
                        </div>
                        <div className="ap-card" style={{ alignSelf: "flex-start", maxWidth: "90%" }}>
                          <div style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 10 }}>
                            La ficha registra <b>alergia a pollo</b>, y el alimento nuevo lo lista primero. Con
                            cerumen oscuro y olor a levadura, la literatura prioriza Malassezia. La citología te
                            separa las dos.
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 6,
                              paddingTop: 9,
                              borderTop: "1px solid var(--a-line2)",
                            }}
                          >
                            <div className="ap-mono">De dónde salió</div>
                            <div
                              style={{ fontFamily: "var(--font-serif),Georgia,serif", fontSize: 12.5, lineHeight: 1.4 }}
                            >
                              Malassezia dermatitis in dogs and cats: a review
                            </div>
                            <a className="ap-doi" href="https://doi.org/10.1111/vde.13135" target="_blank" rel="noopener">
                              Vet Dermatol · 2023 · doi.org/10.1111/vde.13135 ↗
                            </a>
                          </div>
                          <div className="ap-gate" style={{ marginTop: 10 }}>
                            <div className="ap-mono" style={{ color: "var(--athos)" }}>
                              ⏸ VetGPT sugiere · tú decides · tú firmas
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <section className="pclose" data-io>
          <div className="pclose-bg">
            <Image src={prodCierre} alt="" sizes="100vw" placeholder="blur" />
          </div>
          <div className="pclose-in">
            <h2 className="st" style={v({ i: 0, y: "20px" })}>
              ¿Conoces a un veterinario
              <br />
              que odie su software?
            </h2>
            <p className="st" style={v({ i: 2, y: "14px" })}>
              Te lo enseñamos en 20 minutos, con tus propios casos. Te escribe un fundador, no un vendedor.
            </p>
            <div className="cta-row st" style={v({ i: 4, y: "14px" })}>
              <a className="navb navb-1" href="/demo">
                Agenda una demo
              </a>
              <a className="navb navb-3" href="/">
                Volver al inicio
              </a>
            </div>
          </div>
        </section>

        <div className="wrap">
          <footer>
            <span>Tuvetia · Bogotá</span>
            <span>
              <a href="/seguridad">Datos y seguridad</a> · <a href="/#salida">Mudanza</a> ·{" "}
              <a href="/#nosotros">Nosotros</a>
            </span>
          </footer>
        </div>
      </div>
    </>
  );
}
