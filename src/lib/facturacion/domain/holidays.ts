// Festivos colombianos calculados determinísticamente (Ley 51 de 1983, "Ley Emiliani").
// Sin dependencia del reloj del sistema: recibe el año y devuelve fechas.

/** Domingo de Pascua (algoritmo gregoriano anónimo / Meeus-Jones-Butcher). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=marzo, 4=abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

/** Traslada al lunes siguiente salvo que ya caiga lunes (regla Emiliani). */
function nextMondayIfNotMonday(d: Date): Date {
  const dow = d.getDay(); // 0=domingo, 1=lunes
  if (dow === 1) return d;
  const delta = (8 - dow) % 7 || 7;
  return addDays(d, delta);
}

/** Festivos de Colombia para un año, como Date locales a medianoche. */
export function colombianHolidays(year: number): Date[] {
  const fixed = [
    new Date(year, 0, 1), // Año Nuevo
    new Date(year, 4, 1), // Día del Trabajo
    new Date(year, 6, 20), // Independencia
    new Date(year, 7, 7), // Batalla de Boyacá
    new Date(year, 11, 8), // Inmaculada Concepción
    new Date(year, 11, 25), // Navidad
  ];
  const emiliani = [
    new Date(year, 0, 6), // Reyes Magos
    new Date(year, 2, 19), // San José
    new Date(year, 5, 29), // San Pedro y San Pablo
    new Date(year, 7, 15), // Asunción de la Virgen
    new Date(year, 9, 12), // Día de la Raza
    new Date(year, 10, 1), // Todos los Santos
    new Date(year, 10, 11), // Independencia de Cartagena
  ].map(nextMondayIfNotMonday);

  const easter = easterSunday(year);
  const easterBased = [
    addDays(easter, -3), // Jueves Santo (no se traslada)
    addDays(easter, -2), // Viernes Santo (no se traslada)
    nextMondayIfNotMonday(addDays(easter, 39)), // Ascensión → lunes
    nextMondayIfNotMonday(addDays(easter, 60)), // Corpus Christi → lunes
    nextMondayIfNotMonday(addDays(easter, 68)), // Sagrado Corazón → lunes
  ];

  return [...fixed, ...emiliani, ...easterBased].sort((a, b) => a.getTime() - b.getTime());
}

export function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Set "YYYY-MM-DD" de festivos para un rango de años (para inyectar al motor). */
export function holidaySet(years: number[]): Set<string> {
  const set = new Set<string>();
  for (const y of years) for (const d of colombianHolidays(y)) set.add(toYMD(d));
  return set;
}
