// HELP CONTENT MODEL (v0.197) — every module guide is a book of PAGES
// grouped by TAB, plus shared "everywhere" groups appended to every module.
//
// RULE 20 (LEARNINGS/RULES.md): a feature ships WITH its pages. A new tab
// gets a HelpGroup; a new control gets a line on the tab's "every control"
// page; a non-obvious panel gets a PANEL_HELP entry and an <InfoDot/>.
import type { ReactNode } from 'react';

export interface HelpPage {
  /** stable id, unique within the module (used for deep links + keys) */
  id: string;
  title: string;
  /** a figure shown ABOVE the body — a mock of the real UI, a flow, a
   * timeline; built from help/figures.tsx so it renders in the app's
   * own theme and never goes stale the way a screenshot would */
  figure?: ReactNode;
  body: ReactNode;
}

/** one TAB of a module (or one shared topic): a titled run of pages */
export interface HelpGroup {
  /** matches the tab's view id so the ⓘ opens on the tab in front of you */
  id: string;
  title: string;
  pages: HelpPage[];
}

export interface ModuleHelp {
  title: string;
  blurb: string;
  /** module-level pages shown first ("what this module is for", "start here") */
  intro: HelpPage[];
  groups: HelpGroup[];
}

export interface PanelHelp {
  title: string;
  figure?: ReactNode;
  body: ReactNode;
}
