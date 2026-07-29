// Recetas de consumo: emparejar los nombres que la IA extrae de una receta subida
// (imagen/Excel/texto) con los ítems del catálogo. Puro y determinista: la IA
// propone nombres, esta función sugiere el ítem del catálogo, y el vet confirma.
// Nunca decide sola: devuelve la mejor sugerencia con un puntaje; sin buen match
// deja el componente sin asignar para que la persona elija.

export interface MatchCandidate {
  id: string;
  name: string;
}

export interface NameMatch {
  id: string;
  score: number; // 0..1
}

/** Normaliza para comparar: minúsculas, sin acentos ni signos, espacios simples. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mejor coincidencia de `name` entre `candidates`. Exacto → 1; uno contiene al
 * otro → 0.8; si no, solapamiento de tokens (Jaccard). Devuelve null si el mejor
 * puntaje no llega a `threshold` (por defecto 0.5): mejor sin asignar que mal.
 */
export function matchComponentName(
  name: string,
  candidates: MatchCandidate[],
  threshold = 0.5,
): NameMatch | null {
  const target = normalizeForMatch(name);
  if (!target) return null;

  let best: NameMatch | null = null;
  for (const c of candidates) {
    const cand = normalizeForMatch(c.name);
    if (!cand) continue;
    let score: number;
    if (cand === target) {
      score = 1;
    } else if (cand.includes(target) || target.includes(cand)) {
      score = 0.8;
    } else {
      const a = new Set(target.split(' '));
      const b = new Set(cand.split(' '));
      const inter = [...a].filter((x) => b.has(x)).length;
      const union = new Set([...a, ...b]).size;
      score = union ? inter / union : 0;
    }
    if (!best || score > best.score) best = { id: c.id, score };
  }
  return best && best.score >= threshold ? best : null;
}

// ─── Borrador de receta (lo que la IA propone; el vet confirma) ──────────────

export interface DraftComponent {
  /** Nombre tal como aparece en la receta subida. */
  name: string;
  /** Cantidad por unidad de servicio. */
  qty: number;
  /** Unidad declarada en la receta (referencial; la real es la del ítem). */
  unit?: string | null;
}

export interface RecipeDraft {
  /** Nombre del servicio si la receta lo menciona (referencial). */
  serviceName?: string | null;
  components: DraftComponent[];
}

export interface ResolvedComponent extends DraftComponent {
  /** Ítem del catálogo sugerido (o null si no hubo match confiable). */
  matchId: string | null;
  score: number;
}

/** Resuelve cada componente del borrador contra el catálogo (sugerencias). */
export function resolveDraft(draft: RecipeDraft, candidates: MatchCandidate[]): ResolvedComponent[] {
  return draft.components.map((c) => {
    const m = matchComponentName(c.name, candidates);
    return { ...c, matchId: m?.id ?? null, score: m?.score ?? 0 };
  });
}

// ─── Descuento de inventario por receta (usado al emitir) ────────────────────

export interface ServiceLineQty {
  serviceId: string;
  qty: number;
}

export interface RecipeConsumption {
  componentId: string;
  /** Cantidad total a descontar (en use_unit del componente). */
  useQty: number;
}

/**
 * Cantidad a consumir de cada componente al facturar servicios con receta:
 * receta.qty × unidades del servicio en la factura, sumando si un componente se
 * repite entre servicios. Solo incluye componentes que controlan stock
 * (`isTracked`). Puro y determinista.
 */
export function computeRecipeConsumption(
  serviceLines: ServiceLineQty[],
  recipesByService: Map<string, { component_id: string; qty: number }[]>,
  isTracked: (componentId: string) => boolean,
): RecipeConsumption[] {
  const totals = new Map<string, number>();
  for (const line of serviceLines) {
    for (const comp of recipesByService.get(line.serviceId) ?? []) {
      if (!isTracked(comp.component_id)) continue;
      totals.set(comp.component_id, (totals.get(comp.component_id) ?? 0) + comp.qty * line.qty);
    }
  }
  return [...totals.entries()].map(([componentId, useQty]) => ({
    componentId,
    useQty: Math.round(useQty * 1e6) / 1e6,
  }));
}
