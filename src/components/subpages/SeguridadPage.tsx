"use client";

import { useEffect, type CSSProperties } from "react";
import { initSubpage } from "@/lib/landing/subpage";
import { v } from "@/lib/landing/vars";
import Background from "@/components/landing/Background";
import Nav from "@/components/landing/Nav";

const w = (n: number) => ({ "--w": n }) as CSSProperties;

const QA = [
  {
    q: "¿Escuchan mis consultas?",
    a: (
      <>
        No. Athos transcribe la consulta de forma automatizada para escribir la ficha; ninguna persona de Tuvetia
        escucha tus grabaciones. Y el audio se borra a los 4 días. Athos oye para escribir, no para vigilar — cuando
        lo minimizas, corre como <b>«Athos en silencio»</b>: sigue tomando notas de la consulta en curso, nada más.
      </>
    ),
  },
  {
    q: "¿Usan mis fichas para entrenar la IA?",
    a: (
      <>
        No. Athos se entrena con literatura veterinaria publicada y revisada por pares, no con tus pacientes. Si
        alguna vez quisiéramos aprender de datos clínicos reales, sería con tu permiso explícito y pagándote por
        ello — jamás por defecto ni en silencio.
      </>
    ),
  },
  {
    q: "¿Puede Athos mandarle algo a un cliente sin que yo lo vea?",
    a: (
      <>
        No. Todo lo clínico se detiene y espera tu aprobación. Athos puede agendar y confirmar citas, pero cualquier
        mensaje con contenido clínico te lo deja como borrador — tú lo apruebas, editas o lo respondes tú mismo.
      </>
    ),
  },
  {
    q: "Si me quiero ir, ¿me devuelven mis datos?",
    a: (
      <>
        Sí, cuando quieras y en formato abierto. Tus pacientes, titulares e historias son tuyos. No los retenemos
        para obligarte a quedarte — de hecho, la mudanza fácil es parte de lo que ofrecemos.
      </>
    ),
  },
  {
    q: "¿Dónde se guardan los datos?",
    a: (
      <>
        En un espacio aislado por veterinario, bajo la Ley 1581 de protección de datos de Colombia. La clínica es
        responsable del dato; Tuvetia solo lo procesa para prestarte el servicio.
      </>
    ),
  },
];

export default function SeguridadPage() {
  useEffect(() => initSubpage(), []);

  return (
    <>
      <Background />
      <Nav active="seguridad" />
      <div className="pg pg-seg">
        <div className="wrap">
          <header className="shero in">
            <div className="kicker">Datos y seguridad</div>
            <h1>
              <span className="ln" style={v({ i: 1 })}>
                <span>El audio de tu</span>
              </span>
              <span className="ln" style={v({ i: 2 })}>
                <span>consulta se borra</span>
              </span>
              <span className="ln" style={v({ i: 3 })}>
                <span>
                  a los <b>4 días</b>.
                </span>
              </span>
            </h1>
            <p className="lede st" style={v({ i: 6, y: "22px", d: "1s" })}>
              La mayoría del software guarda todo para siempre, «por si acaso». Nosotros hacemos lo contrario: Athos
              escucha, escribe la ficha, y el audio se destruye solo.{" "}
              <b>Lo que queda es la historia clínica que tú firmaste — nada más.</b>
            </p>
          </header>

          <figure className="sg-band">
            <img src="/media/seg-1.png" alt="" loading="lazy" />
            <figcaption>Tu consulta, tu dato</figcaption>
          </figure>

          <section className="redline" id="diagnostico" data-io>
            <div className="redline-in">
              <div className="kicker st" style={v({ i: 0, y: "10px" })}>
                La línea que no cruzamos
              </div>
              <h2 className="st" style={v({ i: 1, y: "16px", d: ".9s" })}>
                Athos no diagnostica. <b>Y no es por precaución.</b>
              </h2>
              <p className="st" style={v({ i: 3, y: "20px" })}>
                Es una decisión de fondo: el diagnóstico, el criterio y la firma son tuyos, siempre. Athos escucha,
                escribe, sugiere y te muestra de dónde salió cada cosa — revista, año, DOI, para que lo abras tú
                mismo. Pero no decide por ti, y no manda nada clínico a un cliente sin que tú lo apruebes.
              </p>
              <p className="st" style={v({ i: 4, y: "20px" })}>
                Un software que diagnostica te vuelve responsable de una decisión que no tomaste. Nosotros hacemos lo
                contrario: <b>te devolvemos tiempo para que la decisión sea tuya, con más información y menos
                papeleo.</b>
              </p>
              <div className="redline-mark st" style={v({ i: 5, y: "14px" })}>
                <i />
                Athos sugiere · tú decides · tú firmas
              </div>
            </div>
          </section>

          <section className="claim" id="borrado" data-io>
            <div className="claim-grid">
              <div>
                <div className="kicker st" style={v({ i: 0, y: "10px" })}>
                  Retención mínima
                </div>
                <h2 className="st" style={v({ i: 1, y: "16px", d: ".9s" })}>
                  Guardamos lo <b>mínimo</b>, el <b>menor tiempo</b> posible.
                </h2>
                <p className="st" style={v({ i: 3, y: "20px" })}>
                  El audio de la consulta existe solo para que Athos escriba la ficha. Cumplida esa tarea, deja de
                  tener razón de ser — así que se borra. Cuatro días es el margen para que puedas comparar la nota
                  con lo que se dijo, si quieres. Después, no.
                </p>
                <p className="st" style={v({ i: 4, y: "20px" })}>
                  <b>No lo usamos para entrenar modelos.</b> Ni el audio, ni las fichas, ni las conversaciones. Athos
                  aprende de literatura veterinaria publicada, no de tus pacientes.
                </p>
              </div>
              <div className="decay st" style={v({ i: 2, y: "26px", d: "1s" })}>
                <div className="decay-row">
                  <span className="decay-day">Día 0</span>
                  <div className="decay-bar">
                    <i style={w(1)} />
                  </div>
                  <span className="decay-lbl">Consulta grabada</span>
                </div>
                <div className="decay-row">
                  <span className="decay-day">Día 0</span>
                  <div className="decay-bar">
                    <i style={w(1)} />
                  </div>
                  <span className="decay-lbl">Ficha escrita</span>
                </div>
                <div className="decay-row">
                  <span className="decay-day">Día 1–4</span>
                  <div className="decay-bar">
                    <i style={w(0.5)} />
                  </div>
                  <span className="decay-lbl">Puedes comparar</span>
                </div>
                <div className="decay-row">
                  <span className="decay-day">Día 4</span>
                  <div className="decay-bar">
                    <i style={w(0)} />
                  </div>
                  <span className="decay-lbl">Audio destruido</span>
                </div>
                <div className="decay-row">
                  <span className="decay-day">Siempre</span>
                  <div className="decay-bar">
                    <i style={w(1)} />
                  </div>
                  <span className="decay-lbl">Ficha firmada</span>
                </div>
                <div className="decay-foot">
                  La ficha clínica que firmaste se conserva mientras la clínica la necesite — es un documento legal
                  (Ley 576). El audio no.
                </div>
              </div>
            </div>
          </section>

          <section className="vows" id="promesas" data-io>
            <div className="vows-h">
              <div className="kicker st" style={v({ i: 0, y: "10px" })}>
                Lo que sí y lo que no
              </div>
              <h2 className="st" style={v({ i: 1, y: "16px", d: ".9s" })}>
                Cinco cosas que puedes <b>verificar</b>, no cinco que te pedimos <b>creer</b>.
              </h2>
            </div>
            <div className="vows-grid">
              <div className="vow st" style={v({ i: 0, y: "22px", gap: "120ms" })}>
                <div className="vow-n">01</div>
                <h3>El audio se borra a los 4 días</h3>
                <p>Automático, sin que tengas que pedirlo. No hay una copia «de respaldo» en otro lado.</p>
              </div>
              <div className="vow st" style={v({ i: 1, y: "22px", gap: "120ms" })}>
                <div className="vow-n">02</div>
                <h3>No entrenamos con tus datos</h3>
                <p>
                  Por defecto, nunca. Si algún día quisiéramos aprender de datos reales,{" "}
                  <b>te lo pediríamos explícitamente y te pagaríamos por decir que sí</b> — nunca a tus espaldas.
                </p>
              </div>
              <div className="vow st" style={v({ i: 2, y: "22px", gap: "120ms" })}>
                <div className="vow-n">03</div>
                <h3>Nada clínico sale sin tu firma</h3>
                <p>
                  Athos escribe y sugiere. Tú revisas y firmas. Ni la ficha ni una respuesta al cliente salen sin que
                  las apruebes.
                </p>
                <span className="law">Ley 576 · Art. 61</span>
              </div>
              <div className="vow st" style={v({ i: 3, y: "22px", gap: "120ms" })}>
                <div className="vow-n">04</div>
                <h3>Tu espacio está aislado</h3>
                <p>
                  Tus consultas no se mezclan con las de ningún otro veterinario. Tú controlas el dato de tus
                  pacientes.
                </p>
                <span className="law">Ley 1581</span>
              </div>
              <div className="vow st" style={v({ i: 4, y: "22px", gap: "120ms" })}>
                <div className="vow-n">05</div>
                <h3>Tus datos nunca son rehenes</h3>
                <p>
                  Los exportas cuando quieras, en formato abierto. Entrar es fácil; irte también. No guardamos tus
                  fichas para obligarte a quedarte.
                </p>
              </div>
              <div className="vow st" style={v({ i: 5, y: "22px", gap: "120ms" })}>
                <div className="vow-n">06</div>
                <h3>El consentimiento se pide una vez</h3>
                <p>
                  Antes de grabar, el titular autoriza. Se captura una sola vez y cubre a todas sus mascotas — sin
                  fricción en cada visita, con respaldo legal.
                </p>
                <span className="law">Ley 1581</span>
              </div>
            </div>
          </section>

          <section className="legal" id="ley" data-io>
            <div style={{ maxWidth: 640 }}>
              <div className="kicker st" style={v({ i: 0, y: "10px" })}>
                Quién responde por el dato
              </div>
              <h2 className="st legal-title" style={v({ i: 1, y: "16px", d: ".9s" })}>
                La Ley 1581 separa dos papeles. <b>Vale la pena que sepas cuál es cuál.</b>
              </h2>
            </div>
            <div className="legal-grid">
              <div className="legal-card you st" style={v({ i: 2, y: "22px" })}>
                <div className="role">La clínica · Responsable</div>
                <h4>Tú decides sobre el dato</h4>
                <p>
                  La clínica es la responsable del tratamiento: define para qué se usan los datos de sus pacientes y
                  titulares. Es tu información, y las decisiones sobre ella son tuyas.
                </p>
              </div>
              <div className="legal-card st" style={v({ i: 3, y: "22px" })}>
                <div className="role">Tuvetia · Encargado</div>
                <h4>Nosotros solo lo procesamos</h4>
                <p>
                  Tuvetia es el encargado: procesamos el dato para prestarte el servicio, siguiendo tus instrucciones
                  y la ley. No es nuestro para hacer con él lo que queramos.
                </p>
              </div>
            </div>
            <figure className="sg-pic">
              <img src="/media/seg-2.png" alt="" loading="lazy" />
            </figure>
          </section>

          <section className="qa" id="preguntas" data-io>
            <div className="qa-h">
              <div className="kicker st" style={v({ i: 0, y: "10px" })}>
                Preguntas directas
              </div>
              <h2 className="st" style={v({ i: 1, y: "14px" })}>
                Sin letra chica.
              </h2>
            </div>
            <div id="qaList">
              {QA.map((item) => (
                <div className="qa-item" key={item.q}>
                  <button className="qa-q">{item.q}</button>
                  <div className="qa-a">
                    <p>{item.a}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="sclose" data-io>
            <div className="sclose-bg">
              <img src="/media/seg-cierre.png" alt="" loading="lazy" />
            </div>
            <div className="sclose-in">
              <h2 className="st" style={v({ i: 0, y: "18px" })}>
                ¿Te quedó una duda que no está acá?
              </h2>
              <p className="st" style={v({ i: 2, y: "14px" })}>
                Pregúntanos directo. Te contesta un fundador, no un formulario.
              </p>
              <div className="cbtns st" style={v({ i: 4, y: "14px" })}>
                <a className="navb navb-1" href="/demo">
                  Agenda una demo
                </a>
                <a className="navb navb-3" href="/">
                  Volver al inicio
                </a>
              </div>
            </div>
          </section>

          <footer>
            <span>Tuvetia · Bogotá</span>
            <span>
              <a href="/producto">Producto</a> · <a href="/#salida">Mudanza</a> · <a href="/#nosotros">Nosotros</a>
            </span>
          </footer>
        </div>
      </div>
    </>
  );
}
