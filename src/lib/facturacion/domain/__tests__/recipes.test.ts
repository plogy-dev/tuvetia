import { describe, expect, it } from 'vitest';
import {
  computeRecipeConsumption,
  matchComponentName,
  normalizeForMatch,
  resolveDraft,
  type MatchCandidate,
} from '../recipes';

const CAT: MatchCandidate[] = [
  { id: 'sut', name: 'Sutura reabsorbible 3-0' },
  { id: 'gasa', name: 'Gasa estéril' },
  { id: 'anes', name: 'Anestésico inyectable (ketamina)' },
  { id: 'guante', name: 'Guantes quirúrgicos' },
];

describe('normalizeForMatch', () => {
  it('quita acentos, signos y colapsa espacios', () => {
    expect(normalizeForMatch('Gasa  estéril!')).toBe('gasa esteril');
    expect(normalizeForMatch('Anestésico (Ketamina)')).toBe('anestesico ketamina');
  });
});

describe('matchComponentName', () => {
  it('match exacto → score 1', () => {
    expect(matchComponentName('Gasa estéril', CAT)).toEqual({ id: 'gasa', score: 1 });
  });

  it('uno contiene al otro → score alto', () => {
    const m = matchComponentName('sutura', CAT);
    expect(m?.id).toBe('sut');
    expect(m!.score).toBeGreaterThanOrEqual(0.8);
  });

  it('solapamiento de tokens (Jaccard ≥ umbral)', () => {
    // {anestesico, ketamina} vs {anestesico, inyectable, ketamina} → 2/3 ≈ 0.67
    const m = matchComponentName('anestesico ketamina', CAT);
    expect(m?.id).toBe('anes');
  });

  it('sin coincidencia razonable → null (mejor sin asignar)', () => {
    expect(matchComponentName('concentrado para perro', CAT)).toBeNull();
  });

  it('nombre vacío → null', () => {
    expect(matchComponentName('   ', CAT)).toBeNull();
  });
});

describe('computeRecipeConsumption (descuento al emitir)', () => {
  const recipes = new Map([
    ['esteril', [{ component_id: 'gasa', qty: 2 }, { component_id: 'sut', qty: 1 }, { component_id: 'servicio_no_stock', qty: 5 }]],
    ['consulta', [{ component_id: 'gasa', qty: 1 }]],
  ]);
  const tracked = (id: string) => id !== 'servicio_no_stock';

  it('multiplica receta × unidades del servicio', () => {
    const out = computeRecipeConsumption([{ serviceId: 'esteril', qty: 3 }], recipes, tracked);
    expect(out.find((c) => c.componentId === 'gasa')?.useQty).toBe(6); // 2×3
    expect(out.find((c) => c.componentId === 'sut')?.useQty).toBe(3); // 1×3
  });

  it('suma un componente repetido entre servicios', () => {
    const out = computeRecipeConsumption(
      [{ serviceId: 'esteril', qty: 1 }, { serviceId: 'consulta', qty: 2 }],
      recipes,
      tracked,
    );
    // gasa: 2×1 + 1×2 = 4
    expect(out.find((c) => c.componentId === 'gasa')?.useQty).toBe(4);
  });

  it('ignora componentes sin control de stock', () => {
    const out = computeRecipeConsumption([{ serviceId: 'esteril', qty: 1 }], recipes, tracked);
    expect(out.some((c) => c.componentId === 'servicio_no_stock')).toBe(false);
  });

  it('servicio sin receta → vacío', () => {
    expect(computeRecipeConsumption([{ serviceId: 'x', qty: 9 }], recipes, tracked)).toEqual([]);
  });
});

describe('resolveDraft', () => {
  it('resuelve cada componente y marca los no encontrados', () => {
    const resolved = resolveDraft(
      {
        serviceName: 'Esterilización',
        components: [
          { name: 'gasa esteril', qty: 2 },
          { name: 'sutura 3-0', qty: 1 },
          { name: 'algo raro no existe', qty: 3 },
        ],
      },
      CAT,
    );
    expect(resolved[0].matchId).toBe('gasa');
    expect(resolved[1].matchId).toBe('sut');
    expect(resolved[2].matchId).toBeNull();
    expect(resolved[2].qty).toBe(3); // conserva la cantidad aunque no matchee
  });
});
