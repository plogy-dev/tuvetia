import { describe, expect, it } from "vitest";
import { colombianHolidays, easterSunday, holidaySet, toYMD } from "@/lib/facturacion/domain/holidays";

describe("holidays: Pascua", () => {
  it("calcula el Domingo de Pascua de años conocidos", () => {
    expect(toYMD(easterSunday(2026))).toBe("2026-04-05");
    expect(toYMD(easterSunday(2025))).toBe("2025-04-20");
    expect(toYMD(easterSunday(2027))).toBe("2027-03-28");
  });
});

describe("holidays: festivos colombianos 2026", () => {
  const set = holidaySet([2026]);

  it("festivos fijos no se trasladan", () => {
    expect(set.has("2026-01-01")).toBe(true); // Año Nuevo
    expect(set.has("2026-07-20")).toBe(true); // Independencia (lunes)
    expect(set.has("2026-12-25")).toBe(true); // Navidad
  });

  it("Reyes Magos 2026 (mar 6-ene) se traslada al lunes 12-ene", () => {
    expect(set.has("2026-01-06")).toBe(false);
    expect(set.has("2026-01-12")).toBe(true);
  });

  it("San José 2026 (jue 19-mar) se traslada al lunes 23-mar", () => {
    expect(set.has("2026-03-19")).toBe(false);
    expect(set.has("2026-03-23")).toBe(true);
  });

  it("Semana Santa 2026: jueves y viernes santos no se trasladan", () => {
    expect(set.has("2026-04-02")).toBe(true);
    expect(set.has("2026-04-03")).toBe(true);
  });

  it("Ascensión, Corpus y Sagrado Corazón 2026 caen lunes", () => {
    expect(set.has("2026-05-18")).toBe(true);
    expect(set.has("2026-06-08")).toBe(true);
    expect(set.has("2026-06-15")).toBe(true);
  });

  it("son 18 festivos", () => {
    expect(colombianHolidays(2026)).toHaveLength(18);
  });
});
