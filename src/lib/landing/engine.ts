/* Motor de la landing — portado 1:1 del <script> de index.html (v23).
   Toda la interacción vive acá: la demo que se mueve sola (el "director"),
   el cursor fantasma, la pastilla/cockpit, el nav flotante, el parallax,
   la calculadora de impacto, el FAQ y el selector de acento.

   initLanding() se llama al montar <Landing/> y devuelve el cleanup:
   des-registra listeners globales, observers, intervalos y timeouts. */

import {
  NOTEBOOK,
  liveNote,
  transcript,
  sugs,
  vetNotes,
  PILL_TABS,
  CK_TABS,
} from "./data";
import { buildWaLink } from "./contact";

export function initLanding(): () => void {
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  let destroyed = false;

  /* ── infraestructura de cleanup ── */
  const cleanups: Array<() => void> = [];
  const on = (
    target: EventTarget,
    type: string,
    fn: EventListenerOrEventListenerObject,
    opts?: AddEventListenerOptions,
  ) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };
  const timeouts = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timeouts.delete(t);
      if (!destroyed) fn();
    }, ms);
    timeouts.add(t);
    return t;
  };

  /* ═══ fondo: estrellas + bokeh ═══ */
  const stEl = $("stars");
  stEl.innerHTML = "";
  for (let i = 0; i < 140; i++) {
    const s = document.createElement("i");
    const z = Math.random() * 1.8 + 0.4;
    s.style.cssText = `width:${z}px;height:${z}px;left:${Math.random() * 100}%;top:${Math.random() * 100}%;animation-delay:${Math.random() * 4}s`;
    stEl.appendChild(s);
  }

  /* ═══ estado de la demo ═══ */
  const S: {
    running: boolean;
    view: string;
    alert: boolean;
    tab: string;
    cktab: string;
    t: number;
    page: string;
  } = { running: false, view: "none", alert: false, tab: "transcript", cktab: "consulta", t: 624, page: "pacientes" };
  $("cuad").textContent = NOTEBOOK;

  function panelHTML(tab: string): string {
    if (tab === "transcript")
      return transcript
        .map(
          (l) =>
            `<div class="tline ${l.sp}"><div class="tmeta"><span>${l.t}</span><span>${l.sp === "vet" ? "vet" : "dueño"}</span></div>${l.txt}</div>`,
        )
        .join("");
    if (tab === "live-notes")
      return `<div class="nblk"><div class="nl">Motivo</div>${liveNote.motivo}</div><div class="nblk"><div class="nl">Anamnesis</div>${liveNote.anamnesis}</div><div class="nblk"><div class="nl">Signos vitales</div>${Object.entries(liveNote.vitales)
        .map(([k, v]) => `<div class="vt"><span>${k}:</span><span>${v}</span></div>`)
        .join("")}</div>`;
    if (tab === "suggestions")
      return sugs
        .map(
          (s) =>
            `<div class="nblk"><div class="nl">${s.lb} · 1</div><div class="sgc ${s.kind}">${s.txt}<div class="sgb"><span>confianza ${s.conf}</span><span>·</span><span>${s.based}</span></div></div></div>`,
        )
        .join("");
    if (tab === "vet-notes")
      return (
        `<div class="nl">Anteriores en esta consulta · ${vetNotes.length}</div>` +
        vetNotes
          .map((n) => `<div class="tline"><div class="tmeta"><span>${n.t}</span></div>${n.txt}</div>`)
          .join("")
      );
    return `<div class="soon">Próximamente<br><span style="letter-spacing:0;text-transform:none;font-size:11px">placeholder en el código real</span></div>`;
  }

  function liveHTML(upto: number): string {
    let h = "";
    if (upto >= 1) h += `<div class="cblk"><div class="cl">Motivo</div><div class="cp" id="tw0"></div></div>`;
    if (upto >= 2) h += `<div class="cblk"><div class="cl">Anamnesis</div><div class="cp" id="tw1"></div></div>`;
    if (upto >= 3)
      h += `<div class="cblk"><div class="cl">Signos vitales</div>${Object.entries(liveNote.vitales)
        .map(([k, v]) => `<div class="cvt"><span>${k}:</span><span>${v}</span></div>`)
        .join("")}</div>`;
    if (upto >= 4)
      h += `<div class="cblk"><div class="cl">Hallazgos</div>${liveNote.hallazgos
        .map((x) => `<div class="cbl"><i>•</i><span>${x}</span></div>`)
        .join("")}</div>`;
    if (upto >= 5) h += `<div class="cblk"><div class="cl">Plan</div><div class="cp">${liveNote.plan}</div></div>`;
    if (upto >= 6)
      h += `<div class="cblk"><div class="cl">Pendientes / preguntas abiertas</div>${liveNote.abiertas
        .map((x) => `<div class="cbl"><i>•</i><span>${x}</span></div>`)
        .join("")}</div>`;
    return h;
  }

  function render() {
    $("notch").classList.toggle("live", S.view === "ghost" || S.view === "expanded");
    $("notch").classList.toggle("wide", S.view === "expanded");
    $("ck").classList.toggle("on", S.view === "cockpit");
    $("veil").classList.toggle("on", S.view === "organizing" || S.view === "done");
    [$("lite"), $("lite2")].forEach((l) => l.classList.toggle("alert", S.alert));
    $("rockycard").classList.toggle("live", S.view !== "none" && S.view !== "done");
    $("rockytag").classList.toggle("live", S.view !== "none" && S.view !== "done");
    $("rockytag").textContent = S.view !== "none" && S.view !== "done" ? "en consulta" : "al día";
    $("ntabs").innerHTML = PILL_TABS.map(
      ([id, l]) =>
        `<button class="nt2 ${S.tab === id ? "on" : ""}" data-t="${id}">${l}${id === "suggestions" && S.alert ? '<span class="dotb"></span>' : ""}</button>`,
    ).join("");
    $("ncontent").innerHTML = panelHTML(S.tab);
    $("cktabs").innerHTML = CK_TABS.map(
      ([id, l]) =>
        `<button class="nt2 ${S.cktab === id ? "on" : ""}" data-ct="${id}">${l}${id === "suggestions" && S.alert ? '<span class="dotb"></span>' : ""}</button>`,
    ).join("");
    if (S.cktab !== "consulta") {
      $("livepane").innerHTML = panelHTML(S.cktab === "transcript" ? "transcript" : S.cktab);
    }
    document.querySelectorAll<HTMLElement>(".nt2[data-t]").forEach(
      (b) =>
        (b.onclick = () => {
          takeover();
          S.tab = b.dataset.t!;
          if (b.dataset.t === "suggestions") S.alert = false;
          render();
        }),
    );
    document.querySelectorAll<HTMLElement>(".nt2[data-ct]").forEach(
      (b) =>
        (b.onclick = () => {
          takeover();
          S.cktab = b.dataset.ct!;
          render();
          if (b.dataset.ct === "consulta") $("livepane").innerHTML = liveHTML(6);
        }),
    );
    document.querySelectorAll<HTMLElement>(".page").forEach((p) => p.classList.toggle("on", p.dataset.page === S.page));
    document
      .querySelectorAll<HTMLElement>(".navlink[data-page]")
      .forEach((n) => n.classList.toggle("on", n.dataset.page === S.page));
    const SEC: Record<string, string> = { pacientes: "Pacientes", calendario: "Calendario", comunicaciones: "Comunicaciones" };
    $("wsec").textContent = S.view === "cockpit" ? "Consulta · Rocky" : S.view === "done" ? "Consulta cerrada" : SEC[S.page];
    $("wtitle").classList.toggle("rec", S.view !== "none" && S.view !== "done");
    $("chrome-r").textContent = $("frame").classList.contains("full") ? "Esc para salir" : "Dra. Lozano";
  }

  const clockInterval = setInterval(() => {
    if (S.view === "none" || S.view === "organizing" || S.view === "done") return;
    S.t++;
    const v = String(Math.floor(S.t / 60)).padStart(2, "0") + ":" + String(S.t % 60).padStart(2, "0");
    $("tmr").textContent = v;
    $("tmr2").textContent = v;
  }, 1000);
  cleanups.push(() => clearInterval(clockInterval));

  /* ═══ cursor fantasma ═══ */
  const cur = $("cur");
  const center = document.querySelector(".center") as HTMLElement;
  function moveTo(sel: string, ms = 620): Promise<void> {
    return new Promise((r) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) {
        r();
        return;
      }
      const a = el.getBoundingClientRect(),
        b = center.getBoundingClientRect();
      cur.style.transitionDuration = ms / 1000 + "s";
      cur.classList.add("on");
      cur.style.transform = `translate(${a.left - b.left + a.width / 2 - 6}px,${a.top - b.top + a.height / 2 - 4}px)`;
      timer = later(r, ms);
    });
  }
  function press(sel: string, ms = 340): Promise<void> {
    return new Promise((r) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      cur.classList.add("click");
      if (el) el.classList.add("press");
      timer = later(() => {
        cur.classList.remove("click");
        if (el) el.classList.remove("press");
        r();
      }, ms);
    });
  }

  /* ── burbujas: explican señalando, mientras corre ── */
  const note = $("note");
  function say(sel: string, kicker: string, html: string, place = "pb") {
    const el = document.querySelector(sel) as HTMLElement | null;
    note.className = "note " + place;
    note.innerHTML = '<div class="nk">' + kicker + "</div><p>" + html + "</p>";
    if (el) {
      const a = el.getBoundingClientRect(),
        c = center.getBoundingClientRect();
      const nw = note.offsetWidth,
        nh = note.offsetHeight;
      const ax = a.left - c.left,
        ay = a.top - c.top;
      let x: number, y: number;
      if (place === "pb") {
        x = ax + a.width / 2 - 30;
        y = ay + a.height + 11;
      } else if (place === "pt") {
        x = ax + a.width / 2 - 30;
        y = ay - nh - 11;
      } else if (place === "pr") {
        x = ax + a.width + 11;
        y = ay + a.height / 2 - 24;
      } else {
        x = ax - nw - 11;
        y = ay + a.height / 2 - 24;
      }
      note.style.left = Math.max(10, Math.min(x, c.width - nw - 10)) + "px";
      note.style.top = Math.max(10, Math.min(y, c.height - nh - 10)) + "px";
    }
    requestAnimationFrame(() => note.classList.add("on"));
  }
  function hush() {
    note.classList.remove("on");
  }
  const wait = (ms: number) =>
    new Promise<void>((r) => {
      timer = later(r, ms);
    });

  /* ═══ typing de las live notes ═══ */
  async function typeLive() {
    $("livepane").innerHTML = liveHTML(1);
    await typeInto("tw0", liveNote.motivo);
    $("livepane").innerHTML = liveHTML(2);
    $("tw0").textContent = liveNote.motivo;
    await typeInto("tw1", liveNote.anamnesis);
    $("livepane").innerHTML = liveHTML(4);
    $("tw0").textContent = liveNote.motivo;
    $("tw1").textContent = liveNote.anamnesis;
    await wait(280);
    $("livepane").innerHTML = liveHTML(6);
    $("tw0").textContent = liveNote.motivo;
    $("tw1").textContent = liveNote.anamnesis;
  }
  function typeInto(id: string, txt: string): Promise<void> {
    return new Promise((r) => {
      let i = 0;
      const el = $(id);
      if (!el) {
        r();
        return;
      }
      (function step() {
        if (!S.running) {
          r();
          return;
        }
        if (i >= txt.length) {
          el.textContent = txt;
          r();
          return;
        }
        i++;
        el.innerHTML = txt.slice(0, i) + '<span class="cr"></span>';
        timer = later(step, txt[i - 1] === "." ? 75 : 9);
      })();
    });
  }

  /* ═══ el director ═══ */
  let timer: ReturnType<typeof setTimeout> | null = null,
    idx = 0;
  const CHAPTERS: Array<[string, number]> = [
    ["La ficha", 0],
    ["La alerta", 2],
    ["El fantasma", 4],
    ["WhatsApp", 6],
    ["Acabar", 8],
  ];
  const script: Array<{ cap: string; run: () => Promise<void> }> = [
    /* ── 0.0s → el clic, sin preámbulo ── */
    {
      cap: "",
      run: async () => {
        S.view = "none";
        S.page = "pacientes";
        S.alert = false;
        S.t = 624;
        S.tab = "transcript";
        S.cktab = "consulta";
        render();
        hush();
        await moveTo("#startbtn", 620);
        await press("#startbtn", 340);
        S.view = "cockpit";
        render();
        $("livepane").innerHTML = "";
        await wait(240);
      },
    },

    /* ── 1.2s → la nota se escribe sola ── */
    {
      cap: "<b>Atiendes normal.</b> Athos escribe.",
      run: async () => {
        cur.classList.remove("on");
        say(
          "#livepane",
          "Athos",
          "Redacta la <b>historia clínica</b> mientras hablas. Tú no tocas el teclado — a la derecha está tu cuaderno, como siempre.",
          "pr",
        );
        await typeLive();
        await wait(260);
      },
    },

    /* ── 5.3s → la luz ── */
    {
      cap: "Athos encontró algo.",
      run: async () => {
        S.alert = true;
        render();
        say("#lite2", "Alerta", "La luz pasa a <b>ámbar</b>. No te interrumpe la consulta: te espera.", "pb");
        await wait(1450);
      },
    },

    /* ── 7.7s → EL REMATE ── */
    {
      cap: "<b>Athos te frena.</b>",
      run: async () => {
        await moveTo('.nt2[data-ct="suggestions"]', 540);
        await press('.nt2[data-ct="suggestions"]', 320);
        S.cktab = "suggestions";
        render();
        cur.classList.remove("on");
        await wait(120);
        say(
          ".sgc.contradiction",
          "Contradicción con la ficha",
          "La ficha de Rocky dice <b>alergia a pollo</b> desde marzo. El alimento nuevo que acaba de mencionar el dueño lo lleva de primer ingrediente. Athos lo cruzó solo, en la consulta.",
          "pr",
        );
        await wait(4400);
        hush();
      },
    },

    /* ── el resto: para el que se quedó ── */
    {
      cap: "Minimizas. <b>La consulta sigue corriendo.</b>",
      run: async () => {
        S.cktab = "consulta";
        render();
        $("livepane").innerHTML = liveHTML(6);
        await moveTo("#ckmin", 560);
        await press("#ckmin", 300);
        S.view = "ghost";
        render();
        say("#notch", "El fantasma", "Sales del cockpit, no de la consulta. La pastilla se queda arriba, oyendo.", "pb");
        await wait(1900);
        hush();
      },
    },

    {
      cap: "Sigues tu agenda. <b>Athos no se va.</b>",
      run: async () => {
        await moveTo("#nav-cal", 560);
        await press("#nav-cal", 300);
        S.page = "calendario";
        render();
        await wait(150);
        say(".slot.live", "En curso", "Tu agenda sabe que estás con Rocky. El software entero se entera de la consulta.", "pb");
        await wait(2100);
        hush();
      },
    },

    {
      cap: "El dueño escribe <b>mientras estás con su perro.</b>",
      run: async () => {
        await moveTo("#nav-com", 560);
        await press("#nav-com", 300);
        S.page = "comunicaciones";
        render();
        await wait(150);
        say(
          ".thd",
          "Frenado",
          "Athos contestó lo logístico solo. Lo clínico lo <b>detiene y te espera</b> — nada sale sin tu aprobación.",
          "pt",
        );
        await wait(3400);
        hush();
      },
    },

    {
      cap: "Abres la pastilla <b>sin salir de donde estás.</b>",
      run: async () => {
        await moveTo("#bexp", 540);
        await press("#bexp", 300);
        S.view = "expanded";
        S.tab = "suggestions";
        S.alert = false;
        render();
        cur.classList.remove("on");
        await wait(2900);
      },
    },

    {
      cap: "Acabas. <b>Athos organiza tu cuaderno en la nota.</b>",
      run: async () => {
        await moveTo("#bstop", 520);
        await press("#bstop", 300);
        S.view = "organizing";
        render();
        cur.classList.remove("on");
        hush();
        $("orb").style.display = "";
        $("vh").textContent = "Athos está organizando tus notas…";
        $("vp").textContent = "No cierres la ventana.";
        await wait(1900);
        S.view = "done";
        render();
        $("orb").style.display = "none";
        $("vh").textContent = "Consulta cerrada.";
        $("vp").textContent =
          "Athos fusionó tu cuaderno con el transcript en la nota clínica estructurada. Tú la revisas, la corriges y la firmas.";
        await wait(2600);
      },
    },
  ];
  $("chaps").innerHTML = CHAPTERS.map(
    (c) => `<button class="chap" data-i="${c[1]}"><div class="bar"><i></i></div><div class="lb">${c[0]}</div></button>`,
  ).join("");
  function paintChaps() {
    document.querySelectorAll<HTMLElement>(".chap").forEach((el, i) => {
      const start = CHAPTERS[i][1],
        next = CHAPTERS[i + 1] ? CHAPTERS[i + 1][1] : script.length;
      el.classList.toggle("on", idx >= start && idx < next);
      el.classList.toggle("done", idx >= start);
    });
  }
  async function play() {
    while (S.running) {
      const s = script[idx];
      ($("cap") as HTMLElement).style.opacity = "0";
      later(() => {
        $("cap").innerHTML = s.cap;
        ($("cap") as HTMLElement).style.opacity = "1";
      }, 200);
      paintChaps();
      await s.run();
      if (!S.running) return;
      idx = (idx + 1) % script.length;
    }
  }
  function start() {
    if (S.running || destroyed) return;
    S.running = true;
    $("playbtn").textContent = "❚❚";
    $("hint").textContent = "Se mueve sola · toca cualquier cosa y tomas el control";
    play();
  }
  function stop() {
    S.running = false;
    if (timer) clearTimeout(timer);
    cur.classList.remove("on");
    hush();
    $("playbtn").textContent = "▶";
    $("hint").textContent = "Tú tienes el control · dale ▶ para que siga sola";
  }
  function takeover() {
    if (S.running) stop();
  }
  $("playbtn").onclick = () => (S.running ? stop() : start());
  document.querySelectorAll<HTMLElement>(".chap").forEach(
    (el) =>
      (el.onclick = () => {
        stop();
        idx = +el.dataset.i!;
        paintChaps();
        start();
      }),
  );

  /* controles manuales */
  $("startbtn").onclick = () => {
    takeover();
    S.view = "cockpit";
    S.cktab = "consulta";
    render();
    $("livepane").innerHTML = liveHTML(6);
  };
  $("bexp").onclick = () => {
    takeover();
    S.view = S.view === "expanded" ? "ghost" : "expanded";
    if (S.alert) {
      S.tab = "suggestions";
      S.alert = false;
    }
    render();
  };
  $("bmax").onclick = () => {
    takeover();
    S.view = "cockpit";
    render();
    $("livepane").innerHTML = liveHTML(6);
  };
  const finishConsult = () => {
    takeover();
    S.view = "done";
    render();
    $("orb").style.display = "none";
    $("vh").textContent = "Consulta cerrada.";
    $("vp").textContent = "Athos fusionó tu cuaderno con el transcript en la nota clínica estructurada.";
  };
  $("bstop").onclick = finishConsult;
  $("ckmin").onclick = () => {
    takeover();
    S.view = "ghost";
    render();
  };
  $("ckstop2").onclick = finishConsult;
  $("veil").onclick = () => {
    takeover();
    S.view = "none";
    S.t = 624;
    render();
    idx = 0;
    paintChaps();
  };
  document.querySelectorAll<HTMLElement>(".navlink[data-page]").forEach(
    (el) =>
      (el.onclick = () => {
        takeover();
        S.page = el.dataset.page!;
        render();
      }),
  );
  on($("frame"), "mousedown", (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest(".player") && !t.closest(".chrome")) takeover();
  });

  /* ── chrome de ventana ── */
  function setFull(onFull: boolean) {
    $("frame").classList.toggle("full", onFull);
    document.body.classList.toggle("locked", onFull);
    ($("lt-max") as HTMLElement).title = onFull ? "Salir de pantalla completa" : "Pantalla completa";
    render();
  }
  /* click fuera del marco = salir; nunca te quedas encerrado */
  on(window, "mousedown", (e) => {
    const t = e.target as HTMLElement;
    if ($("frame").classList.contains("full") && !t.closest(".frame")) setFull(false);
  });
  $("lt-max").onclick = () => setFull(!$("frame").classList.contains("full"));
  $("lt-min").onclick = () => {
    if ($("frame").classList.contains("full")) {
      setFull(false);
      return;
    }
    S.running ? stop() : start();
  };
  $("lt-close").onclick = () => {
    stop();
    setFull(false);
    idx = 0;
    S.view = "none";
    S.page = "pacientes";
    S.alert = false;
    S.t = 624;
    S.tab = "transcript";
    S.cktab = "consulta";
    render();
    $("livepane").innerHTML = "";
    $("cap").innerHTML = "";
    paintChaps();
    later(start, 400);
  };
  on(window, "keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape" && $("frame").classList.contains("full")) setFull(false);
  });

  /* arranque */
  const fio = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (e.isIntersecting) {
          $("frame").classList.add("in");
          later(start, 900);
          fio.disconnect();
        }
      }),
    { threshold: 0.3 },
  );
  fio.observe($("frame"));
  cleanups.push(() => fio.disconnect());
  render();

  /* ─── scroll: progreso + parallax de cabeceras ─── */
  const spot = $("spot"),
    nav = $("nav"),
    navdot = $("navdot"),
    navpod = $("navpod");
  /* la pastilla se forma temprano: si no, el titular sube por debajo de un nav
     transparente y se cruzan. 64px << los ~100px en que el hero toca la banda. */
  const NAV_AT = 64;

  /* selector de idioma */
  {
    const l = $("lang"),
      b = $("langbtn");
    b.onclick = (e) => {
      e.stopPropagation();
      const o = l.classList.toggle("open");
      b.setAttribute("aria-expanded", String(o));
    };
    on(document, "click", () => {
      l.classList.remove("open");
      b.setAttribute("aria-expanded", "false");
    });
    $("langmenu").onclick = (e) => e.stopPropagation();
    document.querySelectorAll<HTMLElement>(".lang-i").forEach(
      (i) =>
        (i.onclick = () => {
          document.querySelectorAll(".lang-i").forEach((x) => x.classList.remove("on"));
          i.classList.add("on");
          document.documentElement.lang = i.dataset.l!;
          l.classList.remove("open");
          b.setAttribute("aria-expanded", "false");
        }),
    );
    on(window, "keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") l.classList.remove("open");
    });
  }

  /* menú hamburguesa — solo móvil */
  {
    const mb = $("burgerbtn"),
      mm = $("mobilemenu");
    const closeMenu = () => {
      mm.classList.remove("open");
      mb.classList.remove("open");
      mb.setAttribute("aria-expanded", "false");
    };
    mb.onclick = (e) => {
      e.stopPropagation();
      const o = mm.classList.toggle("open");
      mb.classList.toggle("open", o);
      mb.setAttribute("aria-expanded", String(o));
    };
    mm.querySelectorAll("a").forEach((a) => on(a, "click", closeMenu));
    on(document, "click", (e) => {
      if (!(e.target as HTMLElement).closest("#mobilemenu")) closeMenu();
    });
    on(window, "keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") closeMenu();
    });
    on(window, "resize", () => {
      if (innerWidth > 1000) closeMenu();
    });
  }

  /* medimos el ancho natural de la pastilla para que max-width pueda animar */
  function measurePod() {
    navpod.classList.add("measuring");
    const w = Math.ceil(navpod.getBoundingClientRect().width);
    navpod.classList.remove("measuring");
    document.documentElement.style.setProperty("--pod-w", w + "px");
  }
  on(window, "resize", measurePod);
  if (document.fonts && document.fonts.ready)
    document.fonts.ready.then(() => {
      if (!destroyed) measurePod();
    });
  measurePod();

  const pars: Array<[HTMLElement, number]> = [...document.querySelectorAll<HTMLElement>(".sech")].map((e) => [e, -13]);
  let tick = false;
  function navFrame() {
    const y = scrollY,
      vh = innerHeight;
    spot.style.transform = `translate(-50%,-50%) translateY(${y * -0.08}px)`;
    stEl.style.transform = `translateY(${y * 0.05}px)`;
    navdot.style.transform = `rotate(${y * 0.13}deg)`;
    nav.classList.toggle("stuck", y > NAV_AT);
    document.body.classList.toggle("scrolled", y > NAV_AT);
    const max = document.documentElement.scrollHeight - vh;
    document.documentElement.style.setProperty("--prog", (max > 0 ? Math.min(y / max, 1) : 0).toFixed(4));
    for (const [el, amt] of pars) {
      const r = el.getBoundingClientRect();
      if (r.bottom < -120 || r.top > vh + 120) continue;
      el.style.transform = `translateY(${(((r.top + r.height / 2 - vh / 2) / vh) * amt).toFixed(1)}px)`;
    }
    tick = false;
  }
  on(
    window,
    "scroll",
    () => {
      if (tick) return;
      tick = true;
      requestAnimationFrame(navFrame);
    },
    { passive: true },
  );
  /* CRÍTICO: el navegador restaura el scroll al refrescar y NO dispara evento.
     Sin esta llamada, si abres la página ya scrolleada el nav se queda
     transparente y el hero se le encima. */
  navFrame();
  on(window, "load", navFrame);
  on(window, "pageshow", navFrame);

  /* cada sección revela a sus hijos; cada hijo con su propio tiempo */
  const io = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }),
    { threshold: 0.1, rootMargin: "0px 0px -6% 0px" },
  );
  document.querySelectorAll(".sec,.pil,.dem,.who,.offer,.pr-sec").forEach((el) => io.observe(el));
  cleanups.push(() => io.disconnect());

  /* ── calculadora de impacto: modal con la calc de verdad ── */
  function openCalc() {
    $("calcModal").classList.add("on");
    document.body.style.overflow = "hidden";
    tvSync();
  }
  function closeCalc() {
    $("calcModal").classList.remove("on");
    document.body.style.overflow = "";
  }
  on(window, "keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") closeCalc();
  });
  $("calc-open").onclick = (e) => {
    e.preventDefault();
    openCalc();
  };
  $("calc-backdrop").onclick = closeCalc;
  $("calc-x").onclick = closeCalc;

  /* ══════ CALCULADORA DE IMPACTO ══════ */
  function tvLift(hex: string): string {
    let r = parseInt(hex.slice(1, 3), 16) / 255,
      g = parseInt(hex.slice(3, 5), 16) / 255,
      b = parseInt(hex.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b),
      mn = Math.min(r, g, b);
    let h = 0,
      sa = 0,
      l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      sa = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    l = 0.68;
    sa = Math.min(sa, 0.52);
    const f = (n: number) => {
      const k = (n + h * 12) % 12,
        a = sa * Math.min(l, 1 - l);
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
    };
    return "#" + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("");
  }
  function tvRelift() {
    const hex = (getComputedStyle(document.documentElement).getPropertyValue("--athos") || "#8C2318").trim();
    if (/^#[0-9a-f]{6}$/i.test(hex)) document.documentElement.style.setProperty("--athos-lift", tvLift(hex));
  }
  let tvSync: () => void = () => {};
  {
    const bk = $("tv-bk");
    bk.innerHTML = "";
    for (let i = 0; i < 9; i++) {
      const el = document.createElement("i");
      const z = Math.random() * 130 + 50;
      el.style.cssText = `position:absolute;border-radius:50%;background:rgba(255,255,255,.5);width:${z}px;height:${z}px;left:${Math.random() * 100}%;top:${Math.random() * 100}%;animation:drift 18s ease-in-out infinite;animation-delay:${-Math.random() * 18}s;opacity:${Math.random() * 0.35 + 0.15}`;
      bk.appendChild(el);
    }

    const fmt = new Intl.NumberFormat("es-CO");
    const C = { vets: 2, cd: 10, tk: 120000, du: 20, doc: 8, min: 5, cap: 50, dm: 22, ad: 70, mg: 60, co: 0 };
    let step = 1;
    const num = (v: unknown) => {
      const n = parseInt(String(v).replace(/\D/g, ""), 10);
      return isNaN(n) ? 0 : n;
    };
    const fill = (el: HTMLInputElement) =>
      el.style.setProperty("--p", ((+el.value - +el.min) / (+el.max - +el.min)) * 100 + "%");
    function tween(el: HTMLElement, to: number, pre?: string, suf?: string) {
      const from = +(el.dataset.v || 0);
      el.dataset.v = String(to);
      const t0 = performance.now();
      (function f(t: number) {
        const k = Math.min((t - t0) / 420, 1),
          e = 1 - Math.pow(1 - k, 3);
        el.innerHTML = (pre || "") + fmt.format(Math.round(from + (to - from) * e)) + (suf || "");
        if (k < 1) requestAnimationFrame(f);
      })(t0);
    }
    function calc() {
      C.min = Math.min(C.min, C.doc);
      const consMes = C.vets * C.cd * C.dm,
        conAthos = (consMes * C.ad) / 100,
        minRec = conAthos * C.min;
      const h = Math.round(minRec / 60),
        j = Math.round(h / 8);
      const consAd = Math.floor((minRec * C.cap) / 100 / C.du),
        factM = consAd * C.tk,
        contrib = (factM * C.mg) / 100;
      tween($("tv-oh"), h, "", "<u>h</u>");
      $("tv-oj").textContent = fmt.format(j) + (j === 1 ? " jornada" : " jornadas");
      $("tv-oha").textContent = fmt.format(h * 12) + " horas";
      tween($("tv-oca"), consAd, "", "");
      tween($("tv-ofm"), factM, "$", "");
      $("tv-ofa").textContent = "$" + fmt.format(factM * 12) + " al año";
      tween($("tv-ohop"), Math.round((consMes * C.du) / 60), "", "&nbsp;h");
      tween($("tv-ohdoc"), Math.round((consMes * C.doc) / 60), "", "&nbsp;h");
      tween($("tv-oh2"), h, "", "&nbsp;h");
      const rt = $("tv-ort");
      if (C.co > 0) {
        rt.classList.remove("mut");
        rt.textContent = (contrib / C.co).toFixed(1) + "×";
        $("tv-oco").textContent = "costo: $" + fmt.format(C.co) + "/mes";
      } else {
        rt.classList.add("mut");
        rt.textContent = "—";
        $("tv-oco").textContent = "falta definir el precio";
      }
      $("tv-oform").innerHTML =
        "<b>" + C.vets + " vet × " + C.cd + " consultas/día × " + C.dm + " días = " + fmt.format(consMes) + " consultas/mes.</b><br>" +
        "Sobre el " + C.ad + "% en el que usarías Athos (" + fmt.format(Math.round(conAthos)) + " consultas) se recuperan " + C.min + " min cada una → <b>" + h + " h al mes</b>.<br>" +
        "Si el " + C.cap + "% de ese tiempo se reinvierte en consultas de " + C.du + " min, caben <b>" + consAd + " consultas más</b> × $" + fmt.format(C.tk) + " = <b>$" + fmt.format(factM) + "/mes</b>.<br>" +
        "Con un margen del " + C.mg + "%, la contribución es <b>$" + fmt.format(Math.round(contrib)) + "/mes</b>.";
    }
    function sync() {
      tvRelift();
      $("tv-vets").textContent = String(C.vets);
      $("tv-vcd").textContent = String(C.cd);
      ($("tv-cd") as HTMLInputElement).value = String(C.cd);
      $("tv-vdoc").innerHTML = C.doc + "<small>min</small>";
      ($("tv-doc") as HTMLInputElement).value = String(C.doc);
      $("tv-vmin").innerHTML = C.min + "<small>min</small>";
      $("tv-vmin2").textContent = String(C.min);
      $("tv-vcap").innerHTML = C.cap + "<small>%</small>";
      ($("tv-cap") as HTMLInputElement).value = String(C.cap);
      $("tv-vdm").textContent = String(C.dm);
      $("tv-vad").innerHTML = C.ad + "<small>%</small>";
      $("tv-vmg").innerHTML = C.mg + "<small>%</small>";
      document.querySelectorAll<HTMLElement>("#tv-sc .tv-sc").forEach((b) => b.classList.toggle("sel", +b.dataset.sc! === C.min));
      document.querySelectorAll<HTMLElement>("#tv-us .tv-chip").forEach((b) => b.classList.toggle("sel", +b.dataset.cap! === C.cap));
      document.querySelectorAll<HTMLInputElement>(".tv-r").forEach(fill);
      calc();
    }
    tvSync = sync;
    (
      [
        ["tv-cd", "cd"],
        ["tv-doc", "doc"],
        ["tv-cap", "cap"],
        ["tv-dm", "dm"],
        ["tv-ad", "ad"],
        ["tv-mg", "mg"],
      ] as Array<[string, "cd" | "doc" | "cap" | "dm" | "ad" | "mg"]>
    ).forEach(([id, k]) =>
      on($(id), "input", (e) => {
        C[k] = +(e.target as HTMLInputElement).value;
        sync();
      }),
    );
    (
      [
        ["tv-tk", "tk"],
        ["tv-co", "co"],
      ] as Array<[string, "tk" | "co"]>
    ).forEach(([id, k]) =>
      on($(id), "input", (e) => {
        const t = e.target as HTMLInputElement;
        const n = num(t.value);
        C[k] = n;
        t.value = n ? fmt.format(n) : "";
        calc();
      }),
    );
    document.querySelectorAll<HTMLElement>("#tv-du .tv-chip").forEach(
      (b) =>
        (b.onclick = () => {
          document.querySelectorAll("#tv-du .tv-chip").forEach((x) => x.classList.remove("sel"));
          b.classList.add("sel");
          C.du = +b.dataset.du!;
          calc();
        }),
    );
    document.querySelectorAll<HTMLElement>("#tv-sc .tv-sc").forEach(
      (b) =>
        (b.onclick = () => {
          C.min = +b.dataset.sc!;
          sync();
        }),
    );
    document.querySelectorAll<HTMLElement>("#tv-us .tv-chip").forEach(
      (b) =>
        (b.onclick = () => {
          C.cap = +b.dataset.cap!;
          sync();
        }),
    );
    document.querySelectorAll<HTMLElement>("[data-n]").forEach(
      (b) =>
        (b.onclick = () => {
          const [k, d] = b.dataset.n!.split(":");
          if (k === "vets") C.vets = Math.max(1, Math.min(12, C.vets + +d));
          if (k === "min") C.min = Math.max(1, Math.min(C.doc, C.min + +d));
          sync();
        }),
    );
    $("tv-advh").onclick = () => $("tv-adv").classList.toggle("open");
    $("tv-howh").onclick = () => $("tv-how").classList.toggle("open");
    function go(n: number) {
      step = Math.max(1, Math.min(3, n));
      document.querySelectorAll<HTMLElement>(".tv-pane").forEach((p) => p.classList.toggle("on", +p.dataset.s! === step));
      document.querySelectorAll<HTMLElement>(".tv-stp").forEach((b) => {
        const i = +b.dataset.go!;
        b.classList.toggle("on", i === step);
        b.classList.toggle("done", i < step);
      });
      $("tv-rail").style.setProperty("--rx", (step - 1) * 100 + "%");
      ($("tv-back") as HTMLButtonElement).disabled = step === 1;
      $("tv-next").innerHTML = step === 3 ? "Agendar por WhatsApp →" : "Continuar →";
      if (step === 3) calc();
      $("tv").scrollTo({ top: 0, behavior: "smooth" });
    }
    $("tv-next").onclick = () => {
      if (step < 3) {
        go(step + 1);
        return;
      }
      const name = ($("tv-ldn") as HTMLInputElement).value.trim();
      const h = +($("tv-oh").dataset.v || 0); // tween() guarda el valor final en dataset.v de inmediato
      const msg =
        `Hola${name ? `, soy ${name}` : ""}. Hice la calculadora de TU VET IA` +
        (h > 0 ? ` y me sale un ahorro de ~${h} horas al mes` : "") +
        `. Quiero agendar una demo.`;
      window.open(buildWaLink(msg), "_blank", "noopener");
      closeCalc();
    };
    $("tv-back").onclick = () => go(step - 1);
    document.querySelectorAll<HTMLElement>(".tv-stp").forEach((b) => (b.onclick = () => go(+b.dataset.go!)));
    sync();
    go(1);
  }
  tvRelift();

  /* faq */
  document.querySelectorAll<HTMLElement>(".q .qh").forEach(
    (b) =>
      (b.onclick = () => {
        const q = b.parentElement!,
          open = q.classList.contains("open");
        document.querySelectorAll(".q").forEach((x) => x.classList.remove("open"));
        if (!open) q.classList.add("open");
      }),
  );

  /* ═══ cleanup ═══ */
  return () => {
    destroyed = true;
    S.running = false;
    timeouts.forEach((t) => clearTimeout(t));
    timeouts.clear();
    cleanups.forEach((f) => f());
    document.body.classList.remove("scrolled", "locked");
    document.body.style.overflow = "";
    for (const p of ["--pod-w", "--prog", "--athos-lift"])
      document.documentElement.style.removeProperty(p);
  };
}
