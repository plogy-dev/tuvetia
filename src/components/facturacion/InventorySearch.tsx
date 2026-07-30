'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';

const TYPES = [
  { value: '', label: 'Todos los tipos' },
  { value: 'SERVICIO', label: 'Servicios' },
  { value: 'PRODUCTO', label: 'Productos' },
  { value: 'MEDICAMENTO', label: 'Medicamentos' },
  { value: 'INSUMO', label: 'Insumos' },
];

/** Buscador (nombre/SKU/código) + filtro por tipo; sincroniza en la URL. */
export function InventorySearch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(params.get('q') ?? '');

  function push(next: URLSearchParams) {
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    push(next);
  }

  const inputCls =
    'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus:border-brand focus:outline-none';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setParam('q', q.trim());
        }}
        className="relative flex-1 min-w-[12rem]"
      >
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-faint" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => setParam('q', q.trim())}
          placeholder="Buscar por nombre, SKU o código…"
          className={`${inputCls} w-full pl-8`}
        />
      </form>
      <select
        value={params.get('type') ?? ''}
        onChange={(e) => setParam('type', e.target.value)}
        className={inputCls}
      >
        {TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </div>
  );
}
