// Nothing of the webapp's session reaches the console (KAN-469): not the
// decoded session, nor its tokens, nor a piece of a cookie that won't decode
// (JSON.parse's message quotes the text it read). The extension's console
// is readable by anyone at chrome://extensions on a shared Chrome.
import { expect, test } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { EXTENSION_ID, loadExtension, webapp, type Loaded } from "./loaded-extension";

const COOKIE = "sb-zhdrvdrojipkluhzgsea-auth-token";
const SECRET = "secret-access-xyz";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

/** Every console line the service worker writes from now on, each argument as text (an Error's message and stack too). */
async function recordConsole(): Promise<() => Promise<string>> {
  await loaded.worker.evaluate(() => {
    const lines: string[] = ((globalThis as any).__lines = []);
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      const write = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
        write(...args);
      };
    }
  });
  return () => loaded.worker.evaluate(() => (globalThis as any).__lines.join("\n"));
}

const cookie = (json: string) => `base64-${Buffer.from(json).toString("base64url")}`;

for (const [what, json] of [
  ["a session with no refresh token", JSON.stringify({ access_token: SECRET, expires_at: 1 })],
  ["a session cookie that won't decode", `{"access_token":"${SECRET}", oops}`],
]) {
  test(`${what} writes nothing of the session to the console`, async () => {
    loaded = await loadExtension([new FakeApi().handler, webapp]);
    const logged = await recordConsole();
    await loaded.context.addCookies([{ name: COOKIE, value: cookie(json), url: "http://localhost:3000/" }]);
    // An extension page asks whether the student is signed in, as the popup does: the background reads the session.
    const page = await loaded.context.newPage();
    await page.goto(`chrome-extension://${EXTENSION_ID}/src/popup/popup.html`);
    expect(await page.evaluate(() => chrome.runtime.sendMessage({ type: "auth/status" }))).toMatchObject({ signedIn: false });
    await expect.poll(logged).toContain("webapp-session:");
    expect(await logged()).not.toContain(SECRET);
    expect(await logged()).not.toContain("expires_at");
  });
}
