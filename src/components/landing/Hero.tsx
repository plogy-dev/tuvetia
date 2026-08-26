import { v } from "@/lib/landing/vars";
import { buildWaLink } from "@/lib/landing/contact";

export default function Hero() {
  return (
    <section className="hero in">
      <div className="eyebrow st" style={v({ i: 0, y: "12px", d: ".7s" })}>
        Software clínico para veterinarios
      </div>
      <h1>
        <span className="ln" style={v({ i: 1 })}>
          <span>El primer agente de IA</span>
        </span>
        <span className="ln" style={v({ i: 2 })}>
          <span>veterinaria de Latinoamérica</span>
        </span>
      </h1>
      <p className="sub st" style={v({ i: 5, y: "24px", d: "1s" })}>
        VetGPT escucha tu consulta y escribe la historia clínica mientras atiendes. Tú revisas y firmas.
      </p>
      <div className="ctas st" style={v({ i: 6, y: "18px" })}>
        <a className="cta" href="#criterio">
          <span>Cómo funciona →</span>
        </a>
        <a className="cta ghost" href={buildWaLink()} target="_blank" rel="noopener">
          <span>Escríbenos por WhatsApp</span>
        </a>
      </div>
      <div className="micro st" style={v({ i: 8, y: "14px", d: "1.1s" })}>
        15 minutos · Migramos tus fichas del sistema que ya usas.
      </div>
    </section>
  );
}
