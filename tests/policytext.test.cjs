// v0.234.0 (audit F10): nothing checked the help and policy TEXT against the CODE — the policy page
// was wrong about Aperture for months. This fixture reads the shipped sources as text and holds
// three lists to each other: the hosts the Content-Security-Policy lets the page talk to
// (vite.config.ts), the hosts the request meter can label (lib/netMeter.ts), and the services the
// policy page names in its traffic table (help/policy.tsx). A host that can be reached must be
// counted and must be on the policy page; a service on the policy page that the policy cannot reach
// must say it makes no request. It also checks that every release note is marked published.
const fs = require('fs');
const path = require('path');
const src = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

// ---- the three lists
const vite = src('vite.config.ts');
const connect = /"connect-src ([^"]*)"/.exec(vite)?.[1] ?? '';
const cspHosts = connect.split(/\s+/).filter((t) => t.startsWith('https://')).map((t) => t.replace('https://', ''));
eq('1 the policy names its reachable hosts', cspHosts.length > 0, true);

const meter = src('src/lib/netMeter.ts');
// hostLabel's rules: literal hosts and endsWith suffixes → a function the fixture can apply
const labelRules = [...meter.matchAll(/h === '([^']+)'|h\.endsWith\('([^']+)'\)/g)].map((m) => m[1] ?? m[2]);
const labelled = (host) => labelRules.some((r) => host === r || host.endsWith(r) || (r.startsWith('.') && host.endsWith(r)) || (host.startsWith('*.') && host.slice(2).endsWith(r.replace(/^\./, ''))));
eq('2 every host the policy allows is one the request meter can label', cspHosts.filter((h) => !labelled(h)), []);

const policy = src('src/help/policy.tsx');
const traffic = policy.slice(policy.indexOf('POLICY_TRAFFIC'), policy.indexOf('POLICY_QA'));
const services = [...traffic.matchAll(/service: '([^']+)'/g)].map((m) => m[1]);
const named = (host) => {
  const h = host.replace(/^\*\./, '');
  if (h.endsWith('evetech.net') || h === 'login.eveonline.com') return services.some((s) => /ESI|images \(CCP\)/.test(s));
  if (h.endsWith('fuzzwork.co.uk')) return services.some((s) => /Fuzzwork/.test(s));
  if (h.endsWith('zkillboard.com')) return services.some((s) => /zKillboard/.test(s));
  if (h.endsWith('ntfy.sh')) return services.some((s) => /ntfy/.test(s));
  if (h.endsWith('github.com') || h.endsWith('githubusercontent.com')) return services.some((s) => /GitHub/.test(s));
  return false;
};
eq('3 every host the policy allows has a row in the policy page\'s traffic table', cspHosts.filter((h) => !named(h)), []);

// services the page names that the policy cannot reach must say they make no request
const rows = policy.slice(policy.indexOf('POLICY_THIRD_PARTY'), policy.indexOf('POLICY_TRAFFIC'));
const unreachable = [...rows.matchAll(/service: '([^']+)'[\s\S]*?how: <>([\s\S]*?)<\/>/g)].map((m) => [m[1], m[2]]);
// GitHub is reached by the MAIN process (electron-updater), never by the page — the page's policy
// does not list it, and the policy page rightly names it: that pair is correct, not a drift
const reachable = (svc) => /zKillboard/.test(svc) ? cspHosts.some((h) => h.endsWith('zkillboard.com')) : /Fuzzwork/.test(svc) ? cspHosts.some((h) => h.endsWith('fuzzwork.co.uk')) : /ntfy/.test(svc) ? cspHosts.some((h) => h.endsWith('ntfy.sh')) : /GitHub/.test(svc) ? true : /Aperture|EvE-Scout|evetools|WarBeacon/.test(svc) ? false : true;
const wrong = unreachable.filter(([svc, how]) => !reachable(svc) && !/no contact|no request|does not contact|never contacts|not contacted|makes no/i.test(how));
eq('4 a third-party service the policy cannot reach says so on the policy page (no contact / no request)', wrong.map((w) => w[0]), []);
eq('5 GitHub is the main process\'s host (the updater), never the page\'s: the page policy does not list it', cspHosts.filter((h) => h === 'github.com' || h.endsWith('github.com') || h.endsWith('githubusercontent.com')), []);

// ---- release notes: every entry is published (a note the user cannot see is a note that was not written)
const notes = src('src/help/releaseNotes.tsx');
const versions = [...notes.matchAll(/version: '([0-9.]+)'/g)].map((m) => m[1]);
const unpublished = [...notes.matchAll(/version: '([0-9.]+)'[\s\S]*?published: (true|false)/g)].filter((m) => m[2] !== 'true').map((m) => m[1]);
eq('6 every release note is marked published', unpublished, []);
eq('7 the newest note is the package version', versions[0], JSON.parse(src('package.json')).version);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
