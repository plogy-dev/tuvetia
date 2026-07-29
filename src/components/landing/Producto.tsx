import { v } from "@/lib/landing/vars";

const WAVE = [8, 16, 22, 11, 19, 26, 14, 9, 20, 24, 12, 17, 7, 21];

export default function Producto() {
  return (
    <section className="pr-sec" id="producto">
      <div className="pr-head">
        <div className="kicker st" style={v({ i: 0, y: "10px", d: ".65s" })}>
          Adentro
        </div>
        <h3 className="st" style={v({ i: 1, y: "16px", d: ".8s" })}>
          Athos no es tres cosas. Es una, con tres caras.
        </h3>
        <p className="st" style={v({ i: 3, y: "20px", d: ".9s" })}>
          El que oye tu consulta es el mismo que contesta el WhatsApp. Una sola memoria, indexada por paciente. Por
          eso el borrador de las 10:06 sabe lo que dijiste a las 9:40.
        </p>
      </div>
      <div className="pr-grid">
        <div className="pr-card st" style={v({ i: 0, y: "24px", gap: "130ms" })}>
          <div className="pr-n">Cara 01 · Oye</div>
          <h4>Escucha la consulta</h4>
          <p>Pones el micrófono y atiendes. Athos oye, no interrumpe. El audio se borra a los 4 días.</p>
          <div className="pr-scr">
            <div className="pr-row">
              <div className="pr-dot" />
              <div className="pr-mono">GRABANDO · 09:41</div>
            </div>
            <div className="pr-wave">
              {WAVE.map((h, k) => (
                <i key={k} style={{ height: h }} />
              ))}
            </div>
            <div className="pr-mono" style={{ lineHeight: 1.6 }}>
              «…prurito facial hace tres semanas, se rasca
              <br />
              sobre todo en la noche. Cambiamos el
              <br />
              alimento en marzo…»
            </div>
          </div>
        </div>

        <div className="pr-card st" style={v({ i: 1, y: "24px", gap: "130ms" })}>
          <div className="pr-n">Cara 02 · Escribe</div>
          <h4>La ficha, en serif</h4>
          <p>
            Sale escrita antes de que el paciente cruce la puerta. Es un documento legal, no una pantalla. Tú la
            firmas.
          </p>
          <div className="pr-scr">
            <div className="pr-mono">HISTORIA CLÍNICA · ROCKY · 17 JUL</div>
            <div className="pr-doc">
              <b>S.</b> Prurito facial de 3 semanas, nocturno. Cambio de alimento en marzo.
              <br />
              <b>O.</b> Otitis bilateral, cerumen oscuro, olor a levadura.
              <br />
              <b>A.</b> Sospecha de Malassezia secundaria a atopia.
              <br />
              <b>P.</b> Citología ótica.
            </div>
            <div className="pr-mono">SIN FIRMAR · ESPERA TU REVISIÓN</div>
          </div>
        </div>

        <div className="pr-card st" style={v({ i: 2, y: "24px", gap: "130ms" })}>
          <div className="pr-n">Cara 03 · Piensa y contesta</div>
          <h4>Te dice de dónde lo sacó</h4>
          <p>
            Revista, año, DOI. Ábrelo tú mismo. Y lo clínico que va al cliente se frena hasta que tú lo apruebes.
          </p>
          <div className="pr-scr">
            <div className="pr-mono">FUENTE DE LA SUGERENCIA</div>
            <div className="pr-doc" style={{ fontSize: 12.5 }}>
              Malassezia dermatitis in dogs: diagnosis and management
            </div>
            <div className="pr-mono">VET DERMATOL · 2023</div>
            <a className="pr-doi" href="https://doi.org/10.1111/vde.13135" target="_blank" rel="noopener">
              doi.org/10.1111/vde.13135 ↗
            </a>
            <div className="pr-appr" style={{ marginTop: 4 }}>
              ⏸ Nada clínico sale sin tu aprobación.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
