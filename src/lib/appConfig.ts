// PER-PLAYER SETUP — the renderer half.
//
// The app itself is anonymous: one build, no registration, no ship name, no
// corporation compiled in. Everything that belongs to a particular player is
// read from Documents/EVE Conductor/config.json at startup and written back
// when they change it in Settings.
//
// THE FILE IS THE SOURCE OF TRUTH for these three values. The zustand store
// mirrors them so the rest of the app can read them synchronously, but the
// file is what survives a reinstall and what a player copies to a new
// machine. Two sources of truth is a bug factory, so the rule is: load once
// at startup, write through on every change, never let the store diverge.

import { useAuth } from './auth';
import { useApp } from './store';
import { logInfo, logWarn } from './devlog';

export interface AppSetup {
  /** the EVE application logins go through — a public id, not a secret */
  eveClientId: string;
  /** exact name of the ship whose cargo counts as in-transit ('' = none) */
  transitShipName: string;
  /** corporation web map embedded as the Aperture module ('' = off) */
  apertureUrl: string;
}

const EMPTY: AppSetup = { eveClientId: '', transitShipName: '', apertureUrl: '' };

let loaded: AppSetup = { ...EMPTY };
let ready = false;

export const setupIsReady = (): boolean => ready;
export const currentSetup = (): AppSetup => loaded;

/**
 * Read the config file into the store. Called once, before the first render
 * that could depend on it.
 *
 * NOTHING IS OVERWRITTEN WITH BLANKS. If the file is missing, unreadable or
 * has an empty field, whatever is already in the store stays — so a failed
 * read can never silently wipe a working setup. It only ever fills in.
 */
export async function loadSetup(): Promise<AppSetup> {
  try {
    const cfg = await window.appInfo?.config?.read();
    if (cfg) {
      loaded = {
        eveClientId: typeof cfg.eveClientId === 'string' ? cfg.eveClientId : '',
        transitShipName: typeof cfg.transitShipName === 'string' ? cfg.transitShipName : '',
        apertureUrl: typeof cfg.apertureUrl === 'string' ? cfg.apertureUrl : '',
      };
    }
  } catch {
    logWarn('config', 'could not read config.json — the app starts unconfigured');
  }
  ready = true;

  const app = useApp.getState();
  const patch: Partial<{ transitShipName: string; apertureUrl: string }> = {};
  if (loaded.transitShipName !== '') patch.transitShipName = loaded.transitShipName;
  if (loaded.apertureUrl !== '') patch.apertureUrl = loaded.apertureUrl;
  if (Object.keys(patch).length > 0) app.setSettings(patch);

  if (loaded.eveClientId !== '') useAuth.getState().setClientId(loaded.eveClientId);

  logInfo('config', 'setup loaded', {
    // the VALUES are personal; whether they are SET is the diagnostic
    eveApplication: loaded.eveClientId !== '' ? 'configured' : 'not set',
    transitShip: loaded.transitShipName !== '' ? 'configured' : 'not set',
    apertureMap: loaded.apertureUrl !== '' ? 'configured' : 'not set',
  });
  return loaded;
}

/**
 * Change part of the setup: writes the file FIRST, and only updates the
 * store if the write succeeded. The other order would leave the app running
 * on a value that is not going to survive a restart.
 */
export async function saveSetup(patch: Partial<AppSetup>): Promise<boolean> {
  let next: AppSetup | null = null;
  try {
    next = (await window.appInfo?.config?.write(patch)) ?? null;
  } catch {
    next = null;
  }
  if (!next) {
    logWarn('config', 'could not write config.json — the change was NOT saved', {
      fields: Object.keys(patch),
    });
    return false;
  }
  loaded = next;
  const app = useApp.getState();
  if (patch.transitShipName !== undefined) app.setSettings({ transitShipName: next.transitShipName });
  if (patch.apertureUrl !== undefined) app.setSettings({ apertureUrl: next.apertureUrl });
  if (patch.eveClientId !== undefined) useAuth.getState().setClientId(next.eveClientId);
  logInfo('config', 'setup saved', { fields: Object.keys(patch) });
  return true;
}

/** where the file lives, for the UI to show */
export async function setupPath(): Promise<string | null> {
  try {
    return (await window.appInfo?.config?.path()) ?? null;
  } catch {
    return null;
  }
}

/** true when this install has no EVE application yet — nothing can log in */
export const needsSetup = (): boolean => currentSetup().eveClientId.trim() === '';
