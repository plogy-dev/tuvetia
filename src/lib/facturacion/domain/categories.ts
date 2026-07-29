// Categorías de catálogo: lógica pura. El SET predeterminado es una semilla
// editable (no un enum): al activar el módulo se crean estas categorías, pero el
// vet las renombra, archiva, reordena o agrega las suyas. «Sin categoría» no va
// acá: la crea el backfill/seed como `is_default` y no se archiva.

export const DEFAULT_VET_CATEGORIES: string[] = [
  'Consultas y procedimientos',
  'Cirugía',
  'Vacunas',
  'Medicamentos',
  'Antiparasitarios',
  'Alimento y dietas',
  'Accesorios',
  'Higiene y estética',
  'Laboratorio e imagenología',
  'Insumos médicos',
  'Hospitalización',
];
