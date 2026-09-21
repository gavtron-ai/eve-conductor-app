// THE SHAPE OF A MAP READING — types only.
//
// v0.215.0: this file used to hold two scripts that the app ran INSIDE the corp map's page
// (reading its tables and drawing, fetching its /api routes with the user's session, scanning
// its script files for colours). They are DELETED — see lib/apertureAccess.ts for why. What is
// left describes what the Σ Summary's parser consumes, so that a data path Aperture's developer
// designs can be fitted to it.
export interface ChainNodeDom { id: string; text: string; x: number; y: number; w: number; h: number }
export interface ChainEdgeDom { id: string; label: string; src: string; tgt: string; d: string }
export interface ChainFeedRaw {
  mapId: string;
  map: unknown;
  systemData: unknown;
  status: Record<string, { status?: number; type?: string; error?: string }>;
}

/** what the Aperture module makes of the feed, posted to the window */
export interface FeedRead {
  systems: { id: string; label: string; jcode: string; cls: string; eveId: string; tag: string; effect: string }[];
  /** pairs of system ids */
  edges: [string, string][];
  sigs: { sig: string; group: string; system: string; cls: string; name: string; ageH: number | null }[];
  /** the map's own home system, when its document names one */
  home: { id: string; label: string } | null;
  report: unknown;
  status: ChainFeedRaw['status'];
}

export interface ChainExtract {
  sigText: string;
  sigHeader: string;
  graph: { nodes: ChainNodeDom[]; edges: ChainEdgeDom[] };
  feed?: ChainFeedRaw;
  feedRead?: FeedRead | null;
  probe: Record<string, unknown> & { tableVisible?: boolean };
}
