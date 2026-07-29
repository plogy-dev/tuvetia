import Image from "next/image";
import { v } from "@/lib/landing/vars";
import athos from "@/public/athos.jpg";

export default function Nosotros() {
  return (
    <section className="sec" id="nosotros" style={{ paddingBottom: 60 }}>
      <div className="who">
        <div>
          <div className="kicker st" style={v({ i: 0, y: "10px", d: ".65s" })}>
            Nosotros
          </div>
          <h2>
            <span className="ln" style={v({ i: 1 })}>
              <span>Athos existe. Y este</span>
            </span>
            <span className="ln" style={v({ i: 2 })}>
              <span>software se llama</span>
            </span>
            <span className="ln" style={v({ i: 3 })}>
              <span>como él.</span>
            </span>
          </h2>
          <p className="st" style={v({ i: 6, y: "24px", d: ".95s" })}>
            De una experiencia personal nace una solución global para la veterinaria. Somos <b>David</b> y{" "}
            <b>Luciano</b>, los creadores de TuVetia.
          </p>
          <p className="st" style={v({ i: 8, y: "24px", d: "1s" })}>
            La inspiración nació de una experiencia profunda con <b>Athos</b>, mi Bulldog Francés. Tras una
            castración que no salió como esperábamos, empezó a sufrir incontinencia urinaria y ningún veterinario
            encontraba la causa. Mi obsesión por ayudarlo me llevó a una investigación exhaustiva, hasta descubrir
            una condición poco conocida en Colombia: la <b>«Uro-Inestabilidad Post-Surgical Atónica»</b>.
          </p>
          <p className="st" style={v({ i: 10, y: "24px", d: "1.05s" })}>
            Ahí mi mente hizo click: <b>¿y si todos los veterinarios tuvieran acceso a una IA nutrida con el
            conocimiento del mundo entero?</b> Así nació TuVetia. Nuestra misión es empoderar a cada veterinario en
            Latinoamérica, asegurando que ningún Athos se quede sin el diagnóstico y el cuidado que merece.
          </p>
        </div>
        <div className="portrait st" style={v({ i: 5, y: "36px", d: "1.2s" })}>
          <div className="pslot">
            <Image
              src={athos}
              alt="Athos, bulldog francés, dentro de una carretilla con la lengua afuera"
              placeholder="blur"
              sizes="(max-width: 1000px) 90vw, 420px"
            />
          </div>
          <div className="pcap">
            <b>Athos.</b> El perro que no encontraba diagnóstico.
          </div>
        </div>
      </div>
    </section>
  );
}
