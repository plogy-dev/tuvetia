/* La demo que se mueve sola. El markup es el escenario; el guion vive en
   lib/landing/engine.ts (el "director") y lo anima después del mount. */

export default function DemoStage() {
  return (
    <section className="demo-stage">
      <div className="frame" id="frame">
        <div className="chrome">
          <div className="lights">
            <button className="lt red" id="lt-close" title="Reiniciar la demo">
              <i />
            </button>
            <button className="lt yel" id="lt-min" title="Pausar">
              <i />
            </button>
            <button className="lt grn" id="lt-max" title="Pantalla completa">
              <i />
            </button>
          </div>
          <div className="wtitle" id="wtitle">
            <span className="rd" />
            <span>Tuvetia</span>
            <span className="sep">/</span>
            <b id="wsec">Pacientes</b>
          </div>
          <div className="chrome-r" id="chrome-r">
            Dra. Lozano
          </div>
        </div>
        <div className="grid">
          <div className="sb">
            <div className="sb-brand">
              <div className="sb-dot" />
              Tuvetia
            </div>
            <button className="startbtn" id="startbtn">
              <svg className="g" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 2v2M5 2v2M5 4v7a6 6 0 0 0 12 0V4" />
                <circle cx="20" cy="10" r="2" />
                <path d="M8 15v1a6 6 0 0 0 12 0v-4" />
              </svg>
              Iniciar consulta
            </button>
            <div className="navlink">
              <svg className="g" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m12 3-1.9 5.8-5.8 1.9 5.8 1.9L12 18l1.9-5.4 5.8-1.9-5.8-1.9z" />
              </svg>
              Athos
            </div>
            <div className="navlink on" data-page="pacientes" id="nav-pac">
              <svg className="g" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              </svg>
              Pacientes
            </div>
            <div className="navlink" data-page="calendario" id="nav-cal">
              <svg className="g" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              Calendario
            </div>
            <div className="navlink" data-page="comunicaciones" id="nav-com">
              <svg className="g" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 7-10 5L2 7" />
              </svg>
              Comunicaciones
            </div>
            <div className="navlink">
              <svg className="g" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z" />
              </svg>
              Conexiones
            </div>
            <div className="navlink">
              <svg className="g" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V6l8-4 8 4z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              Admin
            </div>
            <div className="sb-foot">Dra. Lozano · Bogotá</div>
          </div>

          <div className="center">
            <div className="page on" data-page="pacientes">
              <div className="pgh">
                <div>
                  <div className="pgt">Pacientes</div>
                  <div className="pgs">4 pacientes</div>
                </div>
                <div className="acts">
                  <div className="srch">🔍 Buscar paciente o titular…</div>
                  <button className="b">Tabla</button>
                  <button className="b pri">+ Nuevo</button>
                </div>
              </div>
              <div className="pbody">
                <div className="cards">
                  <div className="pcard" id="rockycard">
                    <div className="avt">🐕</div>
                    <div>
                      <div className="pn">Rocky</div>
                      <div className="psp">canino · bulldog francés</div>
                      <div className="pow">Carlos Restrepo</div>
                    </div>
                    <div className="tag" id="rockytag">
                      al día
                    </div>
                  </div>
                  <div className="pcard">
                    <div className="avt">🐈</div>
                    <div>
                      <div className="pn">Mishi</div>
                      <div className="psp">felino · criollo</div>
                      <div className="pow">Ana Gómez</div>
                    </div>
                    <div className="tag">al día</div>
                  </div>
                  <div className="pcard">
                    <div className="avt">🐈</div>
                    <div>
                      <div className="pn">Luna</div>
                      <div className="psp">felino · siamés</div>
                      <div className="pow">Diana Muñoz</div>
                    </div>
                    <div className="tag">por firmar</div>
                  </div>
                  <div className="pcard">
                    <div className="avt">🐕</div>
                    <div>
                      <div className="pn">Toby</div>
                      <div className="psp">canino · beagle</div>
                      <div className="pow">Carlos Restrepo</div>
                    </div>
                    <div className="tag">al día</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="page" data-page="calendario">
              <div className="pgh">
                <div>
                  <div className="pgt">Calendario</div>
                  <div className="pgs">Viernes 17 de julio · 8 citas</div>
                </div>
                <div className="acts">
                  <button className="b">Mes</button>
                  <button className="b">Semana</button>
                  <button className="b pri">+ Nueva cita</button>
                </div>
              </div>
              <div className="pbody">
                <div className="slot">
                  <div className="slt">09:00</div>
                  <div>
                    <div className="sln">Luna · control post-quirúrgico</div>
                    <div className="sls">Diana Muñoz · completada</div>
                  </div>
                </div>
                <div className="slot live">
                  <div className="slt">10:00</div>
                  <div>
                    <div className="sln">Rocky · consulta dermatológica</div>
                    <div className="sls">Carlos Restrepo · en curso — Athos está oyendo</div>
                  </div>
                </div>
                <div className="slot">
                  <div className="slt">11:30</div>
                  <div>
                    <div className="sln">Mishi · vacunación anual</div>
                    <div className="sls">Ana Gómez · programada</div>
                  </div>
                </div>
                <div className="slot">
                  <div className="slt">14:00</div>
                  <div>
                    <div className="sln">Toby · control de peso</div>
                    <div className="sls">Carlos Restrepo · programada</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="page" data-page="comunicaciones">
              <div className="pgh">
                <div>
                  <div className="pgt">Comunicaciones</div>
                  <div className="pgs">1 esperando tu aprobación</div>
                </div>
                <div className="acts">
                  <button className="b">Archivadas</button>
                  <button className="b pri">+ Nuevo mensaje</button>
                </div>
              </div>
              <div className="pbody">
                <div className="thr">
                  <div className="avt">C</div>
                  <div className="thb">
                    <div className="thn">
                      Carlos Restrepo <span className="tag">WhatsApp · 10:06</span>
                    </div>
                    <div className="thm">«Doctora, ¿le dejo a Rocky o me lo llevo y vuelvo?»</div>
                    <div className="thd">
                      <div className="thdh">⏸ Athos se detuvo · requiere tu aprobación</div>
                      <div className="thdp">
                        Borrador: «La doctora está con Rocky ahora. Te escribimos apenas termine — no te vayas
                        lejos.»
                      </div>
                      <div className="thdb">
                        <button className="gb pri">Aprobar y enviar</button>
                        <button className="gb">Editar</button>
                        <button className="gb">Yo respondo</button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="thr">
                  <div className="avt">A</div>
                  <div className="thb">
                    <div className="thn">
                      Ana Gómez <span className="tag">WhatsApp · 09:41</span>
                    </div>
                    <div className="thm">
                      «¿Mishi puede comer antes de la vacuna?» — Athos respondió y confirmó la cita de las 11:30.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="notch" id="notch">
              <div className="nrow">
                <span className="lite" id="lite" />
                <span className="nn">Athos</span>
                <span className="nd">·</span>
                <span>Rocky</span>
                <span style={{ opacity: 0.5, fontSize: 11 }}>bulldog francés</span>
                <div className="wave" id="wv" />
                <span className="nt" id="tmr">
                  10:24
                </span>
                <div className="nacts">
                  <button className="nb" id="bpause">
                    ❚❚
                  </button>
                  <button className="nb dg" id="bstop">
                    ■
                  </button>
                  <button className="nb" id="bmax">
                    ⤢
                  </button>
                  <button className="nb" id="bexp">
                    ⌄
                  </button>
                </div>
              </div>
              <div className="npanel">
                <div className="ntabs" id="ntabs" />
                <div className="ncontent" id="ncontent" />
              </div>
            </div>

            <div className="ck" id="ck">
              <div className="ckbar">
                <span className="lite" id="lite2" />
                <span className="nn">Athos</span>
                <span className="nd">·</span>
                <span style={{ fontWeight: 500 }}>Rocky</span>
                <span style={{ opacity: 0.5, fontSize: 11.5 }}>bulldog francés</span>
                <div className="wave" id="wv2" />
                <span className="nt" id="tmr2">
                  10:24
                </span>
                <div className="ckacts">
                  <button className="ckb" id="ckstop2">
                    ■ Acabar
                  </button>
                  <button className="ckb" id="ckmin">
                    ⤡ Minimizar
                  </button>
                </div>
              </div>
              <div className="cktabs" id="cktabs" />
              <div className="ckbody">
                <div className="pane">
                  <div className="paneh">
                    <div>
                      <h4>Live notes</h4>
                      <p>Athos lo arma solo a medida que escucha</p>
                    </div>
                    <div className="upd">
                      <span className="spin" />
                      actualizando
                    </div>
                  </div>
                  <div className="panec" id="livepane" />
                </div>
                <div className="pane">
                  <div className="paneh">
                    <div>
                      <h4>Mi cuaderno</h4>
                      <p>Hoja en blanco — escribe libre</p>
                    </div>
                  </div>
                  <div className="panec">
                    <div className="cuad" id="cuad" />
                  </div>
                  <div className="cfoot">
                    <span className="m">✓ Guardado</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="veil" id="veil">
              <div>
                <div className="orb" id="orb" />
                <h3 id="vh">Athos está organizando tus notas…</h3>
                <p id="vp">No cierres la ventana.</p>
              </div>
            </div>

            <div className="note" id="note" />

            <div className="ghost-cur" id="cur">
              <div className="ring" />
              <svg viewBox="0 0 24 24" fill="#151311" stroke="#F7F3EA" strokeWidth="1.4">
                <path d="M5.5 3.2v14.4l3.6-3.4h5.2z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <div className="player">
        <button className="pbtn" id="playbtn">
          ❚❚
        </button>
        <div className="chaps" id="chaps" />
      </div>
      <div className="cap" id="cap" />
      <div className="hint" id="hint">
        Se mueve sola · toca cualquier cosa y tomas el control
      </div>
    </section>
  );
}
