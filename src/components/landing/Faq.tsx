import { v } from "@/lib/landing/vars";

const QA = [
  {
    q: "¿Es legal grabar la consulta?",
    a: "Sí, con el consentimiento del titular. Athos te lo pide antes de la primera grabación, se captura una vez y cubre todas las mascotas de esa persona. Marco legal: Ley 1581 de 2012. El audio se borra a los 4 días.",
  },
  {
    q: "¿Y si el dueño no quiere que grabes?",
    a: "No se graba y ya. Athos no arranca sin consentimiento, y tú sigues usando el resto del software normal: pacientes, agenda, comunicaciones. La consulta la escribes tú, como siempre.",
  },
  {
    q: "¿Athos diagnostica?",
    a: "No. Athos sugiere, muestra evidencia y te avisa si algo contradice la ficha. El diagnóstico, el plan y la firma son tuyos. Ninguna nota entra al historial ni ningún mensaje clínico sale sin que tú lo apruebes.",
  },
  {
    q: "¿Sirve si trabajo solo, sin clínica?",
    a: "Está hecho para eso. Tuvetia le habla al veterinario, no a la organización. Si eres tú, tu agenda y tu WhatsApp, es exactamente el caso para el que lo construimos.",
  },
  {
    q: "¿Dónde queda mi información?",
    a: "En tu espacio, aislado. No se mezcla con la de otros veterinarios ni se usa para entrenar modelos compartidos. El audio dura 4 días; la nota clínica es tuya y la exportas cuando quieras.",
  },
  {
    q: "¿Cómo me salgo si no me gusta?",
    a: "Exportas todo en formato abierto y te vas. Sin llamadas de retención, sin permanencia, sin secuestrar tus historias. Si mudarte hacia acá es fácil, salirte tiene que serlo también.",
  },
];

export default function Faq() {
  return (
    <section className="sec">
      <div className="sech">
        <div className="kicker st" style={v({ i: 0, y: "10px", d: ".65s" })}>
          Lo que nos preguntan
        </div>
        <h2>
          <span className="ln" style={v({ i: 1 })}>
            <span>Las dudas de siempre,</span>
          </span>
          <span className="ln" style={v({ i: 2 })}>
            <span>contestadas de una.</span>
          </span>
        </h2>
      </div>
      <div className="faq" id="faq">
        {QA.map((item, i) => (
          <div className="q st" key={item.q} style={v({ i, y: "16px", gap: "75ms" })}>
            <button className="qh">
              {item.q}
              <span className="qi" />
            </button>
            <div className="qb">
              <p>{item.a}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
