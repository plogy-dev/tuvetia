import { describe, expect, it } from "vitest";
import { captureRowsToTable, type CaptureRow } from "@/lib/facturacion/import/capture";
import { proposeMapping, validateRows } from "@/lib/facturacion/import/parse";

const empty: CaptureRow = {
  nombre: null,
  categoria: null,
  tipo: null,
  cantidad: null,
  costo: null,
  precio: null,
  iva: null,
  unidad: null,
  minimo: null,
  lote: null,
  vencimiento: null,
  proveedor: null,
  ubicacion: null,
  sku: null,
  duracion: null,
};

describe("captureRowsToTable", () => {
  it("incluye solo columnas con valor y descarta filas vacías", () => {
    const { columns, rows } = captureRowsToTable([
      { ...empty, nombre: "Amoxicilina 250mg", precio: "45.000", cantidad: "10" },
      { ...empty }, // fila vacía → fuera
      { ...empty, nombre: "Concentrado 2kg", precio: "52.000" },
    ]);
    expect(columns).toEqual(["Nombre", "Existencia", "Precio"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]["Nombre"]).toBe("Amoxicilina 250mg");
    expect(rows[1]["Existencia"]).toBe(""); // columna presente, celda vacía
  });

  it("recorta espacios y trata strings en blanco como vacíos", () => {
    const { columns, rows } = captureRowsToTable([
      { ...empty, nombre: "  Jeringa 3ml  ", iva: "   " },
    ]);
    expect(columns).toEqual(["Nombre"]);
    expect(rows[0]["Nombre"]).toBe("Jeringa 3ml");
  });

  it("pipeline completo: captura → proposeMapping → validateRows", () => {
    const { columns, rows } = captureRowsToTable([
      {
        ...empty,
        nombre: "Amoxicilina 250mg",
        precio: "45.000",
        cantidad: "10",
        iva: "0",
        categoria: "Medicamentos",
        tipo: "medicamento",
        unidad: "tableta",
      },
    ]);
    const mapping = proposeMapping(columns);
    expect(mapping["Nombre"]).toBe("name");
    expect(mapping["Precio"]).toBe("pricePesos");
    expect(mapping["Existencia"]).toBe("initialQty");
    expect(mapping["IVA"]).toBe("taxRate");
    expect(mapping["Categoría"]).toBe("category");
    expect(mapping["Tipo"]).toBe("kind");
    expect(mapping["Unidad"]).toBe("useUnit");

    const { validated, report } = validateRows(rows, mapping, new Set());
    expect(report.ready).toBe(1);
    expect(validated[0].parsed?.name).toBe("Amoxicilina 250mg");
    expect(validated[0].parsed?.priceCents).toBe(4500000);
    expect(validated[0].parsed?.initialQty).toBe(10);
    expect(validated[0].parsed?.kind).toBe("MEDICAMENTO");
    expect(validated[0].parsed?.category).toBe("Medicamentos");
  });

  it("pipeline servicios: duración mapeada y validada con preset", () => {
    const { columns, rows } = captureRowsToTable([
      {
        ...empty,
        nombre: "Consulta general",
        precio: "60.000",
        duracion: "30",
        categoria: "Consultas",
      },
    ]);
    const mapping = proposeMapping(columns);
    expect(mapping["Duración"]).toBe("durationMinutes");

    const { validated, report } = validateRows(rows, mapping, new Set(), {
      preset: "servicios",
    });
    expect(report.ready).toBe(1); // sin aviso de unidad: preset servicios
    expect(validated[0].parsed?.kind).toBe("SERVICIO");
    expect(validated[0].parsed?.useUnit).toBe("servicio");
    expect(validated[0].parsed?.initialQty).toBe(0);
    expect(validated[0].parsed?.durationMinutes).toBe(30);
  });
});
