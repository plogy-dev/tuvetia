import { v } from "@/lib/landing/vars";

const CELLS = [
  {
    hi: 0,
    pi: 1,
    h: "Ley 1581",
    p: "El dueño da consentimiento explícito antes de que VetGPT grabe. Se captura una vez y cubre todas sus mascotas.",
  },
  {
    hi: 1,
    pi: 2,
    h: "Audio: 4 días",
    p: "El audio de la consulta se borra a los 4 días. Queda la nota, no la grabación.",
  },
  {
    hi: 2,
    pi: 3,
    h: "Espacio aislado",
    p: "Tus consultas viven en tu espacio. No se mezclan ni entrenan modelos compartidos.",
  },
  {
    hi: 3,
    pi: 4,
    h: "Sugiere, no decide",
    p: "VetGPT propone; el criterio y la firma son tuyos. Ninguna nota entra al historial sin que tú la apruebes.",
  },
];

export default function Seguridad() {
  return (
    <section className="sec" id="confianza">
      <div className="sech">
        <div className="kicker st" style={v({ i: 0, y: "10px", d: ".65s" })}>
          Seguridad y datos
        </div>
        <h2>
          <span className="ln" style={v({ i: 1 })}>
            <span>VetGPT oye consultas</span>
          </span>
          <span className="ln" style={v({ i: 2 })}>
            <span>privadas. Eso obliga.</span>
          </span>
        </h2>
        <p className="lede st" style={v({ i: 5, y: "24px", d: "1s" })}>
          El secreto profesional no es una casilla de configuración. Estas son las reglas del producto, no una
          promesa de marketing.
        </p>
      </div>
      <div className="trust">
        {CELLS.map((c) => (
          <div className="tc" key={c.h}>
            <h4 className="st" style={v({ i: c.hi, y: "14px", gap: "120ms" })}>
              {c.h}
            </h4>
            <p className="st" style={v({ i: c.pi, y: "18px", gap: "120ms" })}>
              {c.p}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
