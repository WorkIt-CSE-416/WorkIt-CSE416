// Helpers shared by the live rehearsals (rehearse.live.ts, panel.live.ts).
import type { Page, Request } from "@playwright/test";
import type { Handler } from "../loaded-extension";

const API = process.env.API ?? "http://127.0.0.1:8124";

/** localhost:8000, the extension's dev API, passed through to the local WorkIt API. */
export const localApi: Handler = async ({ url, method, headers, body }) => {
  if (url.host !== "localhost:8000") return undefined;
  const forward: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) if (typeof v === "string" && !["host", "connection", "content-length"].includes(k)) forward[k] = v;
  const res = await fetch(`${API}${url.pathname}${url.search}`, { method, headers: forward, body: ["GET", "HEAD"].includes(method) ? undefined : body });
  const out: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k)) out[k] = v;
  });
  return { status: res.status, headers: out, body: Buffer.from(await res.arrayBuffer()) };
};

/** The page that sent a request, or "service worker" (the extension's own reads, which have no frame). */
export function pageUrl(r: Request): string {
  try {
    return r.frame().page()?.url().slice(0, 300) ?? "";
  } catch {
    return "service worker";
  }
}

/** A GraphQL request's operation name (Ashby's submit is one), else the first words of a small body. */
export function operationOf(r: Request): string | null {
  const body = r.postData();
  if (!body) return null;
  const op = /"operationName"\s*:\s*"([^"]+)"/.exec(body);
  return op ? op[1] : body.length < 300 ? body.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "«email»").slice(0, 120) : `${body.length} bytes`;
}

/** What the tab's panel shows: its rows (key, mark, words), its status line, and whether a sign-in or a human check holds it. */
export async function readPanel(page: Page) {
  const host = page.locator("#workit-autofiller-overlay-host");
  const present = (await host.count()) > 0;
  const rows = present
    ? await host.locator(".row[data-key]").evaluateAll((nodes) =>
        nodes.map((n: any) => ({ key: n.dataset.key, mark: n.dataset.mark ?? null, text: (n.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 300) })),
      ).catch(() => [])
    : [];
  // The panel's words, without its styles.
  const panelText = present
    ? ((await host
        .evaluate((h: any) => {
          const root = h.shadowRoot;
          if (!root) return "";
          const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          const words: string[] = [];
          for (let n = walk.nextNode(); n; n = walk.nextNode()) if (!["STYLE", "SCRIPT"].includes(n.parentElement?.tagName ?? "")) words.push(n.textContent ?? "");
          return words.join(" ");
        })
        .catch(() => "")) as string).replace(/\s+/g, " ").trim().slice(0, 1500)
    : "";
  const pageText = ((await page.evaluate(() => document.body?.innerText ?? "").catch(() => "")) as string).replace(/\s+/g, " ").slice(0, 2000);
  return { present, rows, panelText, pageText };
}

/** Sends the tab's fill report as the student does: ⋯ > Report a problem > Send report. */
export async function sendReport(page: Page): Promise<string> {
  const host = page.locator("#workit-autofiller-overlay-host");
  if (!(await host.count())) return "no panel";
  try {
    await page.bringToFront();
    const item = host.getByRole("menuitem", { name: "Report a problem", exact: true });
    if (!(await item.isVisible())) await host.locator(".header").getByRole("button", { name: "More" }).click({ timeout: 5_000 });
    await item.click({ timeout: 5_000 });
    const card = host.locator('[data-slot="report"]');
    await card.getByRole("button", { name: "Send report" }).click({ timeout: 20_000 });
    await card.getByText("Sent. Thanks for telling WorkIt.").waitFor({ timeout: 15_000 });
    return "sent";
  } catch (error: any) {
    return `not sent: ${String(error.message).split("\n")[0].slice(0, 160)}`;
  }
}

