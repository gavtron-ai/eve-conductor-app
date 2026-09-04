export type HubKind = 'station' | 'system' | 'region';

export interface Hub {
  /** stable key, e.g. "jita" or "sys-30000123" */
  id: string;
  name: string;
  kind: HubKind;
  /** stationID / systemID / regionID depending on kind — what Fuzzwork is queried with */
  locationId: number;
  /** region the hub lives in — used for ESI market history */
  regionId: number;
  builtin?: boolean;
}

export interface SideAggregate {
  weightedAverage: number;
  max: number;
  min: number;
  median: number;
  volume: number;
  orderCount: number;
  /** 5% percentile price — robust against scam orders */
  percentile: number;
}

export interface TypeAggregate {
  buy: SideAggregate;
  sell: SideAggregate;
  fetchedAt: number;
}

/** aggregates keyed by hub id, then type id */
export type PriceBook = Record<string, Record<number, TypeAggregate>>;

export interface HistoryDay {
  date: string;
  average: number;
  highest: number;
  lowest: number;
  order_count: number;
  volume: number;
}

export interface Settings {
  accountingLevel: number; // 0-5
  brokerRelationsLevel: number; // 0-5
  factionStanding: number; // -10..10
  corpStanding: number; // -10..10
  useCustomBrokerRate: boolean;
  customBrokerRate: number; // fraction, e.g. 0.01
  salesTaxBase: number; // fraction, CCP-patchable
  brokerFeeBase: number; // fraction, CCP-patchable
  // optional (added v0.47) — persisted settings from older versions lack them,
  // so every read must default with ?? (alwaysOnTop ?? false, closeToTray ?? true)
  /** keep the app window above every other application */
  alwaysOnTop?: boolean;
  /** X hides to the system tray instead of quitting (Windows/Linux) */
  closeToTray?: boolean;
  /**
   * Open the pod/clone overlay as soon as the app starts.
   *
   * ON by default: the overlay is the one screen a multiboxer looks at
   * constantly, and its whole job is to stop you undocking in the wrong
   * clone. An alert you have to remember to switch on is an alert that is off
   * on the day it mattered. Nothing is drawn until characters are logged in,
   * so a fresh install does not get a mystery floating window.
   */
  overlayAutoStart?: boolean;

  /** show nearby raidable skyhooks on the overlay (within raidAlertJumps of the
   * imported Theft map). ON by default — it's the whole point of the map. */
  raidAlert?: boolean;
  /** how many stargate jumps from a mapped system still counts as "near" */
  raidAlertJumps?: number;

  // ---- per-player setup (v0.60.34) -------------------------------------
  // These two used to be hardcoded to ONE player's setup. They drive real
  // behaviour, so a different player silently got the wrong answer: goods
  // counted as personal instead of in-transit, and an embedded map pointing
  // at someone else's corporation. Empty = the feature is simply off, and
  // says so, rather than pretending.
  /**
   * EXACT name of the ship whose hold counts as goods IN TRANSIT rather than
   * personal cargo. Every other ship's cargo is ignored. Empty = no transit
   * ship configured, so nothing is ever counted as in-transit.
   */
  transitShipName?: string;
  /**
   * URL the Aperture module embeds (a corporation's own web map, typically).
   * Empty = the module explains how to point it somewhere instead of loading
   * a stranger's page.
   */
  apertureUrl?: string;
}

export interface ItemType {
  id: number;
  name: string;
  /** packaged volume in m³ */
  volume: number;
  /** index into typedb categories (root market group) */
  catIdx: number;
  /** ships only: base cargo hold in m³ (before expanders/rigs/special bays) */
  cargo?: number;
  /** ships only: inventory groupID (28 industrial, 380 DST, 513 freighter, …) */
  group?: number;
  /** ships only: raceID (1 Caldari, 2 Minmatar, 4 Amarr, 8 Gallente) */
  race?: number;
  /** ships only: special bay base sizes in m³ */
  bays?: { fleet?: number; ore?: number; ammo?: number; mineral?: number; pi?: number };
}
