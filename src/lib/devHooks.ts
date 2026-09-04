// DEV ONLY: expose the app's live zustand stores on window for fixture-based
// verification. Vite's HMR gives edited modules cache-busted URLs, so a test's
// dynamic `import('/src/lib/x.ts')` can silently get a SECOND store instance —
// state set there never reaches the UI. This registry hands tests the real
// instances. Stripped from production builds (import.meta.env.DEV guard).
import { useApp } from './store';
import { useAuth } from './auth';
import { useMyMarket } from './myMarket';
import { useFreshness } from './freshness';
import { usePrices } from './priceStore';
import { useStock } from './stock';

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__etcStores = {
    useApp,
    useAuth,
    useMyMarket,
    useFreshness,
    usePrices,
    useStock,
  };
}
