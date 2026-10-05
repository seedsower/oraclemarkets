import { test } from "node:test";
import assert from "node:assert/strict";
import { artTargets, sanitizeSvg } from "./art";

const ok =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f2739"/><stop offset="1" stop-color="#283147"/></linearGradient></defs><rect width="400" height="240" fill="url(#g)"/><circle cx="200" cy="120" r="40" fill="#a98bf5" opacity="0.9"/><path d="M0 200 L400 200" stroke="#3fdc8c" stroke-width="4"/></svg>';

test("sanitizeSvg: plain shapes and gradients pass", () => {
  assert.equal(sanitizeSvg(`  ${ok}\n`), ok);
});

test("sanitizeSvg: comments are dropped and simple styles become attributes", () => {
  const styled = ok
    .replace(
      '<stop offset="0" stop-color="#1f2739"/>',
      '<stop offset="0" style="stop-color:#1f2739;stop-opacity:1" />',
    )
    .replace("<circle", "<!-- the sun -->\n  <circle");
  const out = sanitizeSvg(styled);
  assert.ok(out?.includes('<stop offset="0" stop-color="#1f2739" stop-opacity="1" />'));
  assert.ok(!out?.includes("<!--"));
  // A style can only produce allowed attributes.
  assert.equal(sanitizeSvg(ok.replace('r="40"', 'r="40" style="behavior:url(x.htc)"')), null);
  assert.equal(sanitizeSvg(ok.replace('r="40"', 'r="40" style="fill:url(https://e.x/a)"')), null);
  assert.equal(sanitizeSvg(ok.replace('r="40"', 'r="40" style="nonsense"')), null);
});

test("sanitizeSvg: anything that could run, load or say something is rejected", () => {
  const bad = [
    ok.replace("<circle", "<script>alert(1)</script><circle"),
    ok.replace('r="40"', 'r="40" onload="alert(1)"'),
    ok.replace('fill="#a98bf5"', 'fill="url(https://evil.example/x)"'),
    ok.replace("<circle", '<image href="https://evil.example/x.png"/><circle'),
    ok.replace("<circle", '<a href="javascript:alert(1)"><circle'),
    ok.replace("<circle", "<foreignObject><div>hi</div></foreignObject><circle"),
    ok.replace("<circle", "<text>BUY NOW</text><circle"),
    ok.replace("<circle", "<!-- x --><script>1</script><circle"),
    `<!DOCTYPE svg [<!ENTITY x "y">]>${ok}`,
    ok.replace('r="40"', "r='40'"),
    ok.replace('r="40"', "r=40"),
    ok.replace('viewBox="0 0 400 240"', ""),
    "<div>not svg</div>",
    ok + "<svg/>",
    ok.replace("</svg>", `${'<circle r="1"/>'.repeat(1500)}</svg>`),
  ];
  for (const b of bad) assert.equal(sanitizeSvg(b), null, b.slice(0, 120));
});

test("artTargets: live items only; legs and launched markets use their parent's art", () => {
  const now = 1000;
  const lists = {
    markets: [
      {
        publicKey: "M1",
        name: "Will SOL hit $300?",
        endTs: 2000,
        resolved: false,
        group: "11111111111111111111111111111111",
      },
      { publicKey: "M2", name: "Old", endTs: 500, resolved: false, group: "" },
      { publicKey: "M3", name: "Done", endTs: 2000, resolved: true, group: "" },
      { publicKey: "LEG", name: "Leg", endTs: 2000, resolved: false, group: "G1" },
      { publicKey: "FROMBET", name: "Launched", endTs: 2000, resolved: false, group: "" },
    ],
    groups: [{ publicKey: "G1", name: "Who wins?", endTs: 2000, resolved: false }],
    vaults: [{ publicKey: "V1", name: "Vault q", marketEndTs: 900, market: "" }],
    vaultGroups: [],
    betVaults: [
      {
        publicKey: "B1",
        name: "Will Utah get 3 feet of snow?",
        marketEndTs: 3000,
        market: "FROMBET",
        voided: false,
        refunding: false,
      },
      {
        publicKey: "B2",
        name: "Refunded",
        marketEndTs: 3000,
        market: "",
        voided: false,
        refunding: true,
      },
    ],
  };
  assert.deepEqual(
    artTargets(lists, now).map((t) => t.account),
    ["M1", "G1", "B1"],
  );
});
