import { useEffect, useMemo, useRef, useState } from 'react';
import SearchBar from './components/SearchBar';
import Sidebar from './components/Sidebar';
import HubTable from './components/HubTable';
import ArbitragePanel from './components/ArbitragePanel';
import HistoryChart from './components/HistoryChart';
import SettingsModal from './components/SettingsModal';
import { HelpButton, IntroTour } from './components/Help';
import TradeFinder from './components/TradeFinder';
import MistakeFinder from './components/MistakeFinder';
import AutoHaul from './components/AutoHaul';
import MyOrders from './components/MyOrders';
import Dashboard from './components/Dashboard';
import SellingChip from './components/SellingChip';
import StockChip from './components/StockChip';
import { useApp, useHubs, type ModuleId } from './lib/store';
import { useAuth, shortLabel, charLabel } from './lib/auth';
import { useMyMarket } from './lib/myMarket';
import { useStock } from './lib/stock';
import { openMarketWindowEverywhere, lastTeamOrderFailures } from './lib/esiChar';
import { usePrices } from './lib/priceStore';
import { syncAllLedgers } from './lib/ledger';
import { runTrendsTick, TRENDS_INTERVAL_MS } from './lib/trends';
import { snapshotNetWorth } from './lib/networth';
import { runRadarTick, restoreRadarWip, RADAR_INTERVAL_MS } from './lib/radar';
import { runRaidWatchTick, restoreRaidWip, RAID_WATCH_INTERVAL_MS } from './lib/raidWatch';
import { runShipWatchTick, primeShipHistory, SHIP_WATCH_INTERVAL_MS } from './lib/shipHistory';
import { runPiTick, PI_INTERVAL_MS, piCharacters } from './lib/pi';
import { initTooltips } from './lib/tooltip';
import { initActivity, isIdle } from './lib/activity';
import { esiErrorState } from './lib/esiRate';
import { loadSetup, needsSetup } from './lib/appConfig';
import { initDevLog, logUser, logState, logRun } from './lib/devlog';
import BattleReports from './components/BattleReports';
import LiveCombat from './components/LiveCombat';
import BattleSim from './components/BattleSim';
import { warmDogmaWorker } from './lib/dogmaClient';
import Radar from './components/Radar';
import CharacterConductor from './components/CharacterConductor';
import TheftConductor from './components/TheftConductor';
import ApertureModule from './components/ApertureModule';
import PiModule from './components/PiModule';
import ItemGroups from './components/ItemGroups';
import Trends from './components/Trends';
import { startOverlayFeed, stopOverlayFeed } from './lib/overlayFeed';
import { useFreshness, countdown } from './lib/freshness';
import { getType, typeCount } from './lib/typedb';
import { m3 } from './lib/format';

// from package.json at build time (vite `define`) — a hardcoded copy silently
// went stale at 0.61.4 and stamped every diagnostic log line with the wrong
// version, which is exactly the field you need to trust when reading them back
const APP_VERSION = __APP_VERSION__;

const ALL_MODULES: ModuleId[] = ['trade', 'character', 'battle', 'theft', 'pi', 'aperture'];
const MODULE_TITLE: Record<ModuleId, string> = {
  trade: 'Trade Conductor',
  character: 'Skill & Fit Conductor',
  battle: 'Battle Conductor',
  theft: 'Theft Conductor',
  pi: 'Planetary Industry',
  aperture: 'Aperture',
};

/** `secondaryModule` marks a pop-out window: it shows one module with EVERY
 * background collector off (only the main window collects), and keeps its
 * module in local state so it never rewrites the main window's persisted view. */
export default function App({ secondaryModule = null }: { secondaryModule?: string | null }) {
  const secondary = !!secondaryModule;
  const hubs = useHubs();
  const selected = useApp((s) => s.selectedTypeId);
  const watchlist = useApp((s) => s.watchlist);
  const toggleWatch = useApp((s) => s.toggleWatch);
  const view = useApp((s) => s.activeView);
  const stationTradeIds = useApp((s) => s.stationTradeIds);
  const toggleStationTrade = useApp((s) => s.toggleStationTrade);
  const setView = useApp((s) => s.setView);
  const storeModule = useApp((s) => s.activeModule);
  const storeSetModule = useApp((s) => s.setModule);
  const [localModule, setLocalModule] = useState<ModuleId>(
    secondaryModule && (ALL_MODULES as string[]).includes(secondaryModule)
      ? (secondaryModule as ModuleId)
      : 'trade',
  );
  const module: ModuleId = secondary ? localModule : storeModule;
  const setModule = secondary ? setLocalModule : storeSetModule;
  const charMode = useApp((s) => s.charCompare.mode);
  const setCharCompare = useApp((s) => s.setCharCompare);
  const [moduleMenu, setModuleMenu] = useState(false);
  const [charMenu, setCharMenu] = useState(false);
  const [toolsMenu, setToolsMenu] = useState(false);
  /** Theft Conductor tabs: the skyhook raid table vs the (weaker) ESS list */
  const [theftView, setTheftView] = useState<'skyhooks' | 'ess'>('skyhooks');
  /** Battle Conductor tabs: saved battle reports vs the live game-log feed */
  const [battleView, setBattleView] = useState<'reports' | 'live' | 'sim'>('reports');
  // MAKE BATTLE REPORT moved into the EVE Battle Conductor module
  // (components/BattleReports.tsx) in v0.101.0 — the Tools entry now just
  // switches there.
  const [overlayOn, setOverlayOn] = useState(false);
  // the overlay is a separate always-on-top window fed by THIS window.
  // IT OUTLIVES US: if this window reloads (or is reopened from the tray)
  // while the overlay is up, the feed must resume — otherwise the overlay
  // keeps displaying whatever it last received, forever.
  const overlayAutoStart = useApp((s) => s.settings.overlayAutoStart);
  useEffect(() => {
    if (secondary) return; // only the main window owns the overlay
    void window.appInfo?.overlay?.isOpen().then((open) => {
      // already up (this window reloaded) — reattach the feed
      if (open) { setOverlayOn(true); return; }
      // OTHERWISE START IT. The pod alert exists to stop you undocking in the
      // wrong clone; one you have to remember to switch on is one that is off
      // on the day it mattered. Gated on having characters so a fresh install
      // does not get an empty floating window it did not ask for.
      if ((overlayAutoStart ?? true) && useAuth.getState().characters.length > 0) {
        void window.appInfo?.overlay?.set(true).then((ok) => { if (ok) setOverlayOn(true); });
      }
    });
    // deliberately once, at startup: this is "auto-start", not "keep forcing on"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (secondary) return; // the overlay feed is pushed by the main window only
    if (overlayOn) startOverlayFeed(); else stopOverlayFeed();
    return () => stopOverlayFeed();
  }, [overlayOn, secondary]);
  // the on/off toggle lives in the Clones & Alerts window now (v0.139) — the
  // main process broadcasts every open/close so THIS window's feed follows,
  // whichever window (or the toggle) flipped it
  useEffect(() => {
    window.appInfo?.overlay?.onOpenChanged?.((on) => setOverlayOn(on));
  }, []);
  const refresh = usePrices((s) => s.refresh);
  const loading = usePrices((s) => s.loading);
  const error = usePrices((s) => s.error);
  const lastUpdated = usePrices((s) => s.lastUpdated);
  const characters = useAuth((s) => s.characters);
  const activeId = useAuth((s) => s.activeId);
  const setActive = useAuth((s) => s.setActive);
  const characterId = activeId; // the character the app acts as
  const [showSettings, setShowSettings] = useState(false);
  const alwaysOnTop = useApp((s) => s.settings.alwaysOnTop);
  const closeToTray = useApp((s) => s.settings.closeToTray);
  // the Multibox Overlay Settings WINDOW edits raidAlert/raidAlertJumps by
  // patching localStorage directly (a whole-store write from a second window
  // would clobber this one's state). The cross-window 'storage' event is how
  // this window's in-memory store learns of the change — targeted, two keys.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'eve-trade-conductor' || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue) as {
          state?: { settings?: { raidAlert?: boolean; raidAlertJumps?: number }; alerts?: { piOverlay?: boolean } };
        };
        const s = parsed.state?.settings;
        if (s) {
          const cur = useApp.getState().settings;
          if (s.raidAlert !== cur.raidAlert || s.raidAlertJumps !== cur.raidAlertJumps) {
            useApp.getState().setSettings({ raidAlert: s.raidAlert, raidAlertJumps: s.raidAlertJumps });
          }
        }
        // the PI-overlay toggle (v0.179) is patched the same way — and was
        // NOT adopted here, so this window's next persist wrote its stale
        // in-memory `alerts` back over the patch and the 🪐 box never went
        // away (beta report, v0.196.1). Measured: false → one set() → gone.
        const a = parsed.state?.alerts;
        if (a && a.piOverlay !== useApp.getState().alerts.piOverlay) {
          useApp.getState().setAlerts({ piOverlay: a.piOverlay });
        }
      } catch { /* not our payload */ }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // window behavior lives in the main process — push the persisted settings on
  // boot and whenever the toggles change (?? = settings saved before v0.47)
  // window behavior is a MAIN-window concern: the main process applies these
  // to its always-on-top target and its tray, so a pop-out must not push them
  useEffect(() => {
    if (secondary) return;
    void window.appInfo?.win?.setAlwaysOnTop(alwaysOnTop ?? false);
  }, [alwaysOnTop, secondary]);
  useEffect(() => {
    if (secondary) return;
    void window.appInfo?.win?.setCloseToTray(closeToTray ?? true);
  }, [closeToTray, secondary]);

  const typeIds = useMemo(
    () => [...new Set([...(selected ? [selected] : []), ...watchlist])],
    [selected, watchlist],
  );
  const hubsKey = hubs.map((h) => h.id).join(',');
  const idsKey = typeIds.join(',');

  useEffect(() => {
    refresh(hubs, typeIds);
    // keys capture the meaningful identity of hubs/typeIds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubsKey, idsKey]);

  // "already selling" markers need my live orders — refreshed app-wide (~5 min TTL);
  // "you have stock" markers need actual hangar assets (~30 min TTL)
  const ensureMyMarket = useMyMarket((s) => s.ensureFresh);
  const ensureStock = useStock((s) => s.ensureFresh);
  useEffect(() => {
    void ensureMyMarket();
    void ensureStock();
  }, [ensureMyMarket, ensureStock, characterId, view]);

  // ---- self-updating data loop ----
  // Prices (Fuzzwork has no expiry header): poll, hash, LEARN the real update
  // cadence from observed content changes. Wallet ledger: quiet auto-sync.
  const pricesFresh = useFreshness((s) => s.sources['prices']);
  const walletFresh = useFreshness((s) => s.sources['wallet']);
  const ordersFresh = useFreshness((s) => s.sources['orders']);
  const [, tick] = useState(0);
  const pricesBusy = useRef(false);
  const walletBusy = useRef(false);
  const trendsBusy = useRef(false);
  const nwBusy = useRef(false);
  const radarBusy = useRef(false);
  const raidBusy = useRef(false);
  const shipBusy = useRef(false);
  const piBusy = useRef(false);
  const [radarProgress, setRadarProgress] = useState('');
  // WIP restores prime the COLLECTORS — a pop-out never runs them
  useEffect(() => { if (!secondary) void restoreRadarWip(); }, [secondary]);
  useEffect(() => { void primeShipHistory(); }, []); // read-only, Live Combat needs it
  useEffect(() => { if (charMode === 'battle') { setCharCompare({ mode: 'fit' }); } }, [charMode, setCharCompare]);
  useEffect(() => { if (!secondary) void restoreRaidWip(); }, [secondary]);
  useEffect(() => { initTooltips(); }, []);
  useEffect(() => { initActivity(); }, []);
  // the diagnostic log: what the app did, and what the user was doing when it
  // did it. Started before anything else so a boot failure still lands.
  useEffect(() => { initDevLog(APP_VERSION); }, []);
  // a new version downloaded itself in the background (electron-updater,
  // fed by the public releases repo) — offer the restart, never force it
  const [updateReady, setUpdateReady] = useState<string | null>(null);
  useEffect(() => {
    window.appInfo?.updates?.onReady((info) => setUpdateReady(info.version || 'update'));
  }, []);
  // boot the dogma worker at start so its ~250 ms SDE decode never lands on a
  // click. Only this window: the overlay and clone-config routes load the same
  // bundle and never score a fit (dogmaClient checks the hash).
  useEffect(() => { warmDogmaWorker(); }, []);
  // per-player setup comes from a file, not from the code — load it before
  // anything that reads a client id, a transit ship or the Aperture URL
  const [setupLoaded, setSetupLoaded] = useState(false);
  useEffect(() => { void loadSetup().finally(() => setSetupLoaded(true)); }, []);
  // FIRST RUN: with no EVE application there is nothing to log in with, and
  // every other problem the user might chase is downstream of that. Say so
  // once, plainly, instead of letting them find empty screens.
  const unconfigured = setupLoaded && needsSetup() && characters.length === 0;
  // WHAT IS ON SCREEN — the timeline of the session (grep '"area":"user"')
  useEffect(() => { logUser(`module: ${module}`); }, [module]);
  // a pop-out's taskbar/label should name its module, not read "EVE Conductor",
  // and it reports that module to main so the saved window layout stays accurate
  useEffect(() => {
    if (secondary) {
      document.title = `EVE Conductor — ${MODULE_TITLE[module]}`;
      window.appInfo?.win?.reportModule?.(module);
    }
  }, [secondary, module]);
  useEffect(() => { logUser(`view: ${view}`); }, [view]);
  useEffect(() => { logState('session', 'characters', characters.length); }, [characters.length]);
  useEffect(() => { logUser(`overlay ${overlayOn ? 'ON' : 'off'}`); }, [overlayOn]);
  useEffect(() => {
    // THE COLLECTORS RUN IN THE MAIN WINDOW ONLY. A pop-out shares the same
    // localStorage and NDJSON files; a second collector loop would double the
    // ESI spend and race the history writes (RULE 3 — integrity over points).
    if (secondary) return;
    const t = setInterval(() => {
      tick((x) => x + 1); // renders the statusbar countdowns
      const f = useFreshness.getState();
      const now = Date.now();
      // WATCHLIST PRICES ARE A SCREEN, NOT A RECORD. They exist to keep the
      // table in front of the user current; nobody needs them refreshed for
      // an hour of an empty chair, and that spend comes out of the same ESI
      // budget as the overlay and any running fit push. Any click, key or
      // scroll wakes this on the very next tick (see activity.ts). The
      // permanent collectors below are deliberately NOT gated — their whole
      // point is the hours the user is away, and they cannot backfill.
      const prices = f.sources['prices'];
      if (!isIdle() && !pricesBusy.current && (!prices || (prices.nextAt !== null && now >= prices.nextAt))) {
        pricesBusy.current = true;
        void logRun('prices', 'refresh', () => refresh(hubs, typeIds, true))
          .then(() => {
            const book = usePrices.getState().book;
            const hash = typeIds
              .map((id) => `${id}:${book['jita']?.[id]?.sell.min ?? 0}:${book['jita']?.[id]?.buy.max ?? 0}`)
              .join('|');
            f.reportLearned('prices', hash, 5 * 60_000);
          })
          // a failed refresh must back off like every other collector, not
          // sit there claiming the prices on screen are current
          .catch(() => f.fail('prices'))
          .finally(() => {
            pricesBusy.current = false;
          });
      }
      const wallet = f.sources['wallet'];
      if (
        characterId &&
        !walletBusy.current &&
        (!wallet || (wallet.nextAt !== null && now >= wallet.nextAt))
      ) {
        walletBusy.current = true;
        logRun('wallet', 'tick', () => syncAllLedgers())
          .then(() => f.reportHeader('wallet', 10 * 60_000))
          .catch(() => f.fail('wallet'))
          .finally(() => {
            walletBusy.current = false;
          });
      }
      // trading-value snapshots for the Dashboard's master chart (~30 min)
      const nw = f.sources['networth'];
      if (
        characterId &&
        !nwBusy.current &&
        (!nw || (nw.nextAt !== null && now >= nw.nextAt))
      ) {
        nwBusy.current = true;
        logRun('networth', 'tick', () => snapshotNetWorth())
          .then(() => f.reportHeader('networth', 30 * 60_000))
          .catch(() => f.fail('networth'))
          .finally(() => {
            nwBusy.current = false;
          });
      }
      // FULL-MARKET RADAR: whole-region book snapshots, ~30 min
      const radar = f.sources['radar'];
      if (
        characterId &&
        !radarBusy.current &&
        (!radar || (radar.nextAt !== null && now >= radar.nextAt))
      ) {
        radarBusy.current = true;
        logRun('radar', 'tick', () => runRadarTick(setRadarProgress))
          .then(() => f.reportHeader('radar', RADAR_INTERVAL_MS))
          .catch(() => f.fail('radar'))
          .finally(() => {
            radarBusy.current = false;
            setRadarProgress('');
          });
      }
      // RAID WATCHER (Theft Conductor): diff CCP's raidable-skyhook feed so
      // "vanished mid-window" = someone robbed it. PUBLIC data — runs without
      // a login, and regardless of which module is on screen.
      const raid = f.sources['raidwatch'];
      if (!raidBusy.current && (!raid || (raid.nextAt !== null && now >= raid.nextAt))) {
        raidBusy.current = true;
        logRun('raidwatch', 'tick', () => runRaidWatchTick())
          .then(() => f.reportHeader('raidwatch', RAID_WATCH_INTERVAL_MS))
          .catch(() => f.fail('raidwatch'))
          .finally(() => {
            raidBusy.current = false;
          });
      }
      // SHIP HISTORY: record each logged-in character's hull + system when it
      // changes, so Live Combat can draw a real ship band. Cheap, authed,
      // background lane — runs regardless of module or overlay.
      const shipw = f.sources['shipwatch'];
      if (useAuth.getState().characters.some((c) => c.refreshToken)
        && !shipBusy.current && (!shipw || (shipw.nextAt !== null && now >= shipw.nextAt))) {
        shipBusy.current = true;
        logRun('shipwatch', 'tick', () => runShipWatchTick())
          .then(() => f.reportHeader('shipwatch', SHIP_WATCH_INTERVAL_MS))
          .catch(() => f.fail('shipwatch'))
          .finally(() => {
            shipBusy.current = false;
          });
      }
      // PLANETARY INDUSTRY: the only thing in EVE that silently throws away
      // production when you are not looking. ESI caches planets for 10 min,
      // so asking more often than that just spends error budget.
      const pi = f.sources['pi'];
      if (
        piCharacters().length > 0 &&
        !piBusy.current &&
        (!pi || (pi.nextAt !== null && now >= pi.nextAt))
      ) {
        piBusy.current = true;
        logRun('pi', 'tick', () => runPiTick())
          .then(() => f.reportHeader('pi', PI_INTERVAL_MS))
          .catch(() => f.fail('pi'))
          .finally(() => {
            piBusy.current = false;
          });
      }
      // trend watcher: outbid/sale events, always on while the app is open
      const trends = f.sources['trends'];
      if (
        characterId &&
        !trendsBusy.current &&
        (!trends || (trends.nextAt !== null && now >= trends.nextAt))
      ) {
        trendsBusy.current = true;
        logRun('trends', 'tick', () => runTrendsTick())
          .then(() => f.reportHeader('trends', TRENDS_INTERVAL_MS))
          .catch(() => f.fail('trends'))
          .finally(() => {
            trendsBusy.current = false;
          });
      }
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubsKey, idsKey, characterId]);

  // recomputed on every statusbar tick (the 1s interval above)
  const esiState = esiErrorState('bulk');
  logState('esi', 'paused', esiState.pausedLanes.join(',') || 'none',
    { remain: esiState.remain, hardBlocked: esiState.hardBlocked });

  const item = selected ? getType(selected) : undefined;
  const watched = selected !== null && watchlist.includes(selected);

  return (
    <div className="app">
      {updateReady && (
        <div className="statusbar" style={{ background: 'rgba(61,153,112,.18)', justifyContent: 'center' }}>
          <span>
            <b>EVE Conductor {updateReady} is ready</b> — downloaded in the background; it
            installs when the app restarts. Collectors pick up where they left off.
          </span>
          <button className="btn mini" onClick={() => void window.appInfo?.updates?.restart()}>
            Restart now
          </button>
        </div>
      )}
      {unconfigured && (
        <div className="statusbar" style={{ background: 'var(--warn-bg, #3a2c00)', justifyContent: 'center' }}>
          <span>
            <b>Set up your EVE application to begin</b> — Settings → “Set up your EVE application”.
            It is free, takes about a minute, and your logins stay yours.
          </span>
          <button className="btn mini" onClick={() => setShowSettings(true)}>Open Settings</button>
        </div>
      )}
      <header className="header">
        <div className="brand-wrap">
          <button className="brand" onClick={() => setModuleMenu((m) => !m)}
            title="Switch between Conductor modules. Background collectors (radar, trends, wallet, net-worth) keep running no matter which module is open.">
            {module === 'aperture' ? <span>Aperture</span> : module === 'pi' ? (
              <>EVE <span>Planetary Industry</span></>
            ) : (
              <>EVE <span>{module === 'trade' ? 'Trade Conductor'
                : module === 'character' ? 'Skill & Fit Conductor'
                  : module === 'battle' ? 'Battle Conductor' : 'Theft Conductor'}</span></>
            )} ▾
          </button>
          {moduleMenu && (
            <div className="module-menu" onMouseLeave={() => setModuleMenu(false)}>
              <div className="module-menu-head">EVE Conductor</div>
              <button className={module === 'trade' ? 'on' : ''}
                onClick={() => { setModule('trade'); setModuleMenu(false); }}>
                EVE Trade Conductor
                <span className="dim">market radar · orders · hauling</span>
              </button>
              <button className={module === 'character' ? 'on' : ''}
                onClick={() => { setModule('character'); setModuleMenu(false); }}>
                EVE Skill &amp; Fit Conductor
                <span className="dim">skill match · fit skill maxer</span>
              </button>
              <button className={module === 'battle' ? 'on' : ''}
                onClick={() => { setModule('battle'); setModuleMenu(false); }}>
                EVE Battle Conductor
                <span className="dim">battle reports · fight write-ups</span>
              </button>
              <button className={module === 'theft' ? 'on' : ''}
                onClick={() => { setModule('theft'); setModuleMenu(false); }}>
                EVE Theft Conductor
                <span className="dim">skyhook raid windows · ESS systems</span>
              </button>
              <button className={module === 'pi' ? 'on' : ''}
                onClick={() => { setModule('pi'); setModuleMenu(false); }}>
                EVE Planetary Industry
                <span className="dim">planet fullness · pickup timing · extractor resets</span>
              </button>
              <button className={module === 'aperture' ? 'on' : ''}
                onClick={() => { setModule('aperture'); setModuleMenu(false); }}>
                Aperture
                <span className="dim">the corp map, embedded</span>
              </button>
            </div>
          )}
        </div>
        <nav className="tabs">
          {module === 'character' && (<>
            <button className={charMode !== 'fit' && charMode !== 'wizard' && charMode !== 'propagator' && charMode !== 'battle' ? 'on' : ''}
              onClick={() => setCharCompare({ mode: 'match' })}>
              Skill Match
            </button>
            <button className={charMode === 'fit' ? 'on' : ''}
              onClick={() => setCharCompare({ mode: 'fit' })}>
              Fit Skill Maxer
            </button>
            <button className={charMode === 'wizard' ? 'on' : ''}
              onClick={() => setCharCompare({ mode: 'wizard' })}>
              Fit Wizard
            </button>
            <button className={charMode === 'propagator' ? 'on' : ''}
              onClick={() => setCharCompare({ mode: 'propagator' })}>
              Fit Propagator
            </button>
          </>)}
          {module === 'battle' && (<>
            <button className={battleView === 'reports' ? 'on' : ''}
              onClick={() => { setBattleView('reports'); logUser('view: battle reports'); }}>
              Battle Reports
            </button>
            <button className={battleView === 'live' ? 'on' : ''}
              onClick={() => { setBattleView('live'); logUser('view: log visualizer'); }}>
              Log Visualizer
            </button>
            <button className={battleView === 'sim' ? 'on' : ''}
              onClick={() => { setBattleView('sim'); logUser('view: battle sim'); }}>
              Battle Sim
            </button>
          </>)}
          {module === 'theft' && (<>
            <button className={theftView === 'skyhooks' ? 'on' : ''}
              onClick={() => { setTheftView('skyhooks'); logUser('view: skyhooks'); }}>
              Skyhooks
            </button>
            <button className={theftView === 'ess' ? 'on' : ''}
              onClick={() => { setTheftView('ess'); logUser('view: ess'); }}>
              ESS
            </button>
          </>)}
          {module === 'pi' && <button className="on">Planets</button>}
          {module === 'aperture' && <button className="on">Corp Map</button>}
          {module === 'trade' && (<>
          <button className={view === 'finder' ? 'on' : ''} onClick={() => setView('finder')}>
            Trade Finder
          </button>
          <button className={view === 'autohaul' ? 'on' : ''} onClick={() => setView('autohaul')}>
            Auto Haul
          </button>
          <button className={view === 'orders' ? 'on' : ''} onClick={() => setView('orders')}>
            My Orders
          </button>
          <button className={view === 'trends' ? 'on' : ''} onClick={() => setView('trends')}>
            Trends
          </button>
          <button className={view === 'radar' ? 'on' : ''} onClick={() => setView('radar')}>
            Radar
          </button>
          <button className={view === 'dashboard' ? 'on' : ''} onClick={() => setView('dashboard')}>
            Dashboard
          </button>
          <button className={view === 'explorer' ? 'on' : ''} onClick={() => setView('explorer')}>
            Item Explorer
          </button>
          <button className={view === 'groups' ? 'on' : ''} onClick={() => setView('groups')}>
            Groups
          </button>
          </>)}
        </nav>
        {module === 'trade' && <SearchBar />}
        {/* the Skill & Fit module has its own character sidebar — a second
            picker in the header only confuses which one is in charge */}
        {characters.length > 0 && module !== 'character' && (() => {
          // the trade module's list hides characters WITHOUT a duty (a fleet
          // alt logged in for other modules shouldn't clutter trading)
          const listChars = module === 'trade' ? characters.filter((c) => c.tradeRole) : characters;
          const active = characters.find((c) => c.characterId === activeId) ?? characters[0];
          return (
            <div className="char-menu-wrap">
              <button className="char-bubble" onClick={() => setCharMenu((m) => !m)}
                title={`${charLabel(active)}${active.role ? ` — ${active.role}` : ''} · the ACTIVE character (wallet %, location, ship, in-game windows) · click to switch`}>
                <img src={`https://images.evetech.net/characters/${active.characterId}/portrait?size=64`} alt="" />
              </button>
              {charMenu && (
                <div className="char-menu" onMouseLeave={() => setCharMenu(false)}>
                  {listChars.map((c) => (
                    <button key={c.characterId}
                      className={c.characterId === activeId ? 'on' : ''}
                      onClick={() => { setActive(c.characterId); setCharMenu(false); }}>
                      <img src={`https://images.evetech.net/characters/${c.characterId}/portrait?size=64`} alt="" />
                      <span>
                        <span className="char-menu-name">{charLabel(c)}</span>
                        <span className="dim" style={{ display: 'block', fontSize: 11 }}>{c.characterName}</span>
                      </span>
                      {c.characterId === activeId && <span className="flag good">active</span>}
                    </button>
                  ))}
                  {listChars.length === 0 && (
                    <div className="hint" style={{ padding: 8 }}>
                      No characters with a duty — assign duties in Settings.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
        <button
          className="btn"
          onClick={() => { void refresh(hubs, typeIds, true).catch(() => {}); }}
          disabled={loading}
          title="Force refresh prices"
        >
          {loading ? <span className="spin">⟳</span> : '⟳'} Refresh
        </button>
        {/* Tools shows in EVERY window (v0.138) — it was hidden in pop-outs,
            and with pop-outs restoring at launch (v0.136) the user's working
            window is often a pop-out, so "the Tools button disappeared". All
            its actions route through the main process, so any window may
            trigger them. */}
        <div className="char-menu-wrap">
          <button className="btn" onClick={() => setToolsMenu((m) => !m)}
            title="Overlay tools that float over the EVE clients">
            Tools ▾
          </button>
          {toolsMenu && (
            <div className="module-menu" onMouseLeave={() => setToolsMenu(false)}>
              <div className="module-menu-head">Overlays</div>
              <button onClick={() => {
                void window.appInfo?.clones?.openConfig();
                setToolsMenu(false);
              }}>
                ⚑ Multibox overlay settings…
                <span className="dim">
                  overlay on/off, pod names &amp; alerts, notification box, raid alert — Alt+\ in game works too
                </span>
              </button>
            </div>
          )}
        </div>
        {window.appInfo?.win?.openModule && (
          <button className="btn icon"
            title={`Open ${MODULE_TITLE[module]} in a new window — a second window you can place on another monitor. Collectors keep running in the main window only.`}
            onClick={() => void window.appInfo?.win?.openModule?.(module)}>
            ⧉
          </button>
        )}
        <HelpButton module={module}
          section={module === 'trade' ? view
            : module === 'battle' ? battleView
              : module === 'theft' ? theftView
                : module === 'character' ? (charMode === 'fit' || charMode === 'wizard' || charMode === 'propagator' ? charMode : 'match')
                  : module === 'pi' ? 'planets' : undefined} />
        <button className="btn icon" onClick={() => setShowSettings(true)} title="Trading settings">
          ⚙
        </button>
      </header>
      <div className={`main ${module === 'trade' && view === 'explorer' ? '' : 'no-side'}`}>
        {module === 'character' && (
          <div className="content">
            <CharacterConductor />
          </div>
        )}
        {module === 'battle' && (
          <div className="content">
            {battleView === 'reports' ? <BattleReports /> : battleView === 'live' ? <LiveCombat /> : <BattleSim />}
          </div>
        )}
        {module === 'theft' && (
          <div className="content">
            <TheftConductor view={theftView} />
          </div>
        )}
        {/* .content is load-bearing: without the scroll container the PI grid
            overflowed the app shell, the PAGE itself scrolled, and the
            statusbar (fixed at the shell's bottom) appeared stranded mid-list */}
        {module === 'pi' && <div className="content"><PiModule /></div>}
        {module === 'aperture' && <ApertureModule />}
        {module === 'trade' && view === 'explorer' && <Sidebar />}
        <div className="content">
          {module === 'trade' && view === 'finder' && (
            <>
              <TradeFinder />
              <MistakeFinder />
            </>
          )}
          {module === 'trade' && view === 'autohaul' && <AutoHaul />}
          {module === 'trade' && view === 'orders' && <MyOrders />}
          {module === 'trade' && view === 'trends' && <Trends />}
          {module === 'trade' && view === 'radar' && <Radar />}
          {module === 'trade' && view === 'groups' && <ItemGroups />}
          {module === 'trade' && view === 'dashboard' && <Dashboard />}
          {module === 'trade' && view === 'explorer' && !item && (
            <div className="empty">
              Search for any of {typeCount.toLocaleString()} market items to compare hub prices.
            </div>
          )}
          {module === 'trade' && view === 'explorer' && item && (
            <>
              <div className="item-head">
                <button
                  className={`star ${watched ? 'on' : ''}`}
                  onClick={() => toggleWatch(item.id)}
                  title={watched ? 'Remove from watchlist' : 'Add to watchlist'}
                >
                  {watched ? '★' : '☆'}
                </button>
                <h1>{item.name}</h1>
                <SellingChip typeId={item.id} /><StockChip typeId={item.id} />
                <span className="meta">
                  {m3(item.volume)} packaged · type #{item.id}
                </span>
                {characterId && (
                  <button
                    className="btn mini"
                    title="Open this item's market window in the EVE client"
                    onClick={() => openMarketWindowEverywhere(item.id).catch(() => {})}
                  >
                    open in game
                  </button>
                )}
                <button
                  className={`btn mini ${stationTradeIds.includes(item.id) ? 'primary' : ''}`}
                  title={stationTradeIds.includes(item.id)
                    ? 'Marked as a STATION-TRADE item: bought where it sells, flipped at one hub — its stock never joins the haul pile. Click to unmark.'
                    : "Mark as a STATION-TRADE item: you buy it at the hub you'll sell it at, so its stock is flipped in place and never suggested for hauling. Stays until you untoggle it (also managed in Settings)."}
                  onClick={() => toggleStationTrade(item.id)}
                >
                  {stationTradeIds.includes(item.id) ? '⚑ station trade' : '⚐ station trade'}
                </button>
              </div>
              <HubTable typeId={item.id} />
              <ArbitragePanel typeId={item.id} />
              <HistoryChart typeId={item.id} />
            </>
          )}
        </div>
      </div>

      <footer className="statusbar">
        <span className="tip" data-tip="The app keeps itself up to date. Sources with a server expiry header (your orders, wallet) schedule themselves exactly; sources without one (prices) are watched until their real update cadence is learned — 'analyzing' until confirmed by observed changes." style={{ borderBottom: 'none' }}>
          ⟳ prices {pricesFresh
            ? pricesFresh.state === 'analyzing'
              ? '(analyzing cadence…)'
              : `in ${countdown(pricesFresh.nextAt)}`
            : '(analyzing cadence…)'}
          {ordersFresh?.nextAt ? ` · orders in ${countdown(ordersFresh.nextAt)}` : ''}
          {walletFresh?.nextAt ? ` · wallet in ${countdown(walletFresh.nextAt)}` : ''}
        </span>
        {(pricesFresh?.lastSuccess || lastUpdated) && (
          <span>
            last data {new Date(Math.max(pricesFresh?.lastSuccess ?? 0, ordersFresh?.lastSuccess ?? 0, walletFresh?.lastSuccess ?? 0, lastUpdated ?? 0)).toLocaleTimeString()}
          </span>
        )}
        {loading && <span>fetching…</span>}
        {radarProgress && <span className="dim">{radarProgress}</span>}
        {/* WHAT IS ACTUALLY PAUSED, never a silent stall. ESI's error budget
            is shared across every route, so when it tightens the app sheds
            traffic from the bottom up — the bulk market sweep first, the
            always-on-screen overlay last. Saying which lanes are down beats
            wondering why a number stopped moving. */}
        {esiState.pausedLanes.length > 0 && (
          <span className={esiState.hardBlocked ? 'err' : 'dim'}
            title={
              (esiState.hardBlocked
                ? 'EVE has closed EVERY route for this window (420). Nothing can be fetched until it resets — that is a CCP limit, not a bug here.'
                : 'EVE counts errored responses against a shared budget (100 per 60s) and answers 420 on every route if it runs out. To stay well clear, traffic is shed from the least important first: the bulk market sweep, then background collectors, then the screen. The overlay is always last.')
              + (esiState.remain !== null ? ` Error budget left: ${esiState.remain}/100.` : '')
            }>
            {esiState.hardBlocked ? '⛔ ESI closed (420)' : `⏸ paused: ${esiState.pausedLanes.join(', ')}`}
            {esiState.blockedUntil ? ` · ${countdown(esiState.blockedUntil)}` : ''}
          </span>
        )}
        {lastTeamOrderFailures().length > 0 && (
          <span className="err"
            title="This character's EVE session expired — their orders are invisible to the app, so statuses/heat/value snapshots would be WRONG. Value snapshots are paused until it's fixed. Settings → their card → Log out, then log back in.">
            ⚠ session expired: {lastTeamOrderFailures()
              .map((id) => { const c = characters.find((x) => x.characterId === id); return c ? shortLabel(c) : `#${id}`; })
              .join(', ')} — re-login needed, data partial
          </span>
        )}
        {error && <span className="err">Error: {error}</span>}
      </footer>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      <IntroTour onOpenSettings={() => setShowSettings(true)} />
    </div>
  );
}
