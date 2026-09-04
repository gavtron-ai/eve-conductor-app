import { useRef, useState } from 'react';
import { searchTypes } from '../lib/typedb';
import { useApp } from '../lib/store';
import { m3 } from '../lib/format';
import type { ItemType } from '../lib/types';

export default function SearchBar() {
  const select = useApp((s) => s.select);
  const setView = useApp((s) => s.setView);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ItemType[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function update(q: string) {
    setQuery(q);
    const r = searchTypes(q);
    setResults(r);
    setActive(0);
    setOpen(r.length > 0);
  }

  function pick(it: ItemType) {
    select(it.id);
    setView('explorer'); // searching an item always lands on its detail view
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      pick(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="search">
      <input
        ref={inputRef}
        type="text"
        placeholder="Search any market item… (e.g. PLEX, Tritanium, Hulk)"
        value={query}
        onChange={(e) => update(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(results.length > 0)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        spellCheck={false}
      />
      {open && (
        <div className="results">
          {results.map((it, i) => (
            <button
              key={it.id}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(it)}
              onMouseEnter={() => setActive(i)}
            >
              <span>{it.name}</span>
              <span className="vol">{m3(it.volume)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
