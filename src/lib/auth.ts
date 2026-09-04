import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_CLIENT_ID } from './constants';

export interface OwnedShip {
  itemId: number;
  typeId: number;
  typeName: string;
  /** player-assigned name, when set */
  customName: string | null;
  /** effective general cargo m³: skills + fitted expanders/rigs, incl. fleet hangar */
  cargo: number;
  /** human-readable bay breakdown */
  breakdown?: string;
}

export interface Standings {
  corps: Record<number, number>;
  factions: Record<number, number>;
}

interface SsoTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  characterId: number;
  characterName: string;
}

interface SsoBridge {
  login: (clientId: string) => Promise<SsoTokens>;
  refresh: (clientId: string, refreshToken: string) => Promise<SsoTokens>;
}

interface StatsBridge {
  info: () => Promise<{ dir: string }>;
  append: (lines: string[]) => Promise<void>;
  readAll: () => Promise<string>;
  files: () => Promise<{ name: string; content: string }[]>;
  import: (files: { name: string; content: string }[]) => Promise<number>;
  auxWrite: (name: string, content: string) => Promise<void>;
  auxRead: (name: string) => Promise<string | null>;
  auxAppend: (name: string, lines: string[]) => Promise<void>;
  /** all radar/aux files (for backups) — optional: older shells lack it */
  auxFiles?: () => Promise<{ name: string; content: string }[]>;
  /** aux file NAMES only (+size/mtime) — listing without loading contents */
  auxNames?: () => Promise<{ name: string; size: number; mtime: number }[]>;
}

interface ConfigBridge {
  read: () => Promise<{ eveClientId?: string; transitShipName?: string; apertureUrl?: string }>;
  write: (patch: Record<string, string>) => Promise<{ eveClientId: string; transitShipName: string; apertureUrl: string } | null>;
  path: () => Promise<string>;
}

interface DevLogBridge {
  append: (entries: unknown[]) => Promise<void>;
  tail: (lines: number) => Promise<string>;
  info: () => Promise<{ dir: string }>;
}

interface UpdatesBridge {
  /** a new version finished downloading in the background; installs on quit */
  onReady: (cb: (info: { version: string }) => void) => void;
  /** quit now and install the downloaded update */
  restart: () => Promise<void>;
}

interface BackupBridge {
  /** native save dialog; returns the saved path or null if cancelled */
  save: (defaultName: string, content: string) => Promise<string | null>;
}

interface WinBridge {
  /** keep the app window above every other application */
  setAlwaysOnTop: (on: boolean) => Promise<void>;
  /** X hides to the system tray instead of quitting (non-mac) */
  setCloseToTray: (on: boolean) => Promise<void>;
  /** open a second window showing one module — a pop-out with no collectors */
  openModule?: (moduleId: string) => Promise<boolean>;
  /** a pop-out tells the main process its current module (for the saved layout) */
  reportModule?: (moduleId: string) => void;
}

interface OverlayBridge {
  set: (on: boolean) => Promise<boolean>;
  isOpen: () => Promise<boolean>;
  push: (payload: unknown) => void;
  onData: (cb: (payload: never) => void) => void;
  onEdit: (cb: (on: boolean) => void) => void;
  /** the overlay opened/closed — fired in EVERY window, whichever flipped it */
  onOpenChanged?: (cb: (on: boolean) => void) => void;
  setEdit: (on: boolean) => void;
}

/** the clone registry, owned by the main process (electron/cloneStore.cjs)
 * so the main window, the overlay and the setup window share one copy */
interface ClonesBridge {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  all: () => Promise<any>;
  record: (list: unknown[]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setConfig: (cfg: unknown) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  forget: (cfg: unknown) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChanged: (cb: (registry: any) => void) => void;
  openConfig: () => Promise<boolean>;
  closeConfig: () => Promise<boolean>;
}

declare global {
  interface Window {
    appInfo?: {
      isElectron: boolean;
      platform: string;
      ssoScopes?: string;
      /** the exact callback URL the login server binds (main process owns it) */
      ssoCallback?: string;
      sso?: SsoBridge;
      stats?: StatsBridge;
      devlog?: DevLogBridge;
      updates?: UpdatesBridge;
      /** absolute path of the guest-side popup shim for the Aperture webview */
      aperturePreloadPath?: string;
      config?: ConfigBridge;
      backup?: BackupBridge;
      win?: WinBridge;
      fittings?: {
        exportXml: (fileName: string, content: string, clearOurs?: boolean) => Promise<string>;
        dir: () => Promise<string>;
        /** pyfa export: user picks a folder, one EFT .txt per unique fit;
         * null = the user cancelled the folder dialog */
        exportEftFolder: (files: { name: string; content: string }[]) =>
          Promise<{ dir: string; written: number; errors: string[] } | null>;
      };
      overlay?: OverlayBridge;
      clones?: ClonesBridge;
      /** the corp killboard read as a real page — live killmail ids */
      zkill?: {
        pageIds: (corpId: number) => Promise<number[]>;
        charKills: (charId: number) => Promise<{ killmail_id: number; hash: string; value: number }[]>;
        systemKills: (systemId: number, pastSeconds?: number) => Promise<{ killmail_id: number; hash: string; value: number; locationId: number; npc: boolean }[]>;
      };
      /** the storm tracker page HTML ('' = unreachable) — main fetches it
       * because the page has no CORS header */
      storms?: {
        page: () => Promise<string>;
      };
      /** the OS clipboard, read-only — Aperture auto-import watches it */
      clipboard?: {
        read: () => Promise<string>;
      };
      /** pull the Systems-table text from the owner's logged-in Aperture map
       * in a hidden window ('' if it couldn't be read / not logged in) */
      aperture?: {
        systems: (url: string) => Promise<string>;
        /** popup relay for the map's overlay (guest-side shim, v0.188.3) */
        openPopup: (url: string) => Promise<boolean>;
      };
      /** the EVE client's game logs, read read-only by main */
      gamelog?: {
        list: () => Promise<{
          dir: string;
          ok: boolean;
          files: {
            file: string;
            dateKey: string;
            charId: string | null;
            listener: string | null;
            sessionStart: string | null;
            mtimeMs: number;
            size: number;
          }[];
        }>;
        read: (file: string) => Promise<{
          ok: boolean;
          truncated: boolean;
          size?: number;
          mtimeMs?: number;
          lines: string[];
        }>;
      };
      /** AI fight write-ups — the Anthropic key never comes BACK to the
       * renderer: setKey stores what the Settings field sends and answers
       * with status only */
      narrative?: {
        status: () => Promise<{ configured: boolean; model: string | null }>;
        write: (digest: unknown) => Promise<{ text?: string; model?: string; error?: string }>;
        setKey: (apiKey: string) => Promise<{ configured: boolean; model: string | null }>;
      };
    };
  }
}

export const isElectron = Boolean(window.appInfo?.isElectron);

/** one logged-in character — the team can hold several */
export interface CharAccount {
  characterId: number;
  characterName: string;
  /** user-assigned role label, e.g. "Buyer @ Jita", "Hauler" */
  role: string;
  /** short display name for lists/chips; empty = derive from the character name */
  nickname?: string;
  /** structured duty: hub traders' hangars count as business stock; a
   * hauler's cargo is in transit, not idle inventory */
  tradeRole?: 'trader' | 'hauler';
  /** watched by the PI module. DELIBERATELY SEPARATE from tradeRole, which
   * is one-of: almost every PI character is also a trader or a hauler, so
   * making PI a third value of that field would have forced a false choice. */
  piRole?: boolean;
  /** the hub a trader operates at — THEIR skills/standings drive that hub's
   * fee math, regardless of which character is "active" */
  homeHubId?: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number;
  standings: Standings | null;
  ships: OwnedShip[] | null;
  skills: Record<number, number> | null;
  wallet: number | null;
  implants: number[] | null;
  lastSync: number | null;
}

/** duty/label assignment remembered PER characterId — survives the character
 * being removed and re-added (an EVE-application switch must never cost the
 * user their team setup: losing tradeRole silently breaks the hauler-hangar
 * exclusion, per-hub fees, and net-worth scoping) */
export interface DutyMemory {
  role: string;
  nickname?: string;
  tradeRole?: 'trader' | 'hauler';
  homeHubId?: string;
  piRole?: boolean;
}

interface AuthState {
  clientId: string;
  characters: CharAccount[];
  /** the character the app "acts as": wallet %, location, ship, in-game windows */
  activeId: number | null;
  dutyMemory: Record<number, DutyMemory>;

  setClientId: (id: string) => void;
  applyTokens: (t: SsoTokens) => void;
  setCharacterData: (
    charId: number,
    d: Partial<Pick<CharAccount, 'standings' | 'ships' | 'skills' | 'wallet' | 'implants' | 'role' | 'nickname' | 'tradeRole' | 'homeHubId' | 'piRole'>>,
  ) => void;
  markSynced: (charId: number) => void;
  setActive: (charId: number) => void;
  removeCharacter: (charId: number) => void;
}

const blankChar = (t: SsoTokens): CharAccount => ({
  characterId: t.characterId,
  characterName: t.characterName,
  role: '',
  accessToken: t.accessToken,
  refreshToken: t.refreshToken,
  expiresAt: t.expiresAt,
  standings: null,
  ships: null,
  skills: null,
  wallet: null,
  implants: null,
  lastSync: null,
});

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      clientId: '',
      characters: [],
      activeId: null,
      dutyMemory: {},

      setClientId: (clientId) => set({ clientId }),
      applyTokens: (t) =>
        set((s) => {
          const existing = s.characters.find((c) => c.characterId === t.characterId);
          const characters = existing
            ? s.characters.map((c) =>
                c.characterId === t.characterId
                  ? {
                      ...c,
                      characterName: t.characterName,
                      accessToken: t.accessToken,
                      refreshToken: t.refreshToken,
                      expiresAt: t.expiresAt,
                    }
                  : c,
              )
            : [...s.characters, { ...blankChar(t), ...(s.dutyMemory[t.characterId] ?? {}) }];
          return { characters, activeId: s.activeId ?? t.characterId };
        }),
      setCharacterData: (charId, d) =>
        set((s) => {
          const characters = s.characters.map((c) => (c.characterId === charId ? { ...c, ...d } : c));
          const c = characters.find((x) => x.characterId === charId);
          const dutyMemory = c
            ? {
                ...s.dutyMemory,
                [charId]: { role: c.role, nickname: c.nickname, tradeRole: c.tradeRole, homeHubId: c.homeHubId, piRole: c.piRole },
              }
            : s.dutyMemory;
          return { characters, dutyMemory };
        }),
      markSynced: (charId) =>
        set((s) => ({
          characters: s.characters.map((c) =>
            c.characterId === charId ? { ...c, lastSync: Date.now() } : c,
          ),
        })),
      setActive: (charId) => set({ activeId: charId }),
      removeCharacter: (charId) =>
        set((s) => {
          const characters = s.characters.filter((c) => c.characterId !== charId);
          return {
            characters,
            activeId:
              s.activeId === charId ? (characters[0]?.characterId ?? null) : s.activeId,
          };
        }),
    }),
    {
      name: 'eve-trade-conductor-auth',
      version: 5,
      // v3: multi-character. Older saves held a single character at the root —
      // wrap it into characters[0] so nothing is lost.
      // v4: clear a stored Client ID that matches the OLD baked-in default —
      // it predates the ID being built in (the user typed it in v3-era
      // Settings) and silently OVERRODE the new application's built-in ID,
      // sending logins to the old app with the new callback (redirect
      // mismatch). A genuinely custom ID is left untouched.
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        if (version >= 3) {
          // (v4 once cleared a superseded application id here; with no id
          //  compiled in there is nothing left to compare against)
          // v5: seed the duty memory from whatever assignments exist now
          if (version < 5) {
            const mem: Record<number, DutyMemory> = { ...((p.dutyMemory as Record<number, DutyMemory>) ?? {}) };
            for (const c of (p.characters as CharAccount[]) ?? []) {
              if (c.role || c.nickname || c.tradeRole || c.homeHubId) {
                mem[c.characterId] = { role: c.role, nickname: c.nickname, tradeRole: c.tradeRole, homeHubId: c.homeHubId };
              }
            }
            p.dutyMemory = mem;
          }
          return p as unknown as AuthState;
        }
        const legacyId = p.characterId as number | null | undefined;
        const characters: CharAccount[] = legacyId
          ? [
              {
                characterId: legacyId,
                characterName: (p.characterName as string) ?? `#${legacyId}`,
                role: '',
                accessToken: (p.accessToken as string) ?? null,
                refreshToken: (p.refreshToken as string) ?? null,
                expiresAt: (p.expiresAt as number) ?? 0,
                standings: (p.standings as Standings) ?? null,
                ships: null,
                skills: null,
                wallet: null,
                implants: null,
                lastSync: null,
              },
            ]
          : [];
        const legacyClientId = (p.clientId as string) ?? '';
        return {
          clientId: legacyClientId,
          characters,
          activeId: legacyId ?? null,
        } as AuthState;
      },
    },
  ),
);

/** the character the app acts as (null when logged out) */
export function activeChar(): CharAccount | null {
  const s = useAuth.getState();
  return s.characters.find((c) => c.characterId === s.activeId) ?? null;
}

/** react hook for the active character */
export function useActiveChar(): CharAccount | null {
  return useAuth((s) => s.characters.find((c) => c.characterId === s.activeId) ?? null);
}

export function getChar(charId: number): CharAccount | null {
  return useAuth.getState().characters.find((c) => c.characterId === charId) ?? null;
}

// ---- display names ----
// Several of the user's characters share a first word ("Brad's …"), so the
// old first-word shorthand was ambiguous. Nickname wins everywhere; the
// fallback stays the first word of the real name.

/** duty shorthand: "J-Trader" / "A-Trader" / "Hauler" — null when no duty set */
export function dutyLabel(c: CharAccount): string | null {
  if (c.tradeRole === 'hauler') return 'Hauler';
  if (c.tradeRole === 'trader' && c.homeHubId) {
    return `${c.homeHubId.charAt(0).toUpperCase()}-Trader`;
  }
  return null;
}

/** full display name: duty label, else nickname, else the real name */
export function charLabel(c: CharAccount): string {
  return dutyLabel(c) || c.nickname?.trim() || c.characterName;
}

/** compact list/chip name: duty label > nickname > first word of the name */
export function shortLabel(c: CharAccount): string {
  return dutyLabel(c) || c.nickname?.trim() || c.characterName.split(' ')[0];
}

/** the trader character responsible for a hub — their skills/standings drive
 * that hub's fee math (falls back to the active character) */
export function charForHub(hubId: string): CharAccount | null {
  const s = useAuth.getState();
  return (
    s.characters.find((c) => c.tradeRole === 'trader' && c.homeHubId === hubId) ??
    s.characters.find((c) => c.characterId === s.activeId) ??
    null
  );
}

/** compact name for an order's owner (falls back to the tagged name) */
export function ownerLabel(ownerId?: number, ownerName?: string): string {
  const c = ownerId !== undefined ? getChar(ownerId) : null;
  if (c) return shortLabel(c);
  return (ownerName ?? '?').split(' ')[0];
}

/** the built-in app id unless the user set their own in advanced settings */
export function effectiveClientId(): string {
  return useAuth.getState().clientId.trim() || DEFAULT_CLIENT_ID;
}

// EVE SSO ROTATES refresh tokens: every refresh invalidates the old one, and a
// reused old token makes EVE revoke the whole session. Refreshes are
// single-flight PER CHARACTER.
const refreshInFlight = new Map<number, Promise<SsoTokens>>();

async function doRefresh(charId: number): Promise<string> {
  const c = getChar(charId);
  if (!c?.refreshToken) throw new Error('Not logged in.');
  const bridge = window.appInfo?.sso;
  if (!bridge) throw new Error('EVE login requires the desktop app.');
  if (!refreshInFlight.has(charId)) {
    refreshInFlight.set(
      charId,
      bridge.refresh(effectiveClientId(), c.refreshToken).finally(() => {
        refreshInFlight.delete(charId);
      }),
    );
  }
  const tokens = await refreshInFlight.get(charId)!;
  useAuth.getState().applyTokens(tokens);
  return tokens.accessToken;
}

/**
 * Valid access token for a character (defaults to the active one). `force`
 * refreshes even if the token looks valid — used after a 401.
 */
export async function ensureToken(charId?: number, force = false): Promise<string> {
  const id = charId ?? useAuth.getState().activeId;
  if (id === null || id === undefined) throw new Error('Not logged in.');
  const c = getChar(id);
  if (!c?.refreshToken) throw new Error('Not logged in.');
  if (!force && c.accessToken && Date.now() < c.expiresAt - 60_000) return c.accessToken;
  return doRefresh(id);
}

/** Log in (adds a character to the team, or refreshes an existing one). */
export async function ssoLogin(): Promise<number> {
  const bridge = window.appInfo?.sso;
  if (!bridge) throw new Error('EVE login requires the desktop app.');
  const tokens = await bridge.login(effectiveClientId());
  useAuth.getState().applyTokens(tokens);
  return tokens.characterId;
}
