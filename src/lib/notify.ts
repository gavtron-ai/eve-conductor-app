// Desktop (and optional phone) alerts for market moments that reward fast
// reaction: you got outbid, or a sell order filled. Desktop uses the HTML5
// Notification API (native toasts in Electron); phone push is an opt-in
// ntfy topic URL the user configures — the app POSTs plain text to it and the
// ntfy app on their phone delivers it.
import { useApp } from './store';
import { getType } from './typedb';
import { getSystem } from './mapdata';
import { isk, int } from './format';
import type { TrendEvent } from './trends';

/** a sell-order fill spotted by the watcher (fast path, ~5 min) */
export interface FillNotice {
  typeId: number;
  systemId: number;
  qty: number;
  price: number;
}

function sysName(id: number): string {
  return id === 0 ? 'a structure' : (getSystem(id)?.name ?? `system ${id}`);
}

function showDesktop(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
      const n = new Notification(title, { body });
      n.onclick = () => window.focus();
    } else if (Notification.permission !== 'denied') {
      void Notification.requestPermission();
    }
  } catch {
    // alerting must never break the watcher
  }
}

function pushPhone(url: string, title: string, body: string): void {
  // fire-and-forget; ntfy takes plain text with a Title header
  void fetch(url, { method: 'POST', headers: { Title: title }, body }).catch(() => {});
}

function deliver(title: string, body: string): void {
  showDesktop(title, body);
  const url = useApp.getState().alerts.ntfyUrl.trim();
  if (url) pushPhone(url, title, body);
}

/** called by the trends watcher after each tick */
export function notifyTrends(outbids: TrendEvent[], fills: FillNotice[]): void {
  const alerts = useApp.getState().alerts;
  if (alerts.outbid && outbids.length > 0) {
    if (outbids.length <= 3) {
      for (const e of outbids) {
        const item = getType(e.typeId)?.name ?? `#${e.typeId}`;
        const side = e.kind === 'outbid_buy' ? 'buy order outbid' : 'sell order undercut';
        deliver(
          `Outbid: ${item}`,
          `${side} in ${sysName(e.systemId)} — rival ${isk(e.rival ?? 0)} vs your ${isk(e.price ?? 0)}`,
        );
      }
    } else {
      deliver(
        `Outbid on ${outbids.length} orders`,
        outbids
          .slice(0, 6)
          .map((e) => `${getType(e.typeId)?.name ?? `#${e.typeId}`} (${sysName(e.systemId)})`)
          .join(', ') + (outbids.length > 6 ? ', …' : ''),
      );
    }
  }
  if (alerts.sale && fills.length > 0) {
    for (const f of fills.slice(0, 4)) {
      const item = getType(f.typeId)?.name ?? `#${f.typeId}`;
      deliver(`Sold: ${item}`, `${int(f.qty)} × ${isk(f.price)} in ${sysName(f.systemId)}`);
    }
  }
}

/** Settings "send test" button */
export function sendTestNotification(): void {
  deliver('EVE Conductor', 'Test alert — this is how outbid/sale alerts will look.');
}

/**
 * PLANETARY INDUSTRY. Unlike the market alerts, these are about preventing a
 * LOSS rather than catching an opportunity: when a planet's storage fills,
 * the extractors keep running and their output is discarded, and EVE says
 * nothing at all. This message is the only warning the player gets.
 */
export function notifyPi(states: {
  characterName: string;
  planetName: string;
  systemName: string;
  problem: string;
  advice: string;
  value: number;
  hoursToFull: number | null;
}[]): void {
  if (states.length === 0) return;

  // one message for one planet says exactly what to do; several planets get
  // a digest, because four separate toasts is how people learn to dismiss them
  if (states.length === 1) {
    const s = states[0];
    deliver(
      `PI: ${s.planetName} — ${s.characterName}`,
      `${s.advice}
${s.systemName} · ${isk(s.value)} on the planet`,
    );
    return;
  }

  const worst = states.slice(0, 4);
  const body = worst
    .map((s) => `• ${s.planetName} (${s.characterName}, ${s.systemName}) — ${s.advice}`)
    .join('\n');
  const more = states.length > worst.length ? `
…and ${states.length - worst.length} more` : '';
  const total = states.reduce((n, s) => n + s.value, 0);
  deliver(
    `PI: ${states.length} planets need you`,
    `${body}${more}
${isk(total)} sitting on them`,
  );
}
