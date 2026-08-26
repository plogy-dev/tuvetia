import { v } from "@/lib/landing/vars";

export default function Cuenta() {
  return (
    <section className="sec" id="cuenta">
      <div className="sech">
        <div className="kicker st" style={v({ i: 0, y: "10px", d: ".65s" })}>
          La cuenta
        </div>
        <h2>
          <span className="ln" style={v({ i: 1 })}>
            <span>Calculadora</span>
          </span>
          <span className="ln" style={v({ i: 2 })}>
            <span>de impacto</span>
          </span>
        </h2>
        <p className="lede st" style={v({ i: 5, y: "24px", d: "1s" })}>
          Mueve los números. Son los tuyos — nosotros solo hacemos la multiplicación. Mira cuántas horas te devuelve
          VetGPT al mes… y qué puedes hacer con ellas.
        </p>
      </div>
      <div className="calc-cta-wrap">
        <a className="calc-open st" id="calc-open" style={v({ i: 6, y: "20px", d: ".9s" })} href="#cuenta">
          <span>Abrir la calculadora de impacto</span>
          <svg
            className="ar"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </a>
        <div className="calc-cta-sub st" style={v({ i: 7, y: "12px" })}>
          2 minutos · tus cifras · con opción de mandárnoslas por WhatsApp
        </div>
      </div>
    </section>
  );
}
