// One global tooltip layer for every [data-tip] element. The old CSS
// ::after tooltips were anchored to their trigger (left: 0) — near the
// right window edge they clipped off-screen and were unreadable, and any
// overflow container could cut them. This layer is position: fixed on
// <body>, clamped into the viewport, flips above the anchor when there's
// no room below, and sits above everything.

let layer: HTMLDivElement | null = null;
let anchor: Element | null = null;

function ensureLayer(): HTMLDivElement {
  if (layer) return layer;
  layer = document.createElement('div');
  layer.className = 'tip-layer';
  document.body.appendChild(layer);
  return layer;
}

function show(el: Element): void {
  const text = el.getAttribute('data-tip');
  if (!text) return;
  anchor = el;
  const l = ensureLayer();
  l.textContent = text;
  // render invisibly first so we can measure the real size
  l.style.visibility = 'hidden';
  l.style.display = 'block';
  l.style.left = '0px';
  l.style.top = '0px';
  const r = el.getBoundingClientRect();
  // layout viewport — window.innerWidth reads 0 in some embedded contexts
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  const tw = l.offsetWidth;
  const th = l.offsetHeight;
  const M = 8; // viewport margin
  const left = Math.max(M, Math.min(r.left, vw - tw - M));
  // below the anchor by default; flip above when it would leave the viewport
  let top = r.bottom + 7;
  if (top + th > vh - M) top = r.top - th - 7;
  if (top < M) top = Math.max(M, Math.min(r.bottom + 7, vh - th - M));
  l.style.left = `${left}px`;
  l.style.top = `${top}px`;
  l.style.visibility = 'visible';
}

function hide(): void {
  anchor = null;
  if (layer) layer.style.display = 'none';
}

/** install the delegated listeners once (called from App) */
export function initTooltips(): void {
  if (document.body.dataset.tipLayer) return;
  document.body.dataset.tipLayer = '1';
  document.addEventListener('mouseover', (e) => {
    const el = (e.target as Element | null)?.closest?.('[data-tip]') ?? null;
    if (el === anchor) return;
    if (el) show(el);
    else if (anchor) hide();
  });
  // anchors disappear on re-render/scroll — never leave a stale tooltip up
  document.addEventListener('scroll', hide, true);
  document.addEventListener('click', () => {
    if (anchor && !document.contains(anchor)) hide();
  });
}
