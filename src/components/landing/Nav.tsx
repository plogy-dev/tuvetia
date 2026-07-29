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
            <div className="lang" id="lang">
              <button
                className="navb navb-3"
                id="langbtn"
                aria-haspopup="true"
                aria-expanded="false"
                aria-label="Idioma"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
                </svg>
                <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              <div className="lang-menu" id="langmenu">
                <button className="lang-i on" data-l="es">
                  Español
                </button>
                <button className="lang-i" data-l="en">
                  English
                </button>
              </div>
            </div>
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
