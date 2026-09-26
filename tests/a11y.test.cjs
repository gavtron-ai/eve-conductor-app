// v0.244.0 (round three, item 22): every control a screen reader or a keyboard reaches has a NAME.
// Read with the TypeScript compiler over every .tsx in src (JSX parsed, not grepped):
//   1. a checkbox has a <label> ancestor, or aria-label / aria-labelledby / title / id (for a htmlFor)
//   2. a button whose visible text carries no letters (×, ✕, ✓, ⚙ …) has a title or an aria-label
// Measured 2026-09-23 before the fix: 51 checkboxes, 2 unnamed; 381 buttons, 5 unnamed icon-only.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const root = path.join(__dirname, '..', 'src');
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.tsx')) files.push(p); } };
walk(root);

let checkboxes = 0, buttons = 0;
const unnamedCheckboxes = [], unnamedButtons = [];
for (const f of files) {
  const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const where = (n) => `${path.relative(root, f).replace(/\\/g, '/')}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const attr = (open, name) => open.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText() === name);
  const visit = (n, ancestors) => {
    const open = ts.isJsxSelfClosingElement(n) ? n : ts.isJsxElement(n) ? n.openingElement : null;
    if (open && open.tagName.getText() === 'input') {
      const t = attr(open, 'type');
      if (t && t.initializer && /checkbox/.test(t.initializer.getText())) {
        checkboxes++;
        const named = ancestors.some((a) => ts.isJsxElement(a) && a.openingElement.tagName.getText() === 'label')
          || ['aria-label', 'aria-labelledby', 'title', 'id'].some((k) => attr(open, k));
        if (!named) unnamedCheckboxes.push(where(n));
      }
    }
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText() === 'button') {
      buttons++;
      const o = n.openingElement;
      const named = ['title', 'aria-label', 'aria-labelledby'].some((k) => attr(o, k));
      const texts = n.children.filter(ts.isJsxText).map((c) => c.getText().trim()).filter(Boolean).join(' ');
      const hasOther = n.children.some((c) => ts.isJsxExpression(c) || ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c));
      const letters = texts.replace(/[^\p{L}]/gu, '');
      if (!named && !hasOther && letters.length === 0) unnamedButtons.push(`${where(n)} ${JSON.stringify(texts)}`);
    }
    ts.forEachChild(n, (c) => visit(c, [...ancestors, n]));
  };
  visit(sf, []);
}
eq(`1 every checkbox has a name (${checkboxes} checkboxes in ${files.length} files)`, unnamedCheckboxes, []);
eq(`2 every icon-only button has a title or an aria-label (${buttons} buttons)`, unnamedButtons, []);
eq('3 the census saw the app (not an empty tree)', checkboxes > 40 && buttons > 300, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
