/* Chrome de las sub-páginas (/producto, /seguridad): nav flotante,
   barra de progreso, reveal por sección, menú móvil, selector de
   idioma y acordeón del FAQ. Réplica mínima del engine de la landing
   — sin demo, sin calculadora, sin parallax de fondo. Devuelve un
   cleanup que des-registra todos los listeners y observers. */
export function initSubpage(): () => void {
  const cleanups: Array<() => void> = [];
  let destroyed = false;
  const on = (
    target: EventTarget,
    type: string,
    fn: EventListenerOrEventListenerObject,
    opts?: AddEventListenerOptions,
  ) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };
  const $ = (id: string) => document.getElementById(id);

  const nav = $("nav"),
    navpod = $("navpod");
  const NAV_AT = 64;

  /* medimos el ancho natural de la pastilla para que max-width pueda animar */
  function measurePod() {
    if (!navpod) return;
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

  /* nav pegado + barra de progreso */
  let tick = false;
  function frame() {
    const y = scrollY;
    nav?.classList.toggle("stuck", y > NAV_AT);
    document.body.classList.toggle("scrolled", y > NAV_AT);
    const max = document.documentElement.scrollHeight - innerHeight;
    document.documentElement.style.setProperty("--prog", (max > 0 ? Math.min(y / max, 1) : 0).toFixed(4));
    tick = false;
  }
  on(
    window,
    "scroll",
    () => {
      if (tick) return;
      tick = true;
      requestAnimationFrame(frame);
    },
    { passive: true },
  );
  /* el navegador restaura el scroll al refrescar sin disparar evento */
  frame();
  on(window, "load", frame);
  on(window, "pageshow", frame);

  /* El selector de idioma se fue con su markup (`components/landing/Nav.tsx`): no había i18n
     detrás. Acá el bloque era inofensivo —iba tras un `if (l && b && m)`— pero código muerto que
     apunta a un id que ya no existe sólo confunde al que lo lea después. */

  /* menú hamburguesa — solo móvil */
  {
    const mb = $("burgerbtn"),
      mm = $("mobilemenu");
    if (mb && mm) {
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
  }

  /* cada sección revela a sus hijos */
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
  document.querySelectorAll("[data-io]").forEach((el) => io.observe(el));
  cleanups.push(() => io.disconnect());

  /* acordeón del FAQ (solo /seguridad) */
  document.querySelectorAll<HTMLElement>(".qa-item").forEach((item) => {
    const q = item.querySelector<HTMLElement>(".qa-q"),
      a = item.querySelector<HTMLElement>(".qa-a");
    if (!q || !a) return;
    q.setAttribute("aria-expanded", "false");
    q.onclick = () => {
      const open = item.classList.contains("open");
      document.querySelectorAll<HTMLElement>(".qa-item").forEach((o) => {
        o.classList.remove("open");
        const oa = o.querySelector<HTMLElement>(".qa-a");
        if (oa) oa.style.maxHeight = "";
        o.querySelector(".qa-q")?.setAttribute("aria-expanded", "false");
      });
      if (!open) {
        item.classList.add("open");
        a.style.maxHeight = a.scrollHeight + "px";
        q.setAttribute("aria-expanded", "true");
      }
    };
  });

  return () => {
    destroyed = true;
    cleanups.forEach((c) => c());
  };
}
