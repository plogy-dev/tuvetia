import { v } from "@/lib/landing/vars";

export default function Oferta() {
  return (
    <section className="sec">
      <div className="offer">
        <div className="kicker st" style={v({ i: 0, y: "10px", d: ".65s" })}>
          Veterinarios fundadores
        </div>
        <h3 className="st" style={v({ i: 1, y: "18px", d: ".85s" })}>
          Buscamos 10. Todavía no hay ninguno.
        </h3>
        <p className="st" style={v({ i: 3, y: "20px", d: ".95s" })}>
          Cero clínicas lo están usando y no tenemos un solo caso de éxito que enseñarte. Lo decimos aquí porque lo
          vas a averiguar igual. Lo que buscamos son diez veterinarios dispuestos a decirnos en la cara qué está mal
          — y a los que eso les compre algo.
        </p>
        <div className="ogrid">
          <div className="oi st" style={v({ i: 5, y: "16px", gap: "100ms" })}>
            <b>Precio congelado de por vida</b>
            <span>El que pagues como fundador es el que pagas siempre, suba lo que suba después.</span>
          </div>
          <div className="oi st" style={v({ i: 6, y: "16px", gap: "100ms" })}>
            <b>Línea directa con nosotros</b>
            <span>No hay soporte. Nos escribes a nosotros y contestamos nosotros.</span>
          </div>
          <div className="oi st" style={v({ i: 7, y: "16px", gap: "100ms" })}>
            <b>Decides qué construimos</b>
            <span>Lo que pidan los diez primeros se construye antes que nada.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
