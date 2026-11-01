/**
 * The Super Admin USB gate must be a page the browser can actually run.
 *
 * WHY THIS FILE EXISTS
 * `/super-admin-portal/` is served from a template literal in `app.ts`, and the
 * gate's pairing UI is hidden by default (`style="display: none"`) — only its
 * own inline script reveals it. So any syntax error in that script leaves the
 * operator staring at "Please connect your Super Admin USB drive" with no
 * button, no Ctrl+Shift+K handler, and no error message. That is what shipped:
 * `bufToB64u` wrote `/\+/g` inside the template literal, the escape was eaten at
 * emit time, the browser received `/+/g` — "Nothing to repeat" — and the whole
 * page died. #1230, live from the next deploy, and nothing caught it: tsc
 * compiles the template as a string, the pen-drive bundle is a separate build,
 * and a `toContain` grep would have matched the source text happily while the
 * emitted bytes were broken.
 *
 * So this test does the one thing that is equivalent to loading the page: it
 * evaluates the template literal exactly as the server does, pulls the inline
 * scripts out of the resulting HTML, and COMPILES them. `vm.compileFunction`
 * throws on a syntax error without executing anything, which is precisely the
 * browser's first step.
 *
 * NO_DATABASE: reads and compiles only.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "app.ts"), "utf8");

/** The gate HTML as the server emits it — escapes resolved, not as source text. */
function emittedGateHtml(): string {
  const route = appSource.indexOf('app.get(/^\\/super-admin-portal');
  expect(route, "the /super-admin-portal route is gone from app.ts — update this test's locator").toBeGreaterThan(-1);
  const send = appSource.indexOf("res.send(", route);
  const open = appSource.indexOf("`", send);
  expect(open).toBeGreaterThan(-1);

  // Walk to the closing backtick, honouring the source's own escape pairs, so a
  // `\`` inside the page cannot end the scan early.
  let i = open + 1;
  const body: string[] = [];
  while (i < appSource.length) {
    const ch = appSource[i];
    if (ch === "\\") {
      body.push(ch, appSource[i + 1]);
      i += 2;
      continue;
    }
    if (ch === "`") break;
    body.push(ch);
    i += 1;
  }
  const literal = `\x60${body.join("")}\x60`;
  // No interpolations are expected on this page; if that ever changes, this
  // test must grow a stub rather than quietly evaluate to the wrong bytes.
  expect(literal, "the gate template gained an interpolation — evaluate it differently").not.toMatch(/\$\{/);
  // The only input is this repository's own app.ts, evaluated in a context with
  // no globals so the template cannot reach anything.
  return vm.runInNewContext(`(${literal})`, Object.create(null)) as string;
}

function inlineScripts(html: string): string[] {
  const out: string[] = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) out.push(m[1]);
  return out;
}

describe("the served Super Admin gate page", () => {
  const html = emittedGateHtml();
  const scripts = inlineScripts(html);

  it("emits a page that carries the pairing controls the script must reveal", () => {
    // Guards against a vacuous pass: if the page stopped containing the gate at
    // all, "no scripts to compile" would be green.
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.reduce((n, s) => n + s.length, 0)).toBeGreaterThan(5_000);
    for (const id of ["pair-btn", "auth-btn", "err"]) {
      expect(html, `the gate page lost #${id}`).toContain(`id="${id}"`);
    }
  });

  it("compiles every inline script it sends to the browser", () => {
    scripts.forEach((js, index) => {
      let error: string | null = null;
      try {
        vm.compileFunction(js);
      } catch (err) {
        error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      }
      // The message has to name the symptom: an operator reading a CI failure
      // needs to see which construct the browser would have choked on.
      expect(error, `inline script #${index + 1} on /super-admin-portal/ does not parse`).toBeNull();
    });
  });

  it("sends the base64url helper a regex the browser can build", () => {
    // The specific defect, asserted as behaviour rather than as spelling: the
    // emitted text must still contain the escaped plus and slash. A single
    // backslash in the source arrives here as none at all.
    expect(html).toContain("replace(/\\+/g");
    expect(html).toContain("replace(/\\//g");
  });

  it("tells the operator to press a button that exists, and promises no PIN-free login", () => {
    // An operator standing at the gate with a working key was told "now press Sign
    // in". The submit control on that screen reads "Authenticate" — it is drawn by
    // the bundle on the drive, so the instruction has to match it or the key looks
    // dead. "No PIN is needed" was the other half: the bundle's own form rule
    // requires the PIN box, and with SUPER_ADMIN_REQUIRE_KEY on the server requires
    // it too, so the sentence promised a login this page cannot perform.
    //
    // Positive controls first, so a page that lost the key door entirely cannot
    // pass this by containing neither phrase.
    expect(html).toContain("sa-key-btn");
    expect(html).toContain("/api/super-admin/key-login/begin");
    expect(html.match(/press Authenticate/g)?.length).toBeGreaterThanOrEqual(2);

    expect(html).not.toMatch(/press Sign in/i);
    expect(html).not.toMatch(/No PIN is needed/i);

    // The page's PIN fallback used to reach for the request's own usbPin — the shared
    // four-digit value the bundle reads off the drive — and send it as the PIN so
    // either door would open. Now that the server refuses that substitution, copying
    // it here would only convert "no PIN typed" into "wrong PIN", which sends an
    // operator to their password manager instead than to the box in front of them.
    expect(html).not.toMatch(/typed\s*\|\|\s*body\.usbPin/);
  });
});
