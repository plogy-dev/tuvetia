import { describe, expect, it } from 'vitest';
import { computeAging, daysOverdue, type AgingInput } from '../aging';

const NOW = new Date('2026-07-20T10:00:00');
const daysAgo = (n: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const inDays = (n: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('daysOverdue', () => {
  it('futuro o sin fecha → 0 (no vencido)', () => {
    expect(daysOverdue(inDays(5), NOW)).toBeLessThanOrEqual(0);
    expect(daysOverdue(null, NOW)).toBe(0);
  });
  it('vencido hace 10 días → ~10', () => {
    expect(daysOverdue(daysAgo(10), NOW)).toBe(10);
  });
});

describe('computeAging', () => {
  const items: AgingInput[] = [
    { balanceCents: 100_00, dueDate: inDays(5) }, // corriente
    { balanceCents: 200_00, dueDate: daysAgo(10) }, // 1-30
    { balanceCents: 300_00, dueDate: daysAgo(45) }, // 31-60
    { balanceCents: 400_00, dueDate: daysAgo(75) }, // 61-90
    { balanceCents: 500_00, dueDate: daysAgo(120) }, // 90+
    { balanceCents: 999_00, dueDate: daysAgo(200) }, // saldo 0 se ignora abajo
  ];

  it('reparte por tramos con montos y conteos', () => {
    const a = computeAging(items.slice(0, 5), NOW);
    expect(a.corriente.amountCents).toBe(100_00);
    expect(a.d1_30.amountCents).toBe(200_00);
    expect(a.d31_60.amountCents).toBe(300_00);
    expect(a.d61_90.amountCents).toBe(400_00);
    expect(a.d90plus.amountCents).toBe(500_00);
    expect(a.d90plus.count).toBe(1);
  });

  it('total y total vencido', () => {
    const a = computeAging(items.slice(0, 5), NOW);
    expect(a.totalCents).toBe(1500_00);
    expect(a.totalOverdueCents).toBe(1400_00); // todo menos el corriente
  });

  it('ignora saldos ≤ 0', () => {
    const a = computeAging([{ balanceCents: 0, dueDate: daysAgo(50) }], NOW);
    expect(a.totalCents).toBe(0);
    expect(a.d31_60.count).toBe(0);
  });

  it('sin fecha de vencimiento cuenta como corriente', () => {
    const a = computeAging([{ balanceCents: 700_00, dueDate: null }], NOW);
    expect(a.corriente.amountCents).toBe(700_00);
    expect(a.totalOverdueCents).toBe(0);
  });
});
