/* Calculadora de impacto — vive dentro del modal. La lógica (pasos, sliders,
   cuentas y tweens) está en lib/landing/engine.ts. */

export default function CalcModal() {
  return (
    <div className="calc-modal" id="calcModal">
      <div className="calc-modal-backdrop" id="calc-backdrop" />
      <div className="calc-modal-box">
        <button className="calc-modal-x" id="calc-x" aria-label="Cerrar">
          ✕
        </button>

        <div className="tv" id="tv">
          <div className="tv-bg">
            <div className="tv-bk" id="tv-bk" />
          </div>
          <div className="tv-shell">
            <div className="tv-in2">
              <div className="tv-head">
                <div className="kicker">La cuenta</div>
                <h2>¿Cuánto te cuesta escribir fichas?</h2>
                <p className="lede">
                  Mueve tus números. Nosotros solo hacemos la multiplicación — y te enseñamos la cuenta al final.
                </p>
              </div>

              <div className="tv-box">
                <div className="tv-rail" id="tv-rail">
                  <button className="tv-stp on" data-go="1">
                    <span className="tv-sn">1</span>
                    <span className="tv-sl">Tu clínica</span>
                  </button>
                  <button className="tv-stp" data-go="2">
                    <span className="tv-sn">2</span>
                    <span className="tv-sl">Tu escenario</span>
                  </button>
                  <button className="tv-stp" data-go="3">
                    <span className="tv-sn">3</span>
                    <span className="tv-sl">Tu impacto</span>
                  </button>
                </div>

                <div className="tv-panes">
                  <div className="tv-pane on" data-s="1">
                    <h3>Cuéntanos de tu día</h3>
                    <div className="tv-sub">
                      Todo lo de esta pantalla lo sabes tú. Nosotros no ponemos ni un número acá.
                    </div>
                    <div className="tv-grid">
                      <div className="tv-f">
                        <div className="tv-lab">
                          <span className="tv-lt">¿Cuántos veterinarios atienden consultas?</span>
                        </div>
                        <div className="tv-pmw">
                          <button className="tv-pm" data-n="vets:-1">
                            −
                          </button>
                          <div className="tv-pv">
                            <b id="tv-vets">2</b>veterinarios
                          </div>
                          <button className="tv-pm" data-n="vets:1">
                            +
                          </button>
                        </div>
                      </div>
                      <div className="tv-f">
                        <div className="tv-lab">
                          <span className="tv-lt">Consultas por veterinario al día</span>
                          <span className="tv-lv" id="tv-vcd">
                            10
                          </span>
                        </div>
                        <input className="tv-r" id="tv-cd" type="range" min="1" max="20" step="1" defaultValue="10" />
                      </div>
                      <div className="tv-f">
                        <div className="tv-lab">
                          <span className="tv-lt">Lo que cobras por una visita</span>
                        </div>
                        <div className="tv-inp">
                          <span>$</span>
                          <input id="tv-tk" type="text" inputMode="numeric" defaultValue="120.000" />
                          <em>COP</em>
                        </div>
                        <div className="tv-hint">
                          Consulta, exámenes, medicamentos o procedimientos asociados, cuando aplique.
                        </div>
                      </div>
                      <div className="tv-f">
                        <div className="tv-lab">
                          <span className="tv-lt">Cuánto dura una consulta</span>
                        </div>
                        <div className="tv-chips" id="tv-du">
                          <button className="tv-chip" data-du="15">
                            15 min
                          </button>
                          <button className="tv-chip sel" data-du="20">
                            20 min
                          </button>
                          <button className="tv-chip" data-du="30">
                            30 min
                          </button>
                          <button className="tv-chip" data-du="45">
                            45 min
                          </button>
                        </div>
                      </div>
                      <div className="tv-f" style={{ gridColumn: "1/-1" }}>
                        <div className="tv-lab">
                          <span className="tv-lt">Minutos que le metes a la documentación por consulta</span>
                          <span className="tv-lv" id="tv-vdoc">
                            8<small>min</small>
                          </span>
                        </div>
                        <input className="tv-r" id="tv-doc" type="range" min="1" max="20" step="1" defaultValue="8" />
                        <div className="tv-hint">
                          Historia clínica, indicaciones, antecedentes, buscar información y hablar con el dueño.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="tv-pane" data-s="2">
                    <h3>Ajusta el escenario</h3>
                    <div className="tv-sub">Acá sí ponemos algo nosotros. Está a la vista y lo puedes mover todo.</div>
                    <div className="tv-grid">
                      <div className="tv-f" style={{ gridColumn: "1/-1" }}>
                        <div className="tv-lab">
                          <span className="tv-lt">Minutos que VetGPT te devuelve por consulta</span>
                          <span className="tv-lv" id="tv-vmin">
                            5<small>min</small>
                          </span>
                        </div>
                        <div className="tv-scen" id="tv-sc">
                          <button className="tv-sc" data-sc="3">
                            <div className="tv-scv">
                              3<small>min</small>
                            </div>
                            <div className="tv-scl">Conservador</div>
                          </button>
                          <button className="tv-sc sel" data-sc="5">
                            <div className="tv-scv">
                              5<small>min</small>
                            </div>
                            <div className="tv-scl">Realista</div>
                          </button>
                          <button className="tv-sc" data-sc="8">
                            <div className="tv-scv">
                              8<small>min</small>
                            </div>
                            <div className="tv-scl">Optimista</div>
                          </button>
                        </div>
                        <div className="tv-hint">
                          Estimación nuestra, no medida — todavía no tenemos clínicas usándolo. Ajústala con precisión
                          abajo.
                        </div>
                        <div className="tv-pmw" style={{ marginTop: 12 }}>
                          <button className="tv-pm" data-n="min:-1">
                            −
                          </button>
                          <div className="tv-pv">
                            <b id="tv-vmin2">5</b>min por consulta
                          </div>
                          <button className="tv-pm" data-n="min:1">
                            +
                          </button>
                        </div>
                      </div>
                      <div className="tv-f" style={{ gridColumn: "1/-1" }}>
                        <div className="tv-lab">
                          <span className="tv-lt">¿Qué harías con ese tiempo?</span>
                        </div>
                        <div className="tv-chips" id="tv-us">
                          <button className="tv-chip sel" data-cap="50">
                            Mitad y mitad
                          </button>
                          <button className="tv-chip" data-cap="100">
                            Atender más
                          </button>
                          <button className="tv-chip" data-cap="0">
                            Irme a mi casa
                          </button>
                        </div>
                      </div>
                      <div className="tv-f" style={{ gridColumn: "1/-1" }}>
                        <div className="tv-lab">
                          <span className="tv-lt">Porcentaje del tiempo que destinarías a nuevas consultas</span>
                          <span className="tv-lv" id="tv-vcap">
                            50<small>%</small>
                          </span>
                        </div>
                        <input className="tv-r" id="tv-cap" type="range" min="0" max="100" step="5" defaultValue="50" />
                      </div>
                    </div>
                    <div className="tv-adv" id="tv-adv">
                      <button className="tv-advh" id="tv-advh">
                        <span className="tv-pmi" />
                        Ajustar la estimación
                      </button>
                      <div className="tv-advb">
                        <div className="tv-grid">
                          <div className="tv-f">
                            <div className="tv-lab">
                              <span className="tv-lt">Días que operas al mes</span>
                              <span className="tv-lv" id="tv-vdm">
                                22
                              </span>
                            </div>
                            <input className="tv-r" id="tv-dm" type="range" min="10" max="30" step="1" defaultValue="22" />
                          </div>
                          <div className="tv-f">
                            <div className="tv-lab">
                              <span className="tv-lt">Consultas en las que usarías VetGPT</span>
                              <span className="tv-lv" id="tv-vad">
                                70<small>%</small>
                              </span>
                            </div>
                            <input className="tv-r" id="tv-ad" type="range" min="10" max="100" step="5" defaultValue="70" />
                          </div>
                          <div className="tv-f">
                            <div className="tv-lab">
                              <span className="tv-lt">Margen de contribución</span>
                              <span className="tv-lv" id="tv-vmg">
                                60<small>%</small>
                              </span>
                            </div>
                            <input className="tv-r" id="tv-mg" type="range" min="20" max="90" step="5" defaultValue="60" />
                          </div>
                          <div className="tv-f">
                            <div className="tv-lab">
                              <span className="tv-lt">Costo mensual de Tuvetia</span>
                            </div>
                            <div className="tv-inp">
                              <span>$</span>
                              <input id="tv-co" type="text" inputMode="numeric" placeholder="sin definir" />
                              <em>COP</em>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="tv-pane" data-s="3">
                    <div className="tv-hero">
                      <div className="tv-hk">Horas que te devuelve al mes</div>
                      <div className="tv-hn" id="tv-oh">
                        0<u>h</u>
                      </div>
                      <div className="tv-hs">
                        Son <b id="tv-oj">0 jornadas</b> de 8 horas cada mes. Al año, <b id="tv-oha">0 horas</b>.
                      </div>
                    </div>
                    <div className="tv-cards">
                      <div className="tv-card">
                        <div className="tv-ck">
                          Consultas adicionales
                          <br />
                          al mes
                        </div>
                        <div className="tv-cv" id="tv-oca">
                          0
                        </div>
                        <div className="tv-cs">si reinviertes el tiempo</div>
                      </div>
                      <div className="tv-card">
                        <div className="tv-ck">
                          Facturación potencial
                          <br />
                          al mes
                        </div>
                        <div className="tv-cv" id="tv-ofm">
                          $0
                        </div>
                        <div className="tv-cs" id="tv-ofa">
                          $0 al año
                        </div>
                      </div>
                      <div className="tv-card">
                        <div className="tv-ck">
                          Retorno por cada
                          <br />
                          $1 invertido
                        </div>
                        <div className="tv-cv mut" id="tv-ort">
                          —
                        </div>
                        <div className="tv-cs" id="tv-oco">
                          falta definir el precio
                        </div>
                      </div>
                    </div>
                    <div className="tv-vs">
                      <div className="tv-col">
                        <div className="tv-colh">Hoy</div>
                        <div className="tv-li">
                          <i>·</i>
                          <span>
                            <b id="tv-ohop">0 h</b> de consulta al mes
                          </span>
                        </div>
                        <div className="tv-li">
                          <i>·</i>
                          <span>
                            <b id="tv-ohdoc">0 h</b> escribiendo fichas
                          </span>
                        </div>
                        <div className="tv-li">
                          <i>·</i>
                          <span>Y las que se van a la casa</span>
                        </div>
                      </div>
                      <div className="tv-col on">
                        <div className="tv-colh">Con VetGPT</div>
                        <div className="tv-li">
                          <i>·</i>
                          <span>
                            <b id="tv-oh2">0 h</b> de vuelta en tu mes
                          </span>
                        </div>
                        <div className="tv-li">
                          <i>·</i>
                          <span>La ficha sale firmada del consultorio</span>
                        </div>
                        <div className="tv-li">
                          <i>·</i>
                          <span>Tú decides si atiendes más o te vas</span>
                        </div>
                      </div>
                    </div>
                    <div className="tv-how" id="tv-how">
                      <button className="tv-howh" id="tv-howh">
                        <span className="tv-pmi" />
                        ¿Cómo sacamos este número?
                      </button>
                      <div className="tv-howb">
                        <div id="tv-oform" />
                      </div>
                    </div>
                    <div className="tv-lead">
                      <div className="tv-leadh">¿Quieres verlo con un caso tuyo?</div>
                      <div className="tv-leads">
                        Déjanos tu nombre y sigamos por WhatsApp: 15 minutos, traes una consulta real y ves la ficha
                        escribirse. Te escribe un fundador, no un vendedor.
                      </div>
                      <div className="tv-inp">
                        <input type="text" id="tv-ldn" placeholder="Tu nombre (opcional)" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="tv-foot">
                  <button className="tv-back" id="tv-back" disabled>
                    Atrás
                  </button>
                  <button className="tv-next" id="tv-next">
                    Continuar →
                  </button>
                </div>
                <div className="tv-legal">
                  Esto es una estimación construida con los números que tú entraste y un escenario que tú escogiste.
                  No es una promesa: los resultados reales dependen de tu flujo clínico y de cuánto lo uses.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
