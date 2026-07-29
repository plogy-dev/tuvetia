import Image from "next/image";
import { v } from "@/lib/landing/vars";
import pilarCriterio from "@/public/media/pilar-criterio.png";

export default function Criterio() {
  return (
    <section className="pil pil-stack" id="criterio">
      <div className="ptx">
        <div className="kicker st" style={v({ i: 0, y: "10px", d: ".65s" })}>
          El criterio
        </div>
        <h2>
          <span className="ln" style={v({ i: 1 })}>
            <span>Los otros guardan el</span>
          </span>
          <span className="ln" style={v({ i: 2 })}>
            <span>caso. Athos lo piensa</span>
          </span>
          <span className="ln" style={v({ i: 3 })}>
            <span>contigo.</span>
          </span>
        </h2>
        <p className="st" style={v({ i: 6, y: "28px", d: "1s" })}>
          Todo software veterinario archiva. Ninguno te acompaña cuando el caso no cuadra. Athos responde sobre
          literatura veterinaria revisada por pares y te muestra de dónde salió cada cosa.
        </p>
        <ul className="bul">
          <li className="st" style={v({ i: 8, y: "16px", d: ".8s" })}>
            Cada respuesta llega con su fuente citada y enlazada
          </li>
          <li className="st" style={v({ i: 9, y: "16px", d: ".8s" })}>
            Athos conoce la ficha del paciente que tienes abierto
          </li>
          <li className="st" style={v({ i: 10, y: "16px", d: ".8s" })}>
            Te da la evidencia. La decisión clínica sigue siendo tuya
          </li>
        </ul>
        {/* Oculto junto con la sección #producto.
        <a className="pr-more st" href="#producto" style={v({ i: 12, y: "12px", d: ".7s" })}>
          Ver más <span aria-hidden="true">↓</span>
        </a>
        */}
      </div>
      <div className="pmk">
        <div className="mk">
          <div className="mkh st" style={v({ i: 4, y: "12px" })}>
            <div className="mkd" />
            <div className="mkn">Athos</div>
            <div className="mkt">sobre Rocky</div>
          </div>
          <div className="msg me st" style={v({ i: 6, y: "14px" })}>
            Prurito facial + otitis bilateral en bulldog francés. ¿Por dónde arranco?
          </div>
          <div className="msg at st" style={v({ i: 8, y: "20px", d: "1s" })}>
            Antes de nada: la ficha de Rocky registra <b>alergia a pollo</b> desde marzo, y el alimento nuevo la
            lista de primer ingrediente. Con cerumen oscuro y olor a levadura, la literatura prioriza Malassezia
            secundaria a atopia. La citología te separa las dos.
            <div className="cites">
              <div className="cite st" style={v({ i: 11, y: "10px", d: ".6s" })}>
                <b>Vet Dermatol</b> · 2023
              </div>
              <div className="cite st" style={v({ i: 12, y: "10px", d: ".6s" })}>
                <b>J Small Anim Pract</b> · 2022
              </div>
              <div className="cite st" style={v({ i: 13, y: "10px", d: ".6s" })}>
                <b>BMC Vet Res</b> · 2021
              </div>
            </div>
            <div className="red st" style={v({ i: 14, y: "8px", d: ".7s" })}>
              Athos sugiere, no decide. El criterio y la firma son tuyos.
            </div>
          </div>
        </div>
        <figure className="md-pil">
          <Image
            src={pilarCriterio}
            alt="Veterinario escribiendo la historia clínica de noche, con un gato dormido sobre la mesa"
            fill
            placeholder="blur"
            sizes="(max-width: 1000px) 90vw, 600px"
          />
        </figure>
      </div>
    </section>
  );
}
