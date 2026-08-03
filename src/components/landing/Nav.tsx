export default function Nav({
  active,
  back,
}: {
  active?: "producto" | "seguridad";
  back?: boolean;
}) {
  const on = (k: string) => (active === k ? "on" : undefined);
  return (
    <nav id="nav">
      <div className="nav-pod" id="navpod">
        <a className="brand" href="/">
          <span className="dot" id="navdot" />
          Tuvetia
        </a>
        <div className="navr">
          <div className="nav-links">
            <a href="/producto" className={on("producto")}>Producto</a>
            <a href="/#cuenta">La cuenta</a>
            <a href="/seguridad" className={on("seguridad")}>Seguridad</a>
          </div>
          <div className="nav-acts">
            {back ? (
              <a className="navb navb-1" href="/">
                ← Volver
              </a>
            ) : (
              <>
                <a className="navb navb-2" href="/login">
                  Ingresar
                </a>
                <a className="navb navb-1" href="/demo">
                  Agenda una demo
                </a>
              </>
            )}
            {/* El selector de idioma se quitó: su única acción era `document.documentElement.lang
                = "en"`. No hay i18n — el sitio no traducía ni una palabra, así que ofrecerlo era
                prometer un idioma que no existe. Si vuelve, va con traducciones, y hay que reponer
                el bloque `selector de idioma` de `lib/landing/engine.ts`. */}
            <button className="navb navb-3 nav-burger" id="burgerbtn" aria-label="Menú" aria-expanded="false">
              <span className="burger-lines">
                <i />
              </span>
            </button>
          </div>
        </div>
        <div className="mobile-menu" id="mobilemenu">
          <a href="/producto">Producto</a>
          <a href="/#cuenta">La cuenta</a>
          <a href="/seguridad">Seguridad</a>
          <a className="mm-cta" href="/login">
            Ingresar
          </a>
        </div>
      </div>
    </nav>
  );
}
