"use strict";
// ESI RATE LIMITS — obeyed, not guessed at.
//
// CCP publishes a per-route limit in the OpenAPI spec as `x-rate-limit`.
// For the fitting routes (GET list, POST create, DELETE remove) it is:
//
//     { group: "fitting", max-tokens: 150, window-size: "15m" }
//
// All three verbs share ONE budget. Token cost is by response status
// (https://developers.eveonline.com/docs/services/esi/rate-limiting/):
//
//     2XX -> 2 tokens     3XX -> 1 token
//     4XX -> 5 tokens     5XX -> 0 tokens
//
// So 150 tokens ÷ 2 = 75 successful fitting calls per 15 minutes — roughly
// one every 12 seconds. A tool that creates fits back-to-back blows through
// that in seconds, which is what happened.
//
// SEPARATELY there is the older ERROR limit: 100 non-2xx/3xx responses per
// 60s, after which EVERY route returns 420 for the rest of the window.
//
// THIS MODULE IS DELIBERATELY PESSIMISTIC. The docs say the budget is per
// (group, userID) pair, and it is not worth experimenting on a live account
// to discover whether "user" means the character or the application — so a
// SINGLE shared budget is assumed across every character. If the server's
// own headers say there is more headroom, they win; we never go faster than
// our own pace regardless.
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateStatus = exports.rateObserve = exports.rateAcquire = exports.FITTING_GROUP = void 0;
exports.tokenCost = tokenCost;
exports.esiErrorState = esiErrorState;
exports.noteEsiResponse = noteEsiResponse;
exports.esiGate = esiGate;
exports.esiFetch = esiFetch;
exports.estimateMs = estimateMs;
exports.humanMs = humanMs;
/** straight from the spec — see the header comment */
exports.FITTING_GROUP = {
    group: 'fitting',
    maxTokens: 150,
    windowMs: 15 * 60000,
};
/** tokens a response costs, by status class */
function tokenCost(status) {
    if (status >= 500)
        return 0;
    if (status === 429)
        return 0; // documented exclusion
    if (status >= 400)
        return 5;
    if (status >= 300)
        return 1;
    return 2;
}
/**
 * Keep a reserve rather than running the budget to zero. CCP's own guidance
 * is "don't operate at the limit" — and the reserve is what lets an ordinary
 * background read (a scan) happen without colliding with a long write run.
 */
const SAFE_FRACTION = 0.8;
/**
 * THE BUDGET OUTLIVES THE PROCESS. CCP's window is wall-clock, not
 * per-session: closing the app halfway through a fitting run and reopening it
 * used to reset `spent` to zero, so the app believed it had a full 150 tokens
 * when the server knew it had spent 140. Pacing alone still applied, so it
 * could not burst — but it would walk straight into a 429 that was entirely
 * predictable. Persisting the two numbers that define the window fixes that.
 */
const stateKey = (group) => `eve-conductor-esi-rate-${group}`;
function loadWindow(group) {
    try {
        const raw = localStorage.getItem(stateKey(group));
        if (!raw)
            return null;
        const v = JSON.parse(raw);
        if (typeof v.windowStart !== 'number' || typeof v.spent !== 'number')
            return null;
        if (!Number.isFinite(v.windowStart) || !Number.isFinite(v.spent) || v.spent < 0)
            return null;
        // a windowStart in the future means the clock moved — do not trust it
        if (v.windowStart > Date.now())
            return null;
        return { windowStart: v.windowStart, spent: v.spent };
    }
    catch {
        return null;
    }
}
class GroupLimiter {
    constructor(spec) {
        this.spec = spec;
        this.spent = 0;
        this.windowStart = Date.now();
        this.lastCall = 0;
        this.blockedUntil = 0;
        this.blockedReason = null;
        /** the server's own view, when it has told us */
        this.serverRemaining = null;
        const saved = loadWindow(spec.group);
        if (saved && Date.now() - saved.windowStart < spec.windowMs) {
            this.windowStart = saved.windowStart;
            this.spent = saved.spent;
        }
    }
    save() {
        try {
            localStorage.setItem(stateKey(this.spec.group), JSON.stringify({ windowStart: this.windowStart, spent: this.spent }));
        }
        catch {
            // a full/absent localStorage must never stop a run — worst case we are
            // back to the old in-memory-only behaviour
        }
    }
    roll(now) {
        if (now - this.windowStart >= this.spec.windowMs) {
            this.windowStart = now;
            this.spent = 0;
            this.serverRemaining = null;
            this.save();
        }
    }
    /** the budget we allow ourselves, leaving CCP's recommended headroom */
    budget() {
        return Math.floor(this.spec.maxTokens * SAFE_FRACTION);
    }
    /** even spacing across the window for a typical 2-token call */
    paceMs() {
        const calls = Math.max(1, Math.floor(this.budget() / 2));
        return Math.ceil(this.spec.windowMs / calls);
    }
    remaining(now = Date.now()) {
        this.roll(now);
        const mine = this.budget() - this.spent;
        // the SERVER is the authority when it has spoken — but never let it talk
        // us into going faster than our own budget
        return this.serverRemaining === null ? mine : Math.min(mine, this.serverRemaining);
    }
    status(now = Date.now()) {
        this.roll(now);
        const pace = this.paceMs();
        const sinceLast = now - this.lastCall;
        let waitMs = Math.max(0, pace - sinceLast);
        if (this.blockedUntil > now)
            waitMs = Math.max(waitMs, this.blockedUntil - now);
        const remaining = this.remaining(now);
        const resetInMs = Math.max(0, this.spec.windowMs - (now - this.windowStart));
        // out of budget: the only safe move is to wait for the window
        if (remaining < 2)
            waitMs = Math.max(waitMs, resetInMs);
        return {
            remaining,
            resetInMs,
            waitMs,
            paceMs: pace,
            blockedUntil: this.blockedUntil > now ? this.blockedUntil : null,
            blockedReason: this.blockedUntil > now ? this.blockedReason : null,
        };
    }
    /** wait until this call may go. `abort` lets a long run be stopped. */
    async acquire(abort) {
        for (;;) {
            const st = this.status();
            if (st.waitMs <= 0)
                break;
            if (abort?.())
                throw new Error('stopped');
            // sleep in slices so a stop is responsive and the UI can tick
            await new Promise((r) => setTimeout(r, Math.min(st.waitMs, 1000)));
        }
        this.lastCall = Date.now();
    }
    /** record what a response cost and anything the server told us */
    observe(status, headers) {
        const now = Date.now();
        this.roll(now);
        this.spent += tokenCost(status);
        this.save();
        /**
         * ABSENT IS NOT ZERO. `Number(null)` is 0, so reading a header that was
         * never sent used to mean "no budget left" (a 15-minute stall on every
         * response) and "10 errors from the limit" (a 60-second block after
         * every SUCCESS). Rate-limit headers are not sent on every route, so
         * this was the normal case, not an edge one.
         */
        const num = (name) => {
            const raw = headers.get(name);
            if (raw === null || raw.trim() === '')
                return null;
            const v = Number(raw);
            return Number.isFinite(v) ? v : null;
        };
        const remain = num('x-ratelimit-remaining');
        if (remain !== null)
            this.serverRemaining = remain;
        // 429: the server is explicit about when we may return
        if (status === 429) {
            const retry = num('retry-after');
            const ms = retry !== null && retry > 0 ? retry * 1000 : 60000;
            this.blockedUntil = now + ms;
            this.blockedReason = `EVE asked us to wait ${Math.ceil(ms / 1000)}s (429 rate limited)`;
            return;
        }
        // 420: the ERROR limit tripped — every route is closed for the window
        if (status === 420) {
            const reset = num('x-esi-error-limit-reset');
            const ms = reset !== null && reset > 0 ? reset * 1000 : 60000;
            this.blockedUntil = now + ms + 5000;
            this.blockedReason = `ESI error limit tripped (420) — everything pauses for ${Math.ceil(ms / 1000)}s`;
            return;
        }
        // 520: an internal EVE limit some routes enforce; back off generously
        if (status === 520) {
            this.blockedUntil = now + 60000;
            this.blockedReason = 'EVE returned 520 (an internal limit) — pausing 60s';
            return;
        }
        // getting close to the ERROR limit is also a reason to stop pushing
        const errRemain = num('x-esi-error-limit-remain');
        if (errRemain !== null && errRemain <= 10) {
            const reset = num('x-esi-error-limit-reset');
            const ms = reset !== null && reset > 0 ? reset * 1000 : 60000;
            this.blockedUntil = now + ms;
            this.blockedReason = `only ${errRemain} ESI errors left in this window — pausing ${Math.ceil(ms / 1000)}s`;
        }
    }
}
/** lower number = more important. Used to decide who a 429 also stops. */
const LANE_RANK = {
    overlay: 0, interactive: 1, background: 2, bulk: 3,
};
/** stop spending the error budget with this much of it left, per lane */
const LANE_FLOOR = {
    overlay: 5, interactive: 20, background: 35, bulk: 50,
};
const LANES = ['overlay', 'interactive', 'background', 'bulk'];
/** set ONLY by a 420 — the server has already closed every route */
let hardBlockedUntil = 0;
let hardReason = null;
/** per-lane pauses from 429s and from the lane's own error floor */
const laneBlockedUntil = {
    overlay: 0, interactive: 0, background: 0, bulk: 0,
};
const laneReason = {
    overlay: null, interactive: null, background: null, bulk: null,
};
let errRemain = null;
function laneBlockUntil(lane) {
    const now = Date.now();
    let until = Math.max(hardBlockedUntil, laneBlockedUntil[lane]);
    // the lane's own floor in the shared budget
    if (errRemain !== null && errRemain <= LANE_FLOOR[lane] && errFloorUntil > now) {
        until = Math.max(until, errFloorUntil);
    }
    return until;
}
/** when the current error-budget window is expected to reset */
let errFloorUntil = 0;
function esiErrorState(lane = 'interactive') {
    const now = Date.now();
    const until = laneBlockUntil(lane);
    return {
        blockedUntil: until > now ? until : null,
        reason: until > now ? (hardBlockedUntil > now ? hardReason : laneReason[lane]) : null,
        remain: errRemain,
        hardBlocked: hardBlockedUntil > now,
        pausedLanes: LANES.filter((l) => laneBlockUntil(l) > now).sort((a, b) => LANE_RANK[b] - LANE_RANK[a]),
    };
}
/**
 * Record ANY ESI response against the shared error budget. `lane` is the lane
 * the request came from, which is what a 429 is scoped to.
 */
function noteEsiResponse(status, headers, lane = 'interactive') {
    const now = Date.now();
    const num = (name) => {
        const raw = headers.get(name);
        if (raw === null || raw.trim() === '')
            return null;
        const v = Number(raw);
        return Number.isFinite(v) ? v : null;
    };
    const resetMs = () => {
        const reset = num('x-esi-error-limit-reset');
        return reset !== null && reset > 0 ? reset * 1000 : 60000;
    };
    const remain = num('x-esi-error-limit-remain');
    if (remain !== null) {
        errRemain = remain;
        // the window this figure belongs to; every lane's floor is measured
        // against it, and it is what they wait for
        errFloorUntil = Math.max(errFloorUntil, now + resetMs());
    }
    if (status === 420) {
        // by now the server is answering 420 on every route — there is nothing
        // left to protect, so even the overlay waits
        hardBlockedUntil = Math.max(hardBlockedUntil, now + resetMs() + 5000);
        hardReason = 'ESI error limit tripped (420) — every route is closed until the window resets';
        return;
    }
    if (status === 429 || status === 520) {
        const retry = num('retry-after');
        const ms = status === 429 && retry !== null && retry > 0 ? retry * 1000 : 60000;
        const why = status === 429
            ? `EVE asked us to wait ${Math.ceil(ms / 1000)}s (429)`
            : 'EVE returned 520 (an internal limit) — pausing 60s';
        // per-group, not global: pause this lane and everything LESS important,
        // so a fitting 429 can never take the overlay off the screen
        for (const l of LANES) {
            if (LANE_RANK[l] >= LANE_RANK[lane]) {
                laneBlockedUntil[l] = Math.max(laneBlockedUntil[l], now + ms);
                laneReason[l] = why;
            }
        }
        return;
    }
    // the shared error budget running low: each lane stops at its own floor,
    // so the bulk sweep yields long before the screen does
    if (remain !== null) {
        for (const l of LANES) {
            if (remain <= LANE_FLOOR[l]) {
                laneReason[l] = `only ${remain} ESI errors left this window — ${l} traffic is paused`;
            }
        }
    }
}
/** Wait until the shared error budget allows another request on this lane. */
async function esiGate(lane = 'interactive', abort) {
    for (;;) {
        const wait = laneBlockUntil(lane) - Date.now();
        if (wait <= 0)
            return;
        if (abort?.())
            throw new Error('stopped');
        await new Promise((r) => setTimeout(r, Math.min(wait, 1000)));
    }
}
/**
 * The ONLY way this app should reach ESI. Waits for this lane's turn, then
 * reports what the response cost back into the shared budget.
 */
async function esiFetch(url, init, opts) {
    const lane = opts?.lane ?? 'interactive';
    await esiGate(lane, opts?.abort);
    const res = await fetch(url, init);
    noteEsiResponse(res.status, res.headers, lane);
    return res;
}
const limiters = new Map();
const limiterFor = (spec) => {
    const existing = limiters.get(spec.group);
    if (existing)
        return existing;
    const made = new GroupLimiter(spec);
    limiters.set(spec.group, made);
    return made;
};
const rateAcquire = (spec, abort) => limiterFor(spec).acquire(abort);
exports.rateAcquire = rateAcquire;
const rateObserve = (spec, status, headers) => limiterFor(spec).observe(status, headers);
exports.rateObserve = rateObserve;
const rateStatus = (spec) => limiterFor(spec).status();
exports.rateStatus = rateStatus;
/** how long N calls will take at the current pace, in ms */
function estimateMs(spec, calls) {
    const l = limiterFor(spec);
    const st = l.status();
    if (calls <= 0)
        return 0;
    // calls that fit in this window, then a full window wait per further batch
    const perWindow = Math.max(1, Math.floor((spec.maxTokens * SAFE_FRACTION) / 2));
    const windows = Math.floor(Math.max(0, calls - st.remaining / 2) / perWindow);
    return calls * st.paceMs + windows * spec.windowMs;
}
/** human "2h 5m" / "45s" */
function humanMs(ms) {
    const s = Math.ceil(ms / 1000);
    if (s < 60)
        return `${s}s`;
    const m = Math.round(s / 60);
    if (m < 60)
        return `${m} min`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
}
