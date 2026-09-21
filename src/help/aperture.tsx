// APERTURE — switched off (v0.216.0); this book shrank with it (v0.217.0). The pages that described
// the embedded map, its toolbar and the Σ Summary were removed along with the features: a guide to
// something that is not there is worse than no guide. They return — rewritten — if the features do.
import type { ModuleHelp } from './types';
import { Limit } from './figures';

export const APERTURE_HELP: ModuleHelp = {
  title: 'Aperture',
  blurb: 'switched off for now',
  intro: [
    {
      id: 'what', title: 'Why this module is switched off',
      body: (
        <>
          <p>
            This module used to show your corporation&apos;s Aperture map inside the app and build the <b>Σ Summary</b> and the Home <b>chain dashlets</b> from it. Aperture&apos;s developer told us that the way the app loaded and read the map cost their server thousands of requests a day for every copy of the app, and distorted their user numbers. They were right, and they had never been asked.
          </p>
          <p>
            So all of it has been removed. <b>EVE Conductor does not contact Aperture in any way</b> — it does not load the map, read it, or keep a login for it. Both tabs here, the Σ Summary window, the chain dashlets and the Theft Conductor&apos;s “refresh from Aperture” show a notice instead.
          </p>
          <p>
            <b>What still works:</b> Aperture in your own web browser, exactly as before — the notice has a button that opens your browser and sends nothing itself. And to give the raid alert its distance origin: copy your system list in Aperture (Map info → Systems), then press <b>📋 import map from clipboard</b> in the Theft Conductor. The app reads your clipboard once, when you press.
          </p>
          <Limit>
            These features come back only when Aperture&apos;s developer has offered — and is happy with — a way of doing it. Until then there is nothing to configure here; the map address in ⚙ Settings → Your setup is used only by the “open in your own browser” button.
          </Limit>
        </>
      ),
    },
  ],
  groups: [],
};
