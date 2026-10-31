// The unpacked extension loaded into Chromium, as a student runs it: its
// service worker, its tabs, tab groups, cookies and messages are all real.
// Only the network is fake. Chromium sends every host name to servers in this
// process (--host-resolver-rules): the WorkIt API on localhost:8000, the
// webapp on localhost:3000, and every https:// host (job systems, their APIs)
// to one HTTPS server, which asks each Handler in turn. Nothing reaches the
// internet or a real WorkIt API, even one running on this machine.
//
// Why not Playwright's routing (page.route / context.route): it never sees a
// request from the extension's service worker, nor the first load of a tab the
// extension opens (checked 2026-10-25, Playwright 1.64). The existing page
// tests (extension.ts) block service workers; this harness must not.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttp, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttps } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Locator, type Page, type Worker } from "@playwright/test";
import { CERT, KEY } from "./fake-tls";
import { manifestId } from "../store/extension-id.mjs";

export const EXTENSION = join(__dirname, "..");
/** The id manifest.json's `key` pins (store/extension-id.mjs). */
export const EXTENSION_ID = manifestId(EXTENSION);

export type Request = { url: URL; method: string; headers: IncomingHttpHeaders; body: Buffer };
/** `drop`: close the connection with no answer, as an API that is unreachable (the browser's "Failed to fetch"). */
export type Reply = { status?: number; headers?: Record<string, string>; body?: string | Buffer; json?: unknown; drop?: true };
/** Answers a request, or returns undefined to pass it to the next handler. */
export type Handler = (request: Request) => Reply | undefined | Promise<Reply | undefined>;

export type Loaded = {
  context: BrowserContext;
  /** The extension's background service worker. */
  worker: Worker;
  /** Every URL the browser asked for, in order. */
  asked: string[];
  close(): Promise<void>;
};

export type FakeNet = {
  /** Chromium's flags that send every host to this fake network. */
  args: string[];
  /** Every URL the browser asked for, in order. */
  asked: string[];
  close(): void;
};

/**
 * Servers in this process that answer every request Chromium makes, once
 * started with `args`: localhost (the API, the webapp) over plain HTTP, every
 * other host over HTTPS. Each request goes to the handlers in turn; one no
 * handler answers gets a 404.
 */
export async function startFakeNet(handlers: Handler[], extension = EXTENSION, live = false): Promise<FakeNet> {
  const asked: string[] = [];
  const serve = (scheme: string) => async (incoming: IncomingMessage, response: ServerResponse) => {
    const body = await new Promise<Buffer>((done) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk) => chunks.push(chunk));
      incoming.on("end", () => done(Buffer.concat(chunks)));
    });
    const url = new URL(`${scheme}://${incoming.headers.host}${incoming.url}`);
    asked.push(url.href);
    let reply: Reply | undefined;
    try {
      for (const handler of handlers) if ((reply = await handler({ url, method: incoming.method!, headers: incoming.headers, body }))) break;
    } catch (error) {
      reply = { status: 500, body: String(error) };
    }
    reply ??= { status: 404, body: "" };
    if (reply.drop) return void incoming.socket.destroy();
    // Saved pages load module scripts from another origin (Greenhouse's CDN), which only run with CORS
    // headers; Playwright's route.fulfill adds them itself, and the saved responses don't keep them.
    const cors = incoming.headers.origin ? { "access-control-allow-origin": incoming.headers.origin, "access-control-allow-credentials": "true" } : {};
    const headers = { ...cors, ...(reply.json !== undefined ? { "content-type": "application/json" } : {}), ...reply.headers };
    response.writeHead(reply.status ?? 200, headers);
    response.end(reply.json !== undefined ? JSON.stringify(reply.json) : reply.body);
  };
  const http = createHttp(serve("http"));
  const https = createHttps({ key: KEY, cert: CERT }, serve("https"));
  const port = async (server: typeof http | typeof https) => {
    await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
    return (server.address() as AddressInfo).port;
  };
  const [httpPort, httpsPort] = [await port(http), await port(https)];
  return {
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      // `live`: only localhost (the fake API and webapp) is faked; job systems are the real ones, for a live check.
      `--host-resolver-rules=MAP localhost 127.0.0.1:${httpPort}${live ? "" : `, MAP * 127.0.0.1:${httpsPort}`}`,
      "--ignore-certificate-errors",
      // Every host now resolves to this machine: let public pages reach it.
      "--disable-features=LocalNetworkAccessChecks",
    ],
    asked,
    close() {
      // A handler that never answers (an API that hangs) keeps its connection open: close it too.
      http.closeAllConnections();
      https.closeAllConnections();
      http.close();
      https.close();
    },
  };
}

/**
 * Starts the fake network and Chromium with the extension loaded (headless,
 * unless HEADED is set). Playwright tells each page it has focus, so its
 * tests can type; a background tab never has it, so `focused: false` (the
 * default) turns that off: `document.hasFocus()` is false and focus events
 * wait, as in the student's Chrome.
 */
export async function loadExtension(
  handlers: Handler[],
  {
    focused = false,
    headless = !process.env.HEADED,
    profile: kept = undefined as string | undefined,
    args = [] as string[],
    grantHosts = [] as string[],
    closedPanel = false,
    live = false,
    welcome = false,
    version = undefined as string | undefined,
  } = {},
): Promise<Loaded> {
  // A copy, so its panel's and marks' shadow roots can be open for Playwright's locators (which can't reach a
  // closed one); `closedPanel` keeps the student's closed roots, for the tests of what the page can reach.
  // `welcome`: the install opens onboarding's extension step (install.js), as for a student; off, every other test's tabs are its own.
  // `version`: the manifest's version in the copy, so a second start on a kept `profile` is an update to Chrome.
  const copy = testCopy(grantHosts, !closedPanel, welcome, version);
  const net = await startFakeNet(handlers, copy, live);
  // `profile`: a Chromium profile folder to start (again) with, which the caller keeps; else a new one, removed on close.
  const profile = kept ?? mkdtempSync(join(tmpdir(), "workit-extension-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", // the full browser: the headless shell can't load extensions
    headless,
    // Playwright turns off Chrome's own handling of tabs no one looks at; the student's Chrome has it.
    ignoreDefaultArgs: ["--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"],
    args: [...net.args, ...args],
  });
  if (!focused) {
    const unfocus = (page: Page) =>
      context.newCDPSession(page).then((cdp) => cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false })).catch(() => {});
    context.pages().forEach(unfocus);
    context.on("page", unfocus);
  }
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));

  return {
    context,
    worker,
    asked: net.asked,
    async close() {
      await context.close();
      net.close();
      if (!kept) rmSync(profile, { recursive: true, force: true });
      if (copy) rmSync(copy, { recursive: true, force: true });
    },
  };
}

/** The files whose shadow root is closed for the student and opened in the test copies: the panel, and the marks (ring and dot). */
export const CLOSED_ROOT_FILES = ["src/content/panel.js", "src/content/marks.js"];

/**
 * A closed-root file's source (CLOSED_ROOT_FILES) with its shadow root open,
 * for tests only: Playwright's locators can't reach a closed root. The
 * student's stay closed.
 */
export function openPanel(source: string, file = "src/content/panel.js"): string {
  const open = source.replace('attachShadow({ mode: "closed" })', 'attachShadow({ mode: "open" })');
  if (open === source) throw new Error(`${file} no longer attaches a closed shadow root: update openPanel`);
  return open;
}

const INSTALL_FILE = "src/background/install.js";

/** install.js's source with no onboarding tab on install, for the tests that don't test it (`welcome`). */
function noWelcome(source: string): string {
  const quiet = source.replace('details.reason === "install"', "false");
  if (quiet === source) throw new Error(`${INSTALL_FILE} no longer checks details.reason === "install": update noWelcome`);
  return quiet;
}

/**
 * A copy of the extension to load: its panel's and marks' roots open when `open` (see
 * openPanel), and allowed to read `hosts` too: what activeTab grants when the
 * student presses the toolbar icon on a page outside the manifest's hosts,
 * which a test can't press, and with no onboarding tab on install unless
 * `welcome`. Same key, so the same extension id.
 */
function testCopy(hosts: string[], open: boolean, welcome: boolean, version?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "workit-extension-copy-"));
  for (const part of ["src", "icons", "fonts", "fill-engine/dist"]) cpSync(join(EXTENSION, part), join(dir, part), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(EXTENSION, "manifest.json"), "utf8"));
  manifest.host_permissions.push(...hosts);
  if (version) manifest.version = version;
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  if (open) for (const file of CLOSED_ROOT_FILES) writeFileSync(join(dir, file), openPanel(readFileSync(join(dir, file), "utf8"), file));
  if (!welcome) writeFileSync(join(dir, INSTALL_FILE), noWelcome(readFileSync(join(dir, INSTALL_FILE), "utf8")));
  return dir;
}

/** The name of the webapp's Supabase session cookie. */
export const SESSION_COOKIE = "sb-zhdrvdrojipkluhzgsea-auth-token";

/** The session cookie's value, as @supabase/ssr writes it, for a fake token expiring `expiresIn` seconds from now. */
export function sessionCookie(accessToken = "test-access-token", expiresIn = 3600): string {
  const session = { access_token: accessToken, refresh_token: "test-refresh-token", expires_at: Math.floor(Date.now() / 1000) + expiresIn };
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

/** The webapp's Supabase session cookie, as background/webapp-session.js reads it, for a fake token. */
export async function signIn(context: BrowserContext, accessToken = "test-access-token", expiresIn = 3600): Promise<void> {
  await context.addCookies([{ name: SESSION_COOKIE, value: sessionCookie(accessToken, expiresIn), url: "http://localhost:3000/" }]);
}

/** A page of the webapp (localhost:3000), from which a test sends the messages the webapp sends. */
export const webapp: Handler = ({ url }) =>
  url.host === "localhost:3000" ? { headers: { "content-type": "text/html" }, body: "<!doctype html><title>WorkIt</title><p>WorkIt" } : undefined;

/** Sends `message` to the extension as the webapp does (externally_connectable), from a webapp page. */
export function sendFromWebapp(page: Page, message: unknown): Promise<any> {
  return page.evaluate(
    ([id, message]) => new Promise((resolve) => (window as any).chrome.runtime.sendMessage(id, message, resolve)),
    [EXTENSION_ID, message] as const,
  );
}

/**
 * The student's Next Thing (KAN-396) from the panel `host` (its
 * #workit-autofiller-overlay-host): Alt+N, the walk across the batch's tabs.
 * The bottom button no longer runs it (KAN-424: "Answer 1 of N" stays on its
 * own page's first red field). A test can't press an extension command's
 * keys, so Alt+N is the background's own handler, once the fill is done.
 */
export async function pressNextThing(loaded: Loaded, host: Locator): Promise<void> {
  const button = host.locator('[data-slot="primary"] .primary-button').first();
  for (let n = 0; n < 50 && /Filling/.test((await button.innerText({ timeout: 30_000 })) ?? ""); n++) await host.page().waitForTimeout(200);
  await loaded.worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    await (globalThis as any).workitCommand("next-thing", tab);
  }, host.page().url());
}

/**
 * One item of the panel's ⋯ menu (KAN-369 Q4: I submitted this, Skip, Fill
 * Again, Report a problem, Settings) in the panel `host`: opens the menu
 * when it is shut and resolves with the item, to click.
 */
export async function menuItem(host: Locator, name: string): Promise<Locator> {
  const item = host.getByRole("menuitem", { name, exact: true });
  if (!(await item.isVisible())) await host.locator(".header").getByRole("button", { name: "More" }).click();
  return item;
}
