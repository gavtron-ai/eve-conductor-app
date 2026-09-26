// THE DASHLET STORE'S CATALOGUE (v0.207.0; tripled in v0.209.0). PURE — what exists, in which
// sizes, under which shelf, and where a click on it leads. The owner's brief: "instead of making
// copies from the initial tabs lets make unique dashlets for this in nice little categories like a
// curated dashboard storefront". So a dashlet is never a tab squeezed into a box: each answers ONE
// question at a glance, from data the app already holds (no dashlet spends ESI calls of its own),
// and its title bar opens the tab that has the full story.
import type { DashSize } from './homeGrid';
import { BOARDS } from './leaderboard';
import { APERTURE_FEATURES_AVAILABLE } from './apertureAccess';

export type DashCategory = 'chain' | 'harvest' | 'theft' | 'planets' | 'wealth' | 'market' | 'battle' | 'corp' | 'pilots' | 'app';
export const CATEGORIES: { id: DashCategory; label: string; icon: string; blurb: string }[] = [
  { id: 'theft', label: 'Theft', icon: '🪝', blurb: 'skyhook raid windows and the robberies seen' },
  { id: 'planets', label: 'Planets', icon: '🪐', blurb: 'what needs a trip, and what is on the ground' },
  { id: 'wealth', label: 'Wealth', icon: '💰', blurb: 'what you are worth and what you earned' },
  { id: 'market', label: 'Market', icon: '📈', blurb: 'your orders and the market talking back' },
  { id: 'battle', label: 'Battle', icon: '⚔', blurb: 'fights and kills, from public killmails' },
  { id: 'corp', label: 'Corp', icon: '🏆', blurb: 'the leaderboard and the corp at a glance' },
  { id: 'pilots', label: 'Pilots', icon: '🧑‍🚀', blurb: 'your characters: where, in what, logged in?' },
  { id: 'app', label: 'Utility', icon: '🧰', blurb: 'the clock, notes, shortcuts, the app\'s health' },
  // v0.243.0: the two shelves that live off the corp map come last — the map link is switched off (Help → Aperture)
  { id: 'harvest', label: 'Harvest', icon: '⛏', blurb: 'ore, gas and your own loot log — the ore and gas finders need the corp map, which is switched off' },
  { id: 'chain', label: 'Chain', icon: '🕸', blurb: 'what is out there, from your corp map — switched off with the Aperture link (Help → Aperture says why)' },
];

export interface DashOption {
  key: string; label: string; def: string;
  /** a pick-one option; absent for free text */
  choices?: { v: string; label: string }[];
  /** free text typed by the player (the Notes dashlet) */
  text?: { max: number; placeholder: string };
}
export interface DashletSpec {
  id: string;
  category: DashCategory;
  icon: string;
  title: string;
  /** one sentence for the store card: the question it answers */
  blurb: string;
  /** the versions it comes in, smallest first */
  sizes: DashSize[];
  /** the favorites-style destination its title bar opens ("module:tab"); '' = nowhere */
  dest: string;
  /** what it needs before it can show anything — said on the store card */
  needs?: string;
  options?: DashOption[];
}

const pick = (key: string, label: string, def: string, choices: [string, string][]): DashOption => ({ key, label, def, choices: choices.map(([v, l]) => ({ v, label: l })) });
const ROCKS = ['Arkonor', 'Bistot', 'Crokite', 'Dark Ochre', 'Gneiss', 'Hedbergite', 'Hemorphite', 'Jaspet', 'Kernite', 'Mercoxit', 'Omber', 'Plagioclase', 'Pyroxeres', 'Scordite', 'Spodumain', 'Veldspar'];
export const GASES = ['C28', 'C32', 'C50', 'C60', 'C70', 'C72', 'C84', 'C320', 'C540'];
const DAYS_1_7_30 = pick('range', 'range', '7', [['1', '24 hours'], ['7', '7 days'], ['30', '30 days']]);
const SALES_RANGE = pick('range', 'range', '1', [['1', '24 hours'], ['7', '7 days'], ['30', '30 days']]);
const KILL_RANGE = pick('range', 'range', '7', [['1', '24 hours'], ['3', '3 days'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', '1 year']]);
const RAID_RANGE = pick('range', 'range', '7', [['1', '24 hours'], ['7', '7 days'], ['30', '30 days']]);
const MAP = 'the Aperture map link — switched off since 0.216.0 (Help → Aperture says why)';
const TRADER = 'a trading character, logged in';
const PI = 'a character with planets, logged in';
const BOARD = 'the Leaderboard opened once (it keeps what it read)';

export const DASHLETS: DashletSpec[] = [
  // ---- chain
  { id: 'chain-isk', category: 'chain', icon: 'Σ', title: 'ISK on field', blurb: 'How much is sitting in the chain right now, by activity — and the richest sites.', sizes: ['S', 'M', 'L'], dest: 'aperture:summary', needs: MAP },
  { id: 'chain-ways', category: 'chain', icon: '🚪', title: 'Ways out of home', blurb: 'Each system directly off home — its class and letter, how deep it goes, what it holds.', sizes: ['M', 'L'], dest: 'aperture:summary', needs: MAP },
  { id: 'chain-near', category: 'chain', icon: '📍', title: 'Close to home', blurb: 'What is worth running without a long trip: ISK and sites within a few jumps.', sizes: ['S', 'M', 'L'], dest: 'aperture:summary', needs: MAP,
    options: [pick('jumps', 'within', '2', [['1', '1 jump'], ['2', '2 jumps'], ['3', '3 jumps'], ['4', '4 jumps']])] },
  { id: 'chain-activity', category: 'chain', icon: '🎯', title: 'Site finder', blurb: 'The nearest sites of one activity — combat, relic, data — with what each is worth.', sizes: ['S', 'M', 'L'], dest: 'aperture:summary', needs: MAP,
    options: [pick('activity', 'activity', 'Combat', [['Combat', 'Combat'], ['Relic', 'Relic'], ['Data', 'Data'], ['Gas', 'Gas'], ['Ore', 'Ore']])] },
  { id: 'chain-exits', category: 'chain', icon: '🛣', title: 'Ways to known space', blurb: 'Every high, low and null exit on the chain: jumps from home, and gate jumps on to Jita.', sizes: ['S', 'M', 'L'], dest: 'aperture:map', needs: MAP },
  { id: 'chain-effects', category: 'chain', icon: '✨', title: 'System effects', blurb: 'Pulsars, magnetars, black holes… which systems on the chain carry an effect, and how far.', sizes: ['M', 'L'], dest: 'aperture:summary', needs: MAP },
  { id: 'chain-fresh', category: 'chain', icon: '🧭', title: 'Map freshness', blurb: 'How stale is the map? Signatures by age, and how many nobody has scanned down.', sizes: ['S', 'M'], dest: 'aperture:summary', needs: MAP },
  { id: 'chain-shape', category: 'chain', icon: '🧬', title: 'Chain shape', blurb: 'How big the chain is today and what it is made of, class by class.', sizes: ['S', 'M'], dest: 'aperture:map', needs: MAP },
  // ---- harvest
  { id: 'chain-ore', category: 'harvest', icon: '⛏', title: 'Ore finder', blurb: 'Where is my rock today? The nearest sites carrying one ore, with jumps from home.', sizes: ['S', 'M', 'L'], dest: 'aperture:summary', needs: MAP,
    options: [pick('rock', 'ore', 'Gneiss', ROCKS.map((r) => [r, r] as [string, string]))] },
  { id: 'chain-gas', category: 'harvest', icon: '💨', title: 'Gas finder', blurb: 'Where is the C320? The nearest gas sites carrying one fullerite, valued on that gas alone.', sizes: ['S', 'M', 'L'], dest: 'aperture:summary', needs: MAP,
    options: [pick('gas', 'gas', 'C320', GASES.map((g) => [g, g] as [string, string]))] },
  { id: 'hauls', category: 'harvest', icon: '🎒', title: 'My hauls', blurb: 'What you actually brought home: the loot you logged, this month and in all.', sizes: ['S', 'M'], dest: 'aperture:summary', needs: 'hauls logged with ＋ haul in the Σ Summary — switched off with the Aperture link, so nothing new can be logged for now' },
  { id: 'mining-fleet', category: 'harvest', icon: '🚜', title: 'Mining fleet', blurb: 'Who is pulling rock and who has stopped — the mining alert\'s own view of your miners.', sizes: ['M', 'L'], dest: '', needs: 'the multibox overlay on, with its ⛏ mining alert enabled' },
  // ---- theft
  { id: 'raid-windows', category: 'theft', icon: '🪝', title: 'Raid windows', blurb: 'Skyhooks that can be robbed now or within the hour, nearest first.', sizes: ['S', 'M', 'L'], dest: 'theft:skyhooks', needs: 'nothing — public data; import your map in Skyhooks for distances' },
  { id: 'raid-log', category: 'theft', icon: '👀', title: 'Robberies seen', blurb: 'Skyhooks the raid watcher saw emptied mid-window, newest first.', sizes: ['S', 'M', 'L'], dest: 'theft:skyhooks' },
  { id: 'raid-hot', category: 'theft', icon: '🔥', title: 'Most robbed', blurb: 'The systems thieves keep coming back to.', sizes: ['M', 'L'], dest: 'theft:skyhooks', options: [RAID_RANGE] },
  { id: 'raid-hours', category: 'theft', icon: '🕰', title: 'When thieves strike', blurb: 'Robberies by EVE hour of day — when the competition is awake.', sizes: ['M', 'L'], dest: 'theft:skyhooks', options: [RAID_RANGE] },
  { id: 'raid-odds', category: 'theft', icon: '🎲', title: 'Robbed or left alone', blurb: 'Of the windows the watcher could call, how many ended robbed — and how far in.', sizes: ['S', 'M'], dest: 'theft:skyhooks', options: [RAID_RANGE] },
  // ---- planets
  { id: 'pi-planets', category: 'planets', icon: '🪐', title: 'Planets', blurb: 'How many planets need you NOW — the PI tab\'s own count — and which first.', sizes: ['S', 'M', 'L'], dest: 'pi:planets', needs: PI },
  { id: 'pi-resets', category: 'planets', icon: '⏳', title: 'Extractor resets', blurb: 'Which extractor programs have ended or end soonest — plan the reset trip.', sizes: ['S', 'M', 'L'], dest: 'pi:planets', needs: PI },
  { id: 'pi-storage', category: 'planets', icon: '📦', title: 'Fullest planets', blurb: 'Storage closest to throwing output away, with the time left where it is measured.', sizes: ['M', 'L'], dest: 'pi:planets', needs: PI },
  { id: 'pi-products', category: 'planets', icon: '🧪', title: 'On the ground', blurb: 'What is sitting on your planets, product by product, at the Jita ask.', sizes: ['S', 'M', 'L'], dest: 'pi:planets', needs: PI },
  { id: 'pi-pilots', category: 'planets', icon: '👩‍🌾', title: 'Planets by pilot', blurb: 'Each PI character: planets, how many need them now, what they are holding.', sizes: ['M', 'L'], dest: 'pi:planets', needs: PI },
  // ---- wealth
  { id: 'net-worth', category: 'wealth', icon: '💰', title: 'Trading value', blurb: 'Your recorded trading value and how it moved — a day, a week, a month.', sizes: ['S', 'M', 'XL'], dest: 'trade:dashboard', needs: TRADER, options: [DAYS_1_7_30] },
  { id: 'wealth-layers', category: 'wealth', icon: '🥞', title: 'Where the ISK sits', blurb: 'The latest value snapshot split into hangar stock, sell orders, escrow, transit and wallets.', sizes: ['M', 'L'], dest: 'trade:dashboard', needs: TRADER },
  { id: 'wallets', category: 'wealth', icon: '👛', title: 'Wallets', blurb: 'Every character\'s wallet as of its last sync, and the total.', sizes: ['S', 'M', 'L'], dest: 'trade:dashboard', needs: 'characters logged in' },
  { id: 'trade-today', category: 'wealth', icon: '🧾', title: 'Sales', blurb: 'What actually sold — revenue and realized profit from your own wallet.', sizes: ['S', 'M'], dest: 'trade:dashboard', needs: TRADER, options: [SALES_RANGE] },
  { id: 'profit-days', category: 'wealth', icon: '📊', title: 'Profit by day', blurb: 'Realized profit, one bar per EVE day — the good days and the bad.', sizes: ['M', 'XL'], dest: 'trade:dashboard', needs: TRADER,
    options: [pick('range', 'days', '14', [['7', '7 days'], ['14', '14 days'], ['30', '30 days']])] },
  { id: 'inventory', category: 'wealth', icon: '🏷', title: 'Unsold stock', blurb: 'What you bought and have not sold yet, at what it cost you — and how long it has sat.', sizes: ['S', 'M', 'L'], dest: 'trade:dashboard', needs: TRADER },
  // ---- market
  { id: 'orders', category: 'market', icon: '📋', title: 'My orders', blurb: 'Open sells and buys across the team, and how many sells have been undercut.', sizes: ['S', 'M'], dest: 'trade:orders', needs: TRADER },
  { id: 'market-events', category: 'market', icon: '📣', title: 'Market events', blurb: 'The market talking back in the last day: undercuts, outbids, sales, rivals moving.', sizes: ['S', 'M', 'L'], dest: 'trade:trends', needs: TRADER },
  { id: 'best-sellers', category: 'market', icon: '🏅', title: 'Best sellers', blurb: 'The items that made you the most realized profit — and the one that lost the most.', sizes: ['M', 'L'], dest: 'trade:dashboard', needs: TRADER, options: [pick('range', 'range', '30', [['7', '7 days'], ['30', '30 days'], ['90', '90 days']])] },
  { id: 'watchlist', category: 'market', icon: '⭐', title: 'Watchlist', blurb: 'Your starred items with Jita\'s lowest ask and highest bid — the book, not a promise.', sizes: ['M', 'L'], dest: 'trade:explorer', needs: 'items starred in the Item Explorer' },
  // ---- battle
  { id: 'last-fights', category: 'battle', icon: '⚔', title: 'Latest fights', blurb: 'The corp\'s most recent fights as posters — ships, ISK, who, where.', sizes: ['M', 'L'], dest: 'battle:reports', needs: 'Battle Reports opened once this session' },
  { id: 'kill-feed', category: 'battle', icon: '☠', title: 'Kill feed', blurb: 'The corp\'s newest kills and losses, hull by hull.', sizes: ['M', 'L'], dest: 'battle:reports', needs: BOARD },
  { id: 'my-record', category: 'battle', icon: '🎖', title: 'My pilots\' record', blurb: 'Your own characters on the public killmails: kills, losses, ISK both ways.', sizes: ['S', 'M', 'L'], dest: 'battle:board', needs: BOARD, options: [KILL_RANGE] },
  { id: 'fight-hours', category: 'battle', icon: '🌙', title: 'When we fight', blurb: 'The corp\'s kills and losses by EVE hour of day — when the content happens.', sizes: ['M', 'L'], dest: 'battle:board', needs: BOARD, options: [KILL_RANGE] },
  // ---- corp
  { id: 'lb-medals', category: 'corp', icon: '🏆', title: 'Leaderboard', blurb: 'The corp\'s medals table — and where your own pilots stand on it.', sizes: ['S', 'M', 'L'], dest: 'battle:board', needs: BOARD, options: [KILL_RANGE] },
  { id: 'lb-board', category: 'corp', icon: '🥇', title: 'Board leader', blurb: 'One leaderboard of your choice — most kills, heavy hitter, whale hunter… — and its top pilots.', sizes: ['S', 'M', 'L'], dest: 'battle:board', needs: BOARD,
    options: [pick('board', 'board', 'kills', BOARDS.map((b) => [b.id, b.title] as [string, string])), KILL_RANGE] },
  { id: 'corp-totals', category: 'corp', icon: '📯', title: 'The corp\'s week', blurb: 'Kills, losses, ISK both ways and efficiency — the corp\'s scoreline.', sizes: ['S', 'M', 'L'], dest: 'battle:board', needs: BOARD, options: [KILL_RANGE] },
  { id: 'corp-hulls', category: 'corp', icon: '🚀', title: 'What the corp flies', blurb: 'The hulls corp pilots are on killmails in the most — and how many were lost.', sizes: ['M', 'L'], dest: 'battle:board', needs: BOARD, options: [KILL_RANGE] },
  { id: 'corp-enemies', category: 'corp', icon: '🤺', title: 'Who we meet', blurb: 'The corporations on the other side most often: kills on them, losses to them.', sizes: ['M', 'L'], dest: 'battle:board', needs: BOARD, options: [KILL_RANGE] },
  { id: 'lb-movers', category: 'corp', icon: '📈', title: 'Movers', blurb: 'Who climbed the medals table since the window before — and who slipped.', sizes: ['M', 'L'], dest: 'battle:board', needs: BOARD, options: [pick('range', 'range', '7', [['1', '24 hours'], ['3', '3 days'], ['7', '7 days'], ['30', '30 days']])] },
  { id: 'corp-records', category: 'corp', icon: '🏛', title: 'Hall of fame', blurb: 'The window\'s records: biggest kill, hardest hit, longest streak, biggest turnout.', sizes: ['M', 'L'], dest: 'battle:board', needs: BOARD, options: [KILL_RANGE] },
  { id: 'corp-days', category: 'corp', icon: '📆', title: 'The corp\'s days', blurb: 'Kills above the line, losses below — one bar per EVE day.', sizes: ['M', 'XL'], dest: 'battle:board', needs: BOARD, options: [pick('range', 'range', '30', [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', '1 year']])] },
  // ---- pilots
  { id: 'pilots', category: 'pilots', icon: '🧑‍🚀', title: 'Where everyone is', blurb: 'Each of your characters: the system and hull the app last saw them in.', sizes: ['M', 'L'], dest: 'character:match', needs: 'characters logged in' },
  { id: 'logins', category: 'pilots', icon: '🔑', title: 'Logins', blurb: 'Whose EVE session the app can still use — and who needs logging in again.', sizes: ['S', 'M', 'L'], dest: '', needs: 'characters logged in' },
  // ---- utility
  { id: 'eve-clock', category: 'app', icon: '🕚', title: 'EVE time', blurb: 'EVE\'s clock and the countdown to daily downtime.', sizes: ['S', 'M'], dest: '' },
  { id: 'collectors', category: 'app', icon: '🩺', title: 'Collectors', blurb: 'Is the app keeping up? Every background collector, its last success and next run.', sizes: ['M', 'L'], dest: '' },
  { id: 'esi-budget', category: 'app', icon: '🚦', title: 'ESI budget', blurb: 'EVE\'s shared error budget and which of the app\'s lanes are paused because of it.', sizes: ['S', 'M'], dest: '' },
  { id: 'notes', category: 'app', icon: '📝', title: 'Note', blurb: 'A sticky note of your own — a doctrine reminder, a shopping list, a timer to remember.', sizes: ['S', 'M', 'L'], dest: '',
    options: [{ key: 'text', label: 'note', def: '', text: { max: 600, placeholder: 'type your note…' } }] },
  { id: 'shortcuts', category: 'app', icon: '🧷', title: 'Shortcuts', blurb: 'Your favorites as big buttons — saved views included.', sizes: ['M', 'L'], dest: '', needs: 'tabs pinned with the ☆ in the header' },
  { id: 'whats-new', category: 'app', icon: '🎁', title: 'What\'s new', blurb: 'The headline of the version you are running, and the ones before it.', sizes: ['M', 'L'], dest: '' },
];

export const dashletOf = (id: string): DashletSpec | undefined => DASHLETS.find((d) => d.id === id);
export const sizesOf = (id: string): readonly DashSize[] | null => dashletOf(id)?.sizes ?? null;
export const byCategory = (c: DashCategory): DashletSpec[] => DASHLETS.filter((d) => d.category === c);
/** an option's value: a pick-one falls back to its default when the stored value is not a choice;
 * free text is whatever was typed, cut to its limit */
export function optionOf(spec: DashletSpec, cfg: Record<string, string> | undefined, key: string): string {
  const o = spec.options?.find((x) => x.key === key);
  if (!o) return '';
  const v = cfg?.[key];
  if (o.text) return (v ?? o.def).slice(0, o.text.max);
  return v !== undefined && !!o.choices?.some((c) => c.v === v) ? v : o.def;
}
const choiceLabel = (spec: DashletSpec, cfg: Record<string, string> | undefined, key: string): string =>
  spec.options?.find((o) => o.key === key)?.choices?.find((c) => c.v === optionOf(spec, cfg, key))?.label ?? '';
/** the title on the dashlet: the option that names it rides along ("Gneiss finder", "… · 7 days") */
export function dashTitle(spec: DashletSpec, cfg: Record<string, string> | undefined): string {
  if (spec.id === 'chain-ore') return `${optionOf(spec, cfg, 'rock')} finder`;
  if (spec.id === 'chain-gas') return `${optionOf(spec, cfg, 'gas')} finder`;
  if (spec.id === 'chain-activity') return `${optionOf(spec, cfg, 'activity')} sites`;
  if (spec.id === 'chain-near') return `Within ${choiceLabel(spec, cfg, 'jumps')}`;
  const base = spec.id === 'lb-board' ? choiceLabel(spec, cfg, 'board') : spec.id === 'corp-totals' ? 'The corp' : spec.title;
  const range = spec.options?.some((o) => o.key === 'range') ? choiceLabel(spec, cfg, 'range') : '';
  return range ? `${base} · ${range}` : base;
}

// ---- WHAT CANNOT WORK TODAY (v0.245.0)
/** the store's banner and the reason the ＋ add button is off; said in full because a stranger reads it first */
export const UNAVAILABLE_REASON = 'Temporarily unavailable — the Aperture map link is switched off while how the app works with Aperture is reworked with its developer (Help → Aperture says why). The app does not contact Aperture at all; this dashlet comes back with the integration.';
/** why a dashlet cannot work right now, or null. The chain shelf and the ore/gas finders read the corp map,
 * and the haul log is fed from the Σ Summary — all switched off with the Aperture link. The store dims these,
 * shows the reason, will not add them; the starter board skips them. When the integration returns
 * (APERTURE_FEATURES_AVAILABLE), every one of them comes back by itself. */
export function dashletUnavailable(spec: DashletSpec): string | null {
  if (APERTURE_FEATURES_AVAILABLE) return null;
  return spec.needs === MAP || spec.id === 'hauls' ? UNAVAILABLE_REASON : null;
}
/** what "✨ start me off" lays down: one of each shelf, sized to read well together */
export const STARTER: [string, DashSize][] = [
  ['chain-isk', 'L'], ['chain-ways', 'L'], ['raid-windows', 'L'], ['eve-clock', 'S'], ['logins', 'S'],
  ['pi-planets', 'M'], ['net-worth', 'M'], ['chain-exits', 'M'],
  ['lb-medals', 'L'], ['kill-feed', 'L'], ['profit-days', 'M'], ['pi-resets', 'M'], ['market-events', 'M'], ['shortcuts', 'M'],
];
/** the starter list minus what cannot work today (v0.245.0) */
export const starterItems = (): [string, DashSize][] => STARTER.filter(([kind]) => { const s = dashletOf(kind); return !s || dashletUnavailable(s) === null; });
