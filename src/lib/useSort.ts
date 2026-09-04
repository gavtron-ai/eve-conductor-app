import { useMemo, useState } from 'react';

export interface SortState<K extends string> {
  key: K | null;
  dir: 'asc' | 'desc';
}

/**
 * Column sorting for tables. `accessors` maps a column key to a sortable value;
 * clicking a header toggles desc → asc; null/NaN values always sink to the bottom.
 */
export function useSort<T, K extends string>(
  rows: T[],
  accessors: Record<K, (row: T) => number | string | null>,
  initial?: SortState<K>,
) {
  const [sort, setSort] = useState<SortState<K>>(initial ?? { key: null, dir: 'desc' });

  function clickHeader(key: K) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' },
    );
  }

  const sorted = useMemo(() => {
    if (!sort.key) return rows;
    const acc = accessors[sort.key];
    const mul = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = acc(a);
      const vb = acc(b);
      const aBad = va === null || (typeof va === 'number' && !Number.isFinite(va));
      const bBad = vb === null || (typeof vb === 'number' && !Number.isFinite(vb));
      if (aBad && bBad) return 0;
      if (aBad) return 1;
      if (bBad) return -1;
      if (typeof va === 'string' || typeof vb === 'string') {
        return mul * String(va).localeCompare(String(vb));
      }
      return mul * ((va as number) - (vb as number));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  const indicator = (key: K) => (sort.key === key ? (sort.dir === 'desc' ? ' ▾' : ' ▴') : '');

  return { sorted, sort, clickHeader, indicator };
}
