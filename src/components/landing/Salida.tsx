import { v } from "@/lib/landing/vars";

export default function Salida() {
  return (
    <section className="sec" id="salida">
      <div className="sech">
        <div className="kicker st" style={v({ i: 0, y: "10px", d: ".65s" })}>
          La salida
        </div>
        <h2>
          <span className="ln" style={v({ i: 1 })}>
            <span>Los otros te cobran por entrar.</span>
          </span>
          <span className="ln" style={v({ i: 2 })}>
            <span>Athos te saca de donde estás.</span>
          </span>
        </h2>
        <p className="lede st" style={v({ i: 5, y: "24px", d: "1s" })}>
          Ya tienes un software. Ya metiste años de historias ahí. Nadie cambia porque el de al lado tenga más
          módulos — cambias cuando mudarte no te cuesta el fin de semana.
        </p>
      </div>
      <div className="mig">
        <div className="mrow st" style={v({ i: 0, y: "22px", gap: "110ms" })}>
          <div className="mn">01</div>
          <div className="mb">
            <b>Nos das acceso al sistema que usas.</b> Sacamos tus pacientes, titulares e historias. Tú no exportas
            nada.
          </div>
        </div>
        <div className="mrow st" style={v({ i: 1, y: "22px", gap: "110ms" })}>
          <div className="mn">02</div>
          <div className="mb">
            <b>Revisas una muestra.</b> Te enseñamos 20 fichas migradas antes de mover el resto. Si algo está mal,
            no seguimos.
          </div>
        </div>
        <div className="mrow st" style={v({ i: 2, y: "22px", gap: "110ms" })}>
          <div className="mn">03</div>
          <div className="mb">
            <b>Cambias el día que quieras.</b> Los dos sistemas conviven hasta que digas. No paras la clínica ni un
            día.
          </div>
        </div>
        <div className="mrow st" style={v({ i: 3, y: "22px", gap: "110ms" })}>
          <div className="mn">04</div>
          <div className="mb">
            <b>Y te puedes ir igual de fácil.</b> Exportas todo cuando quieras, en formato abierto. Tus datos nunca
            son rehenes.
          </div>
        </div>
        <div className="mfoot st" style={v({ i: 5, y: "12px" })}>
          Migración incluida · sin costo · sin parar la clínica
        </div>
      </div>
    </section>
  );
}
