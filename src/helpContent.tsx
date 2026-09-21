// HELP CONTENT — assembled from src/help/<module>.tsx (one book per module)
// plus src/help/shared.tsx (groups every module shows: the header, Settings,
// the multibox overlay, updates, reading the numbers).
//
// RULE 20 (LEARNINGS/RULES.md): every new feature lands WITH its help — a
// page (or a line on the tab's "every control" page) in the module's book,
// a PANEL_HELP entry + <InfoDot id="…"/> for a non-obvious panel, and an
// intro-tour update when onboarding itself changes.
//
// Voice: written for a corp mate on day one — thorough but concise, says
// what to DO first, and states honest limits (what the tool cannot know)
// rather than glossing over them. Every figure is drawn from the app's own
// styles (src/help/figures.tsx) so it cannot go stale like a screenshot.
import type { ModuleId } from './lib/store';
import type { HelpGroup, ModuleHelp, PanelHelp } from './help/types';
import { SHARED } from './help/shared';
import { TRADE_HELP, TRADE_PANELS } from './help/trade';
import { CHARACTER_HELP, CHARACTER_PANELS } from './help/character';
import { BATTLE_HELP, BATTLE_PANELS } from './help/battle';
import { THEFT_HELP, THEFT_PANELS } from './help/theft';
import { PI_HELP, PI_PANELS } from './help/pi';
import { APERTURE_HELP } from './help/aperture';
import { HOME_HELP } from './help/home';

export type { HelpGroup, HelpPage, ModuleHelp, PanelHelp } from './help/types';

export const MODULE_HELP: Record<ModuleId, ModuleHelp> = {
  home: HOME_HELP,
  trade: TRADE_HELP,
  character: CHARACTER_HELP,
  battle: BATTLE_HELP,
  theft: THEFT_HELP,
  pi: PI_HELP,
  aperture: APERTURE_HELP,
};

/** groups appended to EVERY module's guide */
export const SHARED_GROUPS: HelpGroup[] = SHARED;

/** PANEL-LEVEL entries, keyed "<module>.<panel>" — for the small ⓘ beside
 * a panel title, when the panel's mechanics are not obvious from the guide */
export const PANEL_HELP: Record<string, PanelHelp> = {
  ...TRADE_PANELS,
  ...CHARACTER_PANELS,
  ...BATTLE_PANELS,
  ...THEFT_PANELS,
  ...PI_PANELS,
};
