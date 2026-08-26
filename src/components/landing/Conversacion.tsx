import Image from "next/image";
import { v } from "@/lib/landing/vars";
import pilarConversacion from "@/public/media/pilar-conversacion.png";

export default function Conversacion() {
  return (
    <section className="pil pil-stack">
      <div className="ptx">
        <div className="kicker st" style={v({ i: 0, y: "10px", d: ".65s" })}>
          La conversación
        </div>
        <h2>
          <span className="ln" style={v({ i: 1 })}>
            <span>Los otros mandan</span>
          </span>
          <span className="ln" style={v({ i: 2 })}>
            <span>recordatorios.</span>
          </span>
          <span className="ln" style={v({ i: 3 })}>
            <span>VetGPT contesta.</span>
          </span>
        </h2>
        <p className="st" style={v({ i: 6, y: "28px", d: "1s" })}>
          Tus clientes no te escriben por correo. Te escriben por WhatsApp, y a la hora que sea. Los demás te dejan
          disparar plantillas. VetGPT sostiene la conversación de ida y vuelta — y frena todo lo clínico hasta que tú
          lo apruebes.
        </p>
        <ul className="bul">
          <li className="st" style={v({ i: 8, y: "16px", d: ".8s" })}>
            Agenda, confirma y reprograma sin que toques el teléfono
          </li>
          <li className="st" style={v({ i: 9, y: "16px", d: ".8s" })}>
            Nada clínico sale sin tu aprobación. Nunca
          </li>
          <li className="st" style={v({ i: 10, y: "16px", d: ".8s" })}>
            Lo que responde queda en la ficha del paciente
          </li>
        </ul>
      </div>
      <div className="pmk">
        <div className="mk">
          <div className="mkh st" style={v({ i: 4, y: "12px" })}>
            <div className="mkd" />
            <div className="mkn">Carlos Restrepo</div>
            <div className="mkt">WhatsApp · 10:06</div>
          </div>
          <div className="bub them st" style={v({ i: 6, y: "14px" })}>
            Doctora, ¿le dejo a Rocky o me lo llevo y vuelvo?<span className="bt">10:06</span>
          </div>
          <div className="bub us st" style={v({ i: 8, y: "14px" })}>
            La doctora está con Rocky ahora. Te escribimos apenas termine.<span className="bt">10:06 · VetGPT</span>
          </div>
          <div className="bub them st" style={v({ i: 10, y: "14px" })}>
            Listo, gracias 🙏<span className="bt">10:07</span>
          </div>
          <div className="gate st" style={v({ i: 12, y: "22px", d: "1s" })}>
            <div className="gh">⏸ VetGPT se detuvo · requiere tu aprobación</div>
            <div className="gp">
              Borrador: «Salió la citología: Malassezia. Te dejo el limpiador ótico y nos vemos en 8 días.»
            </div>
            <div className="gbs">
              <button className="gb pri">Aprobar y enviar</button>
              <button className="gb">Editar</button>
              <button className="gb">Yo respondo</button>
            </div>
          </div>
        </div>
        <figure className="md-pil" style={{ marginTop: 18 }}>
          <Image
            src={pilarConversacion}
            alt="Perro en la sala de espera de una clínica veterinaria"
            fill
            placeholder="blur"
            sizes="(max-width: 1000px) 90vw, 600px"
          />
        </figure>
      </div>
    </section>
  );
}
