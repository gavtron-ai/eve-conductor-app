"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coveredMs = exports.DIFFS_PER_DAY = exports.RADAR_INTERVAL_MS = void 0;
exports.radarRegions = radarRegions;
exports.diffSnapshots = diffSnapshots;
exports.loadRadarCoverage = loadRadarCoverage;
exports.normalizedRates = normalizedRates;
exports.runRadarTick = runRadarTick;
exports.restoreRadarWip = restoreRadarWip;
exports.loadRadarSummary = loadRadarSummary;
exports.itemTradeFlow = itemTradeFlow;
exports.itemTradeFlows = itemTradeFlows;
exports.itemFlowStatsMany = itemFlowStatsMany;
exports.itemFlowStats = itemFlowStats;
// FULL-MARKET RADAR: every item, BOTH sides of the book, in the duty hubs'
// regions — measured directly, not inferred. Every ~30 min the entire
// regional order book is snapshotted; diffing consecutive snapshots yields,
// per (region, item, side):
//   - reprices (same order id, price changed)      → war tempo
//   - fills (same order id, volume dropped)        → real trade flow, both sides
//   - new / vanished orders                        → competitor churn
//   - distinct competitor counts                   → crowding, measured live
// Daily rollups append to radar-YYYY-MM.ndjson in the Do-Not-Delete folder;
// radar-summary.json keeps a 31-day ring per item plus ALL-TIME hour-of-day
// histograms (the user wants full history, daily/weekly/monthly views, and
// no reliance on ESI's day-old history endpoint).
// The team's own orders are excluded from reprice/competitor counts
// (self-echo) but their fills count in market flow, like everywhere else.
const constants_1 = require("./constants");
const esiRate_1 = require("./esiRate");
const auth_1 = require("./auth");
const ledger_1 = require("./ledger");
/** the bulk market sweep: the FIRST traffic to yield when the shared ESI
 * error budget tightens, so it can never crowd out the overlay or the
 * screen the user is actually looking at (see esiRate.ts lanes). */
const BULK = { lane: 'bulk' };
exports.RADAR_INTERVAL_MS = 30 * 60000;
/** full-coverage diff count for one day (48 at the 30-min cadence) */
exports.DIFFS_PER_DAY = Math.round(86400000 / exports.RADAR_INTERVAL_MS);
const PAGE_CONCURRENCY = 6;
/** the cadence every pre-v60.31 observation was taken at — what a day's `n`
 * means when it has no recorded `ms` */
const LEGACY_INTERVAL_MS = 30 * 60000;
/** milliseconds a day's coverage actually represents. Pre-v60.31 days carry
 * only a diff COUNT, so their span is inferred from the cadence they were
 * taken at — never from today's cadence, which may since have changed. */
const coveredMs = (d) => d.ms !== undefined && d.ms > 0 ? d.ms : d.n * LEGACY_INTERVAL_MS;
exports.coveredMs = coveredMs;
const spanOf = exports.coveredMs;
/** a diff whose window is wider than this is credited at this much — an app
 * left closed for a week must not claim a week of observation from one diff */
const MAX_CREDITED_SPAN_MS = 6 * 3600000;
/** the regions the radar watches: EVERY builtin hub's region (all five major
 * markets — the hub table's measured-flow columns need data everywhere, and
 * history can't be collected retroactively) plus any trader duty hub */
function radarRegions() {
    const ids = new Set(constants_1.BUILTIN_HUBS.map((h) => h.regionId));
    const chars = auth_1.useAuth.getState().characters;
    for (const c of chars) {
        if (c.tradeRole === 'trader' && c.homeHubId) {
            const hub = constants_1.BUILTIN_HUBS.find((x) => x.id === c.homeHubId);
            if (hub)
                ids.add(hub.regionId);
        }
    }
    return [...ids];
}
/**
 * PURE diff of two book snapshots for one region (unit-testable). `hour` is
 * the EVE hour the observation lands in.
 */
function diffSnapshots(prev, curr, exclude, hour) {
    const out = new Map();
    const cell = (typeId, isBuy) => {
        const k = `${typeId}:${isBuy ? 1 : 0}`;
        let c = out.get(k);
        if (!c) {
            c = { reprices: 0, fills: 0, fillIsk: 0, newOrders: 0, gone: 0, competitors: 0, bestPrice: 0, hFillIsk: new Array(24).fill(0), hReprice: new Array(24).fill(0) };
            out.set(k, c);
        }
        return c;
    };
    // competitor counts + best price from the CURRENT book
    const compCount = new Map();
    for (const o of curr.values()) {
        const k = `${o.typeId}:${o.isBuy ? 1 : 0}`;
        if (!exclude.has(o.id))
            compCount.set(k, (compCount.get(k) ?? 0) + 1);
        const c = cell(o.typeId, o.isBuy);
        if (c.bestPrice === 0 || (o.isBuy ? o.price > c.bestPrice : o.price < c.bestPrice))
            c.bestPrice = o.price;
    }
    for (const [k, n] of compCount) {
        const [t, s] = k.split(':');
        cell(Number(t), s === '1').competitors = n;
    }
    for (const [id, o] of curr) {
        const p = prev.get(id);
        if (!p) {
            if (!exclude.has(id))
                cell(o.typeId, o.isBuy).newOrders++;
            continue;
        }
        if (p.price !== o.price && !exclude.has(id)) {
            const c = cell(o.typeId, o.isBuy);
            c.reprices++;
            c.hReprice[hour]++;
        }
        if (o.volume < p.volume) {
            // volume only ever drops via fills — market flow, ours included
            const c = cell(o.typeId, o.isBuy);
            const qty = p.volume - o.volume;
            c.fills += qty;
            c.fillIsk += qty * p.price;
            c.hFillIsk[hour] += qty * p.price;
        }
    }
    for (const [id, p] of prev) {
        if (!curr.has(id) && !exclude.has(id))
            cell(p.typeId, p.isBuy).gone++;
    }
    return out;
}
// ---- snapshotting ----
async function fetchRegionBook(regionId, onProgress) {
    const first = await (0, esiRate_1.esiFetch)(`${constants_1.ESI_BASE}/markets/${regionId}/orders/?order_type=all&page=1`, undefined, BULK);
    if (!first.ok)
        throw new Error(`ESI ${first.status} for region ${regionId}`);
    const pages = Number(first.headers.get('x-pages') ?? '1');
    const book = new Map();
    const add = (rows) => {
        for (const r of rows)
            book.set(r.order_id, { id: r.order_id, typeId: r.type_id, isBuy: r.is_buy_order, price: r.price, volume: r.volume_remain });
    };
    add(await first.json());
    const nums = Array.from({ length: pages - 1 }, (_, i) => i + 2);
    let done = 1;
    let failed = 0;
    async function worker() {
        for (;;) {
            const page = nums.shift();
            if (!page)
                return;
            let ok = false;
            for (let attempt = 0; attempt < 2 && !ok; attempt++) {
                try {
                    const res = await (0, esiRate_1.esiFetch)(`${constants_1.ESI_BASE}/markets/${regionId}/orders/?order_type=all&page=${page}`, undefined, BULK);
                    if (res.ok) {
                        add(await res.json());
                        ok = true;
                    }
                }
                catch {
                    // network hiccup — retry once, then count the page as failed
                }
            }
            if (!ok)
                failed++;
            done++;
            if (done % 25 === 0)
                onProgress?.(`radar: region ${regionId} ${done}/${pages} pages`);
        }
    }
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, pages) }, worker));
    // INTEGRITY GATE: a partial book would fake "vanished" orders and phantom
    // churn — skip the whole snapshot rather than record false transitions
    if (failed > 0)
        throw new Error(`region ${regionId}: ${failed} page(s) failed`);
    return book;
}
// per-region previous snapshot AND when it was taken (memory only — one diff
// lost on restart). The timestamp is what lets a diff be credited with the
// span it actually covered instead of an assumed fixed interval.
const prevBooks = new Map();
// accumulating day rows: key `${r}:${t}:${s}` for the current UTC day
let accDay = '';
let acc = new Map();
// today's coverage per region: diffs seen, per-hour diff counts, and the
// total MILLISECONDS observed (persisted with the wip)
let covAcc = new Map();
const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
/**
 * A row worth keeping. THE ROLLOVER FLUSH AND THE CRASH-SAFE WIP MUST AGREE:
 * they used to differ (the WIP kept only rp/fi rows), so every row that had
 * only recorded orders APPEARING or VANISHING was silently dropped on any
 * restart — real churn signal, gone from the permanent ndjson archive.
 */
const hasSignal = (r) => r.rp > 0 || r.fi > 0 || r.nw > 0 || r.gn > 0;
function accumulate(regionId, diffs) {
    const day = utcDay();
    for (const [k, d] of diffs) {
        if (d.reprices === 0 && d.fills === 0 && d.newOrders === 0 && d.gone === 0) {
            // still refresh competitor/best-price for rows that already exist
            const key = `${regionId}:${k}`;
            const row = acc.get(key);
            if (row) {
                row.co = Math.max(row.co, d.competitors);
                row.bp = d.bestPrice;
            }
            continue;
        }
        const [t, s] = k.split(':');
        const key = `${regionId}:${k}`;
        let row = acc.get(key);
        if (!row) {
            row = { d: day, r: regionId, t: Number(t), s: (s === '1' ? 1 : 0), rp: 0, fi: 0, fk: 0, nw: 0, gn: 0, co: 0, bp: 0, hf: new Array(24).fill(0), hr: new Array(24).fill(0) };
            acc.set(key, row);
        }
        row.rp += d.reprices;
        row.fi += d.fills;
        row.fk += d.fillIsk;
        row.nw += d.newOrders;
        row.gn += d.gone;
        row.co = Math.max(row.co, d.competitors);
        row.bp = d.bestPrice;
        for (let h = 0; h < 24; h++) {
            row.hf[h] += d.hFillIsk[h];
            row.hr[h] += d.hReprice[h];
        }
    }
}
// ---- persistence: daily rollup + rolling summary ----
let summaryCache = null;
let covCache = null;
async function loadSummaryMap() {
    if (summaryCache)
        return summaryCache;
    const bridge = window.appInfo?.stats;
    summaryCache = new Map();
    if (bridge) {
        try {
            const raw = await bridge.auxRead('radar-summary.json');
            if (raw) {
                for (const e of JSON.parse(raw))
                    summaryCache.set(`${e.r}:${e.t}:${e.s}`, e);
            }
        }
        catch {
            // corrupt summary rebuilds itself over the coming days
        }
    }
    return summaryCache;
}
async function loadCoverageMap() {
    if (covCache)
        return covCache;
    const bridge = window.appInfo?.stats;
    covCache = new Map();
    if (bridge) {
        try {
            const raw = await bridge.auxRead('radar-coverage.json');
            if (raw) {
                for (const e of JSON.parse(raw)) {
                    covCache.set(e.r, { days: e.days, na: e.na, cva: e.cva });
                }
            }
        }
        catch {
            // coverage rebuilds from new observations
        }
    }
    return covCache;
}
/** flush a finished day's observation counts into the coverage ring.
 * `counts` defaults to the live accumulator but is passed explicitly when
 * rolling over a day recovered from the WIP file. */
async function persistCoverage(day, counts = covAcc) {
    const bridge = window.appInfo?.stats;
    if (!bridge || counts.size === 0)
        return;
    const cov = await loadCoverageMap();
    for (const [r, c] of counts) {
        let e = cov.get(r);
        if (!e) {
            e = { days: [], na: 0, cva: new Array(24).fill(0) };
            cov.set(r, e);
        }
        e.days = [...e.days.filter((d) => d.d !== day), { d: day, n: c.n, cv: c.cv, ms: c.ms ?? c.n * LEGACY_INTERVAL_MS }];
        if (e.days.length > 62)
            e.days = e.days.slice(-62);
        e.na += c.n;
        for (let h = 0; h < 24; h++)
            e.cva[h] += c.cv[h];
    }
    await bridge.auxWrite('radar-coverage.json', JSON.stringify([...cov.entries()].map(([r, e]) => ({ r, ...e }))));
}
/** persisted coverage with TODAY's live counts merged in */
async function loadRadarCoverage() {
    const cov = await loadCoverageMap();
    const merged = new Map();
    for (const [r, e] of cov)
        merged.set(r, { days: [...e.days], na: e.na, cva: [...e.cva] });
    const today = utcDay();
    for (const [r, c] of covAcc) {
        let e = merged.get(r);
        if (!e) {
            e = { days: [], na: 0, cva: new Array(24).fill(0) };
            merged.set(r, e);
        }
        e.days = [...e.days.filter((d) => d.d !== today), { d: today, n: c.n, cv: c.cv, ms: c.ms }];
        e.na += c.n;
        for (let h = 0; h < 24; h++)
            e.cva[h] += c.cv[h];
    }
    return merged;
}
/**
 * Coverage-normalized per-day rates over the last `nDays` CALENDAR days:
 * only observed intervals count in the denominator, so days/hours the app
 * was off are excluded from the average instead of reading as "quiet".
 * Falls back to raw per-row averages when no coverage exists (pre-coverage
 * data). Returns null rate fields when the window holds no observations.
 */
function normalizedRates(e, cov, nDays) {
    const cutoff = utcDay(Date.now() - nDays * 86400000);
    if (!cov || cov.days.length === 0) {
        const slice = e.days.filter((d) => d.d > cutoff);
        if (slice.length === 0)
            return null;
        const avg = (f) => slice.reduce((s, d) => s + d[f], 0) / slice.length;
        return { rp: avg('rp'), fi: avg('fi'), fk: avg('fk'), covPct: 1 };
    }
    const covDays = cov.days.filter((d) => d.d > cutoff);
    // OBSERVED TIME is the denominator, not observed ticks — see RegionCoverage
    const sumMs = covDays.reduce((s, d) => s + spanOf(d), 0);
    if (sumMs === 0)
        return null;
    const byDate = new Map(e.days.map((d) => [d.d, d]));
    const sum = (f) => covDays.reduce((s, d) => s + (byDate.get(d.d)?.[f] ?? 0), 0);
    const scale = 86400000 / sumMs; // → per-full-day equivalent
    return {
        rp: sum('rp') * scale,
        fi: sum('fi') * scale,
        fk: sum('fk') * scale,
        covPct: sumMs / (nDays * 86400000),
    };
}
async function persistRollover(rows) {
    const bridge = window.appInfo?.stats;
    if (!bridge || rows.length === 0)
        return;
    const month = rows[0].d.slice(0, 7);
    await bridge.auxAppend(`radar-${month}.ndjson`, rows.map((r) => JSON.stringify(r)));
    const sum = await loadSummaryMap();
    for (const row of rows) {
        const key = `${row.r}:${row.t}:${row.s}`;
        let e = sum.get(key);
        if (!e) {
            e = { r: row.r, t: row.t, s: row.s, days: [], hfa: new Array(24).fill(0), hra: new Array(24).fill(0) };
            sum.set(key, e);
        }
        // replace-by-date, not blind push: a day can legitimately be flushed twice
        // (recovered WIP + a same-day rollover) and two rows for one date would
        // double-count it in every window average
        e.days = [...e.days.filter((d) => d.d !== row.d), { d: row.d, rp: row.rp, fi: row.fi, fk: row.fk, co: row.co, bp: row.bp }];
        if (e.days.length > 31)
            e.days = e.days.slice(-31);
        for (let h = 0; h < 24; h++) {
            e.hfa[h] += row.hf[h];
            e.hra[h] += row.hr[h];
        }
    }
    await bridge.auxWrite('radar-summary.json', JSON.stringify([...sum.values()]));
}
/** one radar pass: snapshot each region, diff, accumulate; roll the day over
 * when it changes. First pass per region is baseline-only. */
async function runRadarTick(onProgress) {
    // never diff or write the WIP before the previous session's day has been
    // recovered — a tick that raced the restore would overwrite it
    await restoreRadarWip();
    const day = utcDay();
    if (accDay && accDay !== day) {
        // flush yesterday (stats + coverage) before touching today
        await persistRollover([...acc.values()].filter(hasSignal));
        await persistCoverage(accDay);
        acc = new Map();
        covAcc = new Map();
    }
    accDay = day;
    const exclude = (0, ledger_1.everOwnedOrderIds)();
    const hour = new Date().getUTCHours();
    let didDiff = false;
    for (const regionId of radarRegions()) {
        let book;
        try {
            book = await fetchRegionBook(regionId, onProgress);
        }
        catch {
            // failed/partial snapshot: keep the previous baseline — the next good
            // snapshot diffs over a wider window (fills still real, nothing faked)
            continue;
        }
        const prev = prevBooks.get(regionId);
        const takenAt = Date.now();
        if (prev) {
            accumulate(regionId, diffSnapshots(prev.book, book, exclude, hour));
            // coverage: this diff observed the market for the span it actually
            // covered — a snapshot that failed last tick makes this one twice as
            // wide, and crediting it as one fixed interval overstated the rate
            let c = covAcc.get(regionId);
            if (!c) {
                c = { n: 0, cv: new Array(24).fill(0), ms: 0 };
                covAcc.set(regionId, c);
            }
            c.n++;
            c.cv[hour]++;
            c.ms += Math.min(MAX_CREDITED_SPAN_MS, Math.max(0, takenAt - prev.at));
            didDiff = true;
        }
        prevBooks.set(regionId, { book, at: takenAt });
    }
    // WIP survives restarts losing at most the in-memory baseline
    const bridge = window.appInfo?.stats;
    if (bridge && didDiff) {
        const rows = [...acc.values()].filter(hasSignal);
        const cov = [...covAcc.entries()].map(([r, c]) => ({ r, n: c.n, cv: c.cv, ms: c.ms }));
        try {
            await bridge.auxWrite('radar-wip.json', JSON.stringify({ day: accDay, rows, cov }));
        }
        catch {
            // wip is a nicety
        }
    }
    return didDiff;
}
/**
 * Restore the in-progress day after an app restart.
 *
 * A WIP FILE FROM A PAST DAY IS NOT RUBBISH — IT IS AN UNFLUSHED DAY. The
 * rollover only ever ran inside runRadarTick, so closing the app before UTC
 * midnight and reopening after it meant that day was never rolled into
 * radar-<month>.ndjson or the summary — and the first tick of the new day
 * then OVERWROTE radar-wip.json, destroying it. Anyone who shuts the machine
 * down overnight lost a day every day. So: same day → resume it; older day →
 * roll it over now, exactly as the midnight path would have.
 */
let restoreOnce = null;
function restoreRadarWip() {
    if (!restoreOnce)
        restoreOnce = doRestoreWip();
    return restoreOnce;
}
async function doRestoreWip() {
    const bridge = window.appInfo?.stats;
    if (!bridge || acc.size > 0)
        return;
    try {
        const raw = await bridge.auxRead('radar-wip.json');
        if (!raw)
            return;
        const wip = JSON.parse(raw);
        if (typeof wip.day !== 'string' || !Array.isArray(wip.rows))
            return;
        // a WIP written before v60.31 has no `ms` — infer it from the cadence
        // those observations were actually taken at
        const covOf = () => new Map((wip.cov ?? []).map((c) => [c.r, { n: c.n, cv: c.cv, ms: c.ms ?? c.n * LEGACY_INTERVAL_MS }]));
        if (wip.day === utcDay()) {
            accDay = wip.day;
            for (const r of wip.rows)
                acc.set(`${r.r}:${r.t}:${r.s}`, r);
            for (const [r, c] of covOf())
                covAcc.set(r, c);
            return;
        }
        // a day the app never got to flush — persist it before anything overwrites it
        await persistRollover(wip.rows.filter(hasSignal));
        await persistCoverage(wip.day, covOf());
        await bridge.auxWrite('radar-wip.json', JSON.stringify({ day: utcDay(), rows: [], cov: [] }));
    }
    catch {
        // fine — the day rebuilds from the next diffs
    }
}
/** the rolling summary for the Radar tab (today's live rows merged in) */
async function loadRadarSummary() {
    const sum = await loadSummaryMap();
    const merged = new Map();
    for (const [k, e] of sum)
        merged.set(k, { ...e, days: [...e.days], hfa: [...e.hfa], hra: [...e.hra] });
    for (const row of acc.values()) {
        if (row.rp === 0 && row.fi === 0)
            continue;
        const key = `${row.r}:${row.t}:${row.s}`;
        let e = merged.get(key);
        if (!e) {
            e = { r: row.r, t: row.t, s: row.s, days: [], hfa: new Array(24).fill(0), hra: new Array(24).fill(0) };
            merged.set(key, e);
        }
        e.days = [...e.days.filter((d) => d.d !== row.d), { d: row.d, rp: row.rp, fi: row.fi, fk: row.fk, co: row.co, bp: row.bp }];
        for (let h = 0; h < 24; h++) {
            e.hfa[h] += row.hf[h];
            e.hra[h] += row.hr[h];
        }
    }
    return [...merged.values()];
}
/**
 * Measured trade flow for one (region, item): units per day actually
 * BOUGHT from sell orders (ask-side fills) and SOLD into buy orders
 * (bid-side fills) — real executed trades from full-book diffs, NOT
 * listings, 7-day coverage-normalized. Returns null when the radar does
 * not watch this region at all; zeros are honest "watched, no fills seen".
 */
async function itemTradeFlow(regionId, typeId) {
    const cov = (await loadRadarCoverage()).get(regionId);
    if (!cov || cov.days.length === 0)
        return null; // region not radar-watched
    const sum = await loadRadarSummary();
    const s0 = sum.find((x) => x.r === regionId && x.t === typeId && x.s === 0);
    const s1 = sum.find((x) => x.r === regionId && x.t === typeId && x.s === 1);
    const n0 = s0 ? normalizedRates(s0, cov, 7) : null;
    const n1 = s1 ? normalizedRates(s1, cov, 7) : null;
    return { askUnits: n0?.fi ?? 0, bidUnits: n1?.fi ?? 0, days: cov.days.length };
}
/** batched itemTradeFlow: loads the summary/coverage ONCE for any number of
 * items (the per-item version copies the whole summary per call — fine for
 * a hub row, ruinous for an uncapped group table). */
async function itemTradeFlows(regionId, typeIds) {
    const out = new Map();
    const cov = (await loadRadarCoverage()).get(regionId);
    if (!cov || cov.days.length === 0) {
        for (const t of typeIds)
            out.set(t, null);
        return out;
    }
    const sum = await loadRadarSummary();
    const byType = new Map();
    for (const e of sum) {
        if (e.r !== regionId)
            continue;
        const slot = byType.get(e.t) ?? byType.set(e.t, {}).get(e.t);
        if (e.s === 0)
            slot.s0 = e;
        else
            slot.s1 = e;
    }
    for (const t of typeIds) {
        const slot = byType.get(t);
        const n0 = slot?.s0 ? normalizedRates(slot.s0, cov, 7) : null;
        const n1 = slot?.s1 ? normalizedRates(slot.s1, cov, 7) : null;
        out.set(t, { askUnits: n0?.fi ?? 0, bidUnits: n1?.fi ?? 0, days: cov.days.length });
    }
    return out;
}
/** batched sell-side fill clocks for one region — the summary is loaded
 * ONCE for the whole list (the single-item version copies it per call). */
async function itemFlowStatsMany(regionId, typeIds) {
    const out = new Map();
    const sum = await loadRadarSummary();
    const cov = (await loadRadarCoverage()).get(regionId);
    const byType = new Map();
    for (const e of sum)
        if (e.r === regionId && e.s === 0)
            byType.set(e.t, e);
    for (const t of typeIds) {
        const e = byType.get(t);
        if (!e) {
            out.set(t, null);
            continue;
        }
        const hours = e.hfa.map((v, h) => (cov && cov.cva[h] > 0 ? v / cov.cva[h] : cov ? 0 : v));
        const total = hours.reduce((a, b) => a + b, 0);
        const n = normalizedRates(e, cov, 7);
        out.set(t, total > 0 && n && n.fk > 0 ? { hours, fk7: n.fk } : null);
    }
    return out;
}
/** the item's own sell-side fill clock + daily flow — feeds the profitable
 * reprice-window math. null until the radar has seen flow for it. The hour
 * clock and the daily rate are COVERAGE-normalized: hours the app wasn't
 * watching don't read as quiet, they just don't vote. */
async function itemFlowStats(regionId, typeId) {
    const sum = await loadRadarSummary();
    const e = sum.find((x) => x.r === regionId && x.t === typeId && x.s === 0);
    if (!e)
        return null;
    const cov = (await loadRadarCoverage()).get(regionId);
    const hours = e.hfa.map((v, h) => (cov && cov.cva[h] > 0 ? v / cov.cva[h] : cov ? 0 : v));
    const total = hours.reduce((a, b) => a + b, 0);
    if (total <= 0)
        return null;
    const n = normalizedRates(e, cov, 7);
    if (!n || n.fk <= 0)
        return null;
    return { hours, fk7: n.fk };
}
