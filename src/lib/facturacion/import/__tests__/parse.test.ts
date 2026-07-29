import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseInventoryFile,
  proposeMapping,
  toNumber,
  validateRows,
  type ImportMapping,
} from "@/lib/facturacion/import/parse";

describe("toNumber (formatos colombianos)", () => {
  it("parsea miles con punto y decimales con coma", () => {
    expect(toNumber("1.234,56")).toBe(1234.56);
    expect(toNumber("85.000")).toBe(85000);
    expect(toNumber("$ 85.000")).toBe(85000);
  });
  it("parsea formato anglosajón", () => {
    expect(toNumber("1234.56")).toBe(1234.56);
    expect(toNumber("1,234.56")).toBe(1234.56);
  });
  it("devuelve null en basura", () => {
    expect(toNumber("")).toBeNull();
    expect(toNumber("abc")).toBeNull();
  });
  it("parsea millones con puntos de miles y enteros planos", () => {
    expect(toNumber("1.234.567")).toBe(1234567);
    expect(toNumber("12500")).toBe(12500);
    expect(toNumber("12.5")).toBe(12.5); // punto + 1-2 dígitos = decimal
    expect(toNumber("$1.250.000")).toBe(1250000);
  });
});

describe("proposeMapping (heurística de columnas)", () => {
  it("mapea encabezados típicos de planilla veterinaria", () => {
    const m = proposeMapping(["Producto", "Precio venta", "IVA", "Existencia", "Vencimiento"]);
    expect(m["Producto"]).toBe("name");
    expect(m["Precio venta"]).toBe("pricePesos");
    expect(m["IVA"]).toBe("taxRate");
    expect(m["Existencia"]).toBe("initialQty");
    expect(m["Vencimiento"]).toBe("expiresAt");
  });
  it("ignora acentos y mayúsculas, y no asigna dos columnas al mismo campo", () => {
    const m = proposeMapping(["Descripción", "Artículo"]);
    expect(m["Descripción"]).toBe("name");
    expect(m["Artículo"]).toBe(""); // name ya usado
  });
  it("mapea encabezados largos reales (nombre producto, precio de venta, categoría)", () => {
    const m = proposeMapping([
      "NOMBRE PRODUCTO",
      "Precio de Venta",
      "Categoría",
      "Costo unitario",
      "Stock mínimo",
      "Proveedor",
      "Columna rara",
    ]);
    expect(m["NOMBRE PRODUCTO"]).toBe("name");
    expect(m["Precio de Venta"]).toBe("pricePesos");
    expect(m["Categoría"]).toBe("category");
    expect(m["Costo unitario"]).toBe("costPesos");
    expect(m["Stock mínimo"]).toBe("minStock");
    expect(m["Proveedor"]).toBe("supplier");
    expect(m["Columna rara"]).toBe("");
  });
});

describe("validateRows", () => {
  const mapping: ImportMapping = {
    Nombre: "name",
    Precio: "pricePesos",
    IVA: "taxRate",
    Cantidad: "initialQty",
    Tipo: "kind",
  };

  it("valida una fila OK y deriva GRAVADO/EXCLUIDO según tarifa", () => {
    const { validated, report } = validateRows(
      [
        { Nombre: "Concentrado", Precio: "52.000", IVA: "19", Cantidad: "10", Tipo: "producto" },
        { Nombre: "Amoxicilina", Precio: "3.500", IVA: "0", Cantidad: "100", Tipo: "medicamento" },
      ],
      mapping,
      new Set(),
    );
    expect(report.ready).toBe(0); // ambas AVISO por unidad asumida
    expect(report.withWarnings).toBe(2);
    expect(validated[0].parsed?.taxStatus).toBe("GRAVADO");
    expect(validated[0].parsed?.priceCents).toBe(5200000);
    expect(validated[1].parsed?.taxStatus).toBe("EXCLUIDO");
    expect(validated[1].parsed?.kind).toBe("MEDICAMENTO");
  });

  it("marca ERROR sin nombre o con IVA no soportado", () => {
    const { validated, report } = validateRows(
      [
        { Nombre: "", Precio: "1000", IVA: "19", Cantidad: "1", Tipo: "" },
        { Nombre: "X", Precio: "1000", IVA: "16", Cantidad: "1", Tipo: "" },
      ],
      mapping,
      new Set(),
    );
    expect(report.errors).toBe(2);
    expect(validated[1].messages.join(" ")).toMatch(/IVA inválido/);
  });

  it("preset servicios: fuerza SERVICIO, ignora existencia y no avisa por unidad", () => {
    const { validated, report } = validateRows(
      [
        { Nombre: "Consulta general", Precio: "60.000", IVA: "", Cantidad: "99", Tipo: "producto" },
      ],
      mapping,
      new Set(),
      { preset: "servicios" },
    );
    expect(report.ready).toBe(1);
    expect(validated[0].parsed?.kind).toBe("SERVICIO"); // aunque el archivo diga producto
    expect(validated[0].parsed?.initialQty).toBe(0); // la cantidad se ignora
    expect(validated[0].parsed?.useUnit).toBe("servicio");
  });

  it("parsea duración en minutos y avisa si no la reconoce", () => {
    const m: ImportMapping = { Nombre: "name", Precio: "pricePesos", Duracion: "durationMinutes" };
    const { validated } = validateRows(
      [
        { Nombre: "Consulta", Precio: "60.000", Duracion: "45 min" },
        { Nombre: "Cirugía", Precio: "500.000", Duracion: "una hora" },
      ],
      m,
      new Set(),
      { preset: "servicios" },
    );
    expect(validated[0].parsed?.durationMinutes).toBe(45);
    expect(validated[1].status).toBe("AVISO");
    expect(validated[1].parsed?.durationMinutes).toBeNull();
  });

  it("las plantillas publicadas pasan enteras por el pipeline sin errores", () => {
    // plantilla-inventario.csv → preset productos
    const inv = parseInventoryFile(
      readFileSync(resolve(process.cwd(), "public/plantillas/plantilla-inventario.csv")),
      "plantilla-inventario.csv",
    );
    const invMapping = proposeMapping(inv.columns);
    expect(invMapping["Nombre"]).toBe("name");
    expect(invMapping["Categoria"]).toBe("category");
    expect(invMapping["Proveedor"]).toBe("supplier");
    const invResult = validateRows(inv.rows, invMapping, new Set());
    expect(invResult.report.errors).toBe(0);
    expect(invResult.report.duplicates).toBe(0);
    expect(invResult.report.total).toBeGreaterThan(0);

    // plantilla-servicios.csv → preset servicios
    const srv = parseInventoryFile(
      readFileSync(resolve(process.cwd(), "public/plantillas/plantilla-servicios.csv")),
      "plantilla-servicios.csv",
    );
    const srvMapping = proposeMapping(srv.columns);
    expect(srvMapping["Duracion"]).toBe("durationMinutes");
    const srvResult = validateRows(srv.rows, srvMapping, new Set(), { preset: "servicios" });
    expect(srvResult.report.errors).toBe(0);
    expect(srvResult.validated.every((r) => r.parsed?.kind === "SERVICIO")).toBe(true);
    expect(srvResult.validated[0].parsed?.durationMinutes).toBe(30);
  });

  it("marca DUPLICADO contra existentes y dentro del archivo", () => {
    const { report } = validateRows(
      [
        { Nombre: "Jeringa 3 ml", Precio: "800", IVA: "19", Cantidad: "5", Tipo: "insumo" },
        { Nombre: "jeringa 3 ML", Precio: "800", IVA: "19", Cantidad: "5", Tipo: "insumo" },
      ],
      mapping,
      new Set(["jeringa 3 ml"]),
    );
    expect(report.duplicates).toBe(2);
  });
});
