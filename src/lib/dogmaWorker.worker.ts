// THE DOGMA ENGINE, OFF THE MAIN THREAD.
//
// One `calculate()` is ~22-30 ms of SYNCHRONOUS WebAssembly. On the renderer
// thread that is a dropped frame; a Battle Sim with six combatants at three
// pilot profiles each is half a second of frozen window, and the implant
// search runs hundreds of passes. Nothing in this app was ever off-thread
// before, so every sweep — Make It Fit, the ammo comparison, the skill gap —
// has been locking the UI for as long as it ran.
//
// THE ONE LINE THAT MAKES THIS WORK: the vendored wasm-bindgen glue reaches
// its host callbacks through `window.*`, which does not exist in a Worker.
// Aliasing `globalThis.window = globalThis` lets the UNMODIFIED vendored file
// run here — the repo already does exactly this in its node harness. The
// alternative, a build step that rewrites `window.` to `globalThis.`, would
// leave a second 530-line copy of a vendored dependency to drift.
globalThis.window = globalThis as unknown as Window & typeof globalThis;

import protobuf from 'protobufjs';
import initWasm, { init as dogmaInit, calculate as dogmaCalculate } from '../vendor/dogma-engine/esf_dogma_engine';
import wasmUrl from '../vendor/dogma-engine/esf_dogma_engine_bg.wasm?url';
import protoText from '../data/esf/esf.proto?raw';
import typesUrl from '../data/esf/types.pb2?url';
import typeDogmaUrl from '../data/esf/typeDogma.pb2?url';
import dogmaEffectsUrl from '../data/esf/dogmaEffects.pb2?url';
import dogmaAttributesUrl from '../data/esf/dogmaAttributes.pb2?url';
import { extractStats } from './dogmaFit';
import type { CalcResultShape, EsfFitShape, FitStats } from './dogmaFit';

export interface CalcRequest {
  id: number;
  esfFit: EsfFitShape;
  skills: Record<string, number>;
  /** hull attribute ids the hull itself carries — passed in, because the
   * caller already has the catalog and the worker need not re-derive it */
  hullOwn: number[];
  benchedDrones: string[];
}

export type WorkerOut =
  | { kind: 'ready'; ms: number }
  | { kind: 'bootFailed'; error: string }
  | { kind: 'ok'; id: number; stats: FitStats; ms: number }
  | { kind: 'error'; id: number; error: string };

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

async function fetchPb(url: string, root: protobuf.Root, message: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${message}: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return (root.lookupType(message).decode(buf) as unknown as { entries: Record<string, unknown> }).entries;
}

/** the worker keeps its OWN copy of the SDE — that is the cost of the trade */
const ready = (async () => {
  const t0 = performance.now();
  const root = protobuf.parse(protoText).root;
  const [types, typeDogma, dogmaAttributes, dogmaEffects] = await Promise.all([
    fetchPb(typesUrl, root, 'esf.Types'),
    fetchPb(typeDogmaUrl, root, 'esf.TypeDogma'),
    fetchPb(dogmaAttributesUrl, root, 'esf.DogmaAttributes'),
    fetchPb(dogmaEffectsUrl, root, 'esf.DogmaEffects'),
  ]);
  const g = globalThis as unknown as Record<string, unknown>;
  g.get_dogma_attributes = (typeId: number) =>
    (typeDogma[typeId] as { dogmaAttributes?: unknown })?.dogmaAttributes ?? [];
  g.get_dogma_attribute = (attrId: number) => dogmaAttributes[attrId];
  g.get_dogma_effects = (typeId: number) =>
    (typeDogma[typeId] as { dogmaEffects?: unknown })?.dogmaEffects ?? [];
  g.get_dogma_effect = (effectId: number) => dogmaEffects[effectId];
  g.get_type = (typeId: number) => types[typeId];
  g.type_name_to_id = (name: string) => {
    for (const [id, t] of Object.entries(types)) if ((t as { name: string }).name === name) return Number(id);
    return undefined;
  };
  const byName = new Map(
    Object.entries(dogmaAttributes).map(([id, a]) => [(a as { name: string }).name, Number(id)]),
  );
  g.attribute_name_to_id = (name: string) => byName.get(name);

  await initWasm(wasmUrl);
  dogmaInit();
  return performance.now() - t0;
})();

void ready.then(
  (ms) => post({ kind: 'ready', ms }),
  (e: unknown) => post({ kind: 'bootFailed', error: e instanceof Error ? e.message : String(e) }),
);

self.onmessage = (ev: MessageEvent<CalcRequest>) => {
  const req = ev.data;
  void ready.then(
    () => {
      const t0 = performance.now();
      try {
        const result = dogmaCalculate(req.esfFit, req.skills) as CalcResultShape;
        // extractStats runs HERE so only the finished FitStats crosses the
        // boundary. Its Map and Set survive structured clone intact — verified,
        // and worth stating because JSON.stringify would flatten both to {}.
        const stats = extractStats(result, [], new Set(req.hullOwn), req.benchedDrones);
        post({ kind: 'ok', id: req.id, stats, ms: performance.now() - t0 });
      } catch (e: unknown) {
        post({ kind: 'error', id: req.id, error: e instanceof Error ? e.message : String(e) });
      }
    },
    (e: unknown) => post({ kind: 'error', id: req.id, error: e instanceof Error ? e.message : String(e) }),
  );
};
