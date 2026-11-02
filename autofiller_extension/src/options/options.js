// The extension's options page (KAN-369, KAN-479): the Workday Sign-Up, the
// one registration email and password the student sets for every company's
// Workday (background/workday-logins.js makes no account without it), and
// Saved Company Logins, the login kept for each company's Workday, with Copy,
// Remove and Export. Per-company generated passwords are a later paid feature
// (KAN-481); installs from before KAN-479 hold some, which exist nowhere else.
//
// THE PASSWORDS NEVER LEAVE THIS BROWSER. This page writes the sign-up
// straight to chrome.storage.local (`workday_signup`) and reads the saved
// logins straight from it (`workday_logins`); no password is ever in a
// message, a log, an API call or the webapp. Remove asks the worker by the
// company's name only. The page asks the worker for the student's WorkIt
// email, to prefill the box, and never shows a saved sign-up password back.

import { AUTOFILL_OFF_KEY, CATEGORIES } from "../shared/autofill-categories.js";
import { HIDDEN_EVERYWHERE_KEY, PANEL_SITES_KEY } from "../shared/panel-keys.js";

const SIGNUP_KEY = "workday_signup";
const LOGINS_KEY = "workday_logins";

/** Each rule of the checklist, as Workday's own password rules ask. */
const RULES = {
  length: (p) => p.length >= 12,
  upper: (p) => /[A-Z]/.test(p),
  lower: (p) => /[a-z]/.test(p),
  number: (p) => /[0-9]/.test(p),
  special: (p) => /[^A-Za-z0-9\s]/.test(p),
};

const form = document.getElementById("signup-form");
const email = document.getElementById("signup-email");
const password = document.getElementById("signup-password");
const show = document.getElementById("signup-show");
const save = document.getElementById("signup-save");
const clear = document.getElementById("signup-clear");
const said = document.getElementById("signup-said");

/** Ticks the checklist for the password typed, and lets Save go only when every rule holds. */
function check() {
  let all = true;
  for (const [name, holds] of Object.entries(RULES)) {
    const met = holds(password.value);
    document.querySelector(`[data-rule=${name}]`).dataset.met = String(met);
    all &&= met;
  }
  save.disabled = !all || !email.validity.valid || !email.value.trim();
}

password.addEventListener("input", check);
email.addEventListener("input", check);

show.addEventListener("click", () => {
  const shown = password.type === "password";
  password.type = shown ? "text" : "password";
  show.textContent = shown ? "Hide" : "Show";
  show.setAttribute("aria-pressed", String(shown));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  check();
  if (save.disabled) return;
  await chrome.storage.local.set({ [SIGNUP_KEY]: { email: email.value.trim(), password: password.value } });
  password.value = "";
  check();
  said.textContent = "Saved. WorkIt uses this login at each new company's Workday from now on.";
});

clear.addEventListener("click", async () => {
  await chrome.storage.local.remove(SIGNUP_KEY);
  password.value = "";
  await prefill();
  said.textContent = "Cleared. WorkIt asks for a Workday password again before it makes the next account.";
});

/** The saved email (with a note that a password is saved), else the student's WorkIt email. */
async function prefill() {
  const saved = (await chrome.storage.local.get(SIGNUP_KEY))[SIGNUP_KEY];
  if (saved) {
    email.value = saved.email;
    said.textContent = "A password is saved. Type a new one to change it.";
  } else {
    const answer = await chrome.runtime.sendMessage({ type: "profile/get" }).catch(() => null);
    email.value = answer?.ok ? answer.profile?.email ?? "" : "";
  }
  check();
}

prefill();

// Sites You Allowed (background/site-access.js): each employer site the student allowed from the
// popup, with Remove, which gives the site's permission back to Chrome and stops WorkIt's scripts there.
const sites = document.getElementById("sites");
const sitesSaid = document.getElementById("sites-said");

async function listSites() {
  const answer = await chrome.runtime.sendMessage({ type: "sites/list" }).catch(() => null);
  if (!answer?.ok) {
    sitesSaid.textContent = "WorkIt couldn't list your sites. Reload this page to try again.";
    return;
  }
  sites.replaceChildren(
    ...answer.sites.map((origin) => {
      const item = document.createElement("li");
      const name = Object.assign(document.createElement("span"), { textContent: new URL(origin).hostname });
      const remove = Object.assign(document.createElement("button"), { type: "button", className: "secondary", textContent: "Remove" });
      remove.setAttribute("aria-label", `Remove ${new URL(origin).hostname}`);
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        const removed = await chrome.runtime.sendMessage({ type: "sites/remove", origin }).catch(() => null);
        if (!removed?.ok) {
          remove.disabled = false;
          sitesSaid.textContent = "WorkIt couldn't remove that site. Try again.";
          return;
        }
        sitesSaid.textContent = `Removed. WorkIt no longer runs on ${new URL(origin).hostname}.`;
        await listSites();
      });
      item.append(name, remove);
      return item;
    }),
  );
  if (!answer.sites.length) sites.replaceChildren(Object.assign(document.createElement("li"), { className: "muted", textContent: "None yet." }));
}

listSites();

// The WorkIt tab (KAN-480): Hide everywhere's switch and the sites where the student hid the tab
// (background.js keeps them: `panel_hidden_everywhere`, and `hidden` in `panel_sites` by host name),
// each with Remove, which shows the tab there again.
const everywhere = document.getElementById("tab-everywhere");
const hiddenSites = document.getElementById("hidden-sites");

everywhere.addEventListener("change", async () => {
  await chrome.storage.local.set({ [HIDDEN_EVERYWHERE_KEY]: !everywhere.checked });
});

async function listHiddenSites() {
  const kept = await chrome.storage.local.get([HIDDEN_EVERYWHERE_KEY, PANEL_SITES_KEY]);
  everywhere.checked = kept[HIDDEN_EVERYWHERE_KEY] !== true;
  const sitesKept = kept[PANEL_SITES_KEY] ?? {};
  const hidden = Object.keys(sitesKept).filter((host) => sitesKept[host]?.hidden).sort();
  hiddenSites.replaceChildren(
    ...hidden.map((host) => {
      const item = document.createElement("li");
      const name = Object.assign(document.createElement("span"), { textContent: host });
      const remove = Object.assign(document.createElement("button"), { type: "button", className: "secondary", textContent: "Remove" });
      remove.setAttribute("aria-label", `Remove ${host}`);
      remove.addEventListener("click", async () => {
        const now = (await chrome.storage.local.get(PANEL_SITES_KEY))[PANEL_SITES_KEY] ?? {};
        now[host] = { ...now[host], hidden: false };
        await chrome.storage.local.set({ [PANEL_SITES_KEY]: now });
        await listHiddenSites();
      });
      item.append(name, remove);
      return item;
    }),
  );
  if (!hidden.length) hiddenSites.replaceChildren(Object.assign(document.createElement("li"), { className: "muted", textContent: "None." }));
}

listHiddenSites();

// Fields to autofill (KAN-480, shared/autofill-categories.js): one switch a category, on unless the
// student turned it off. Off, the fill leaves the category's fields blank; the saved answers stay.
const fields = document.getElementById("fields");

async function listFields() {
  const kept = (await chrome.storage.local.get(AUTOFILL_OFF_KEY))[AUTOFILL_OFF_KEY];
  const off = new Set(Array.isArray(kept) ? kept : []);
  fields.replaceChildren(
    ...CATEGORIES.map(({ id, label }) => {
      const row = Object.assign(document.createElement("label"), { className: "switch" });
      const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: !off.has(id) });
      box.dataset.category = id;
      box.addEventListener("change", async () => {
        const now = new Set((await chrome.storage.local.get(AUTOFILL_OFF_KEY))[AUTOFILL_OFF_KEY] ?? []);
        if (box.checked) now.delete(id);
        else now.add(id);
        await chrome.storage.local.set({ [AUTOFILL_OFF_KEY]: [...now] });
      });
      row.append(box, ` ${label}`);
      return row;
    }),
  );
}

listFields();

// Saved Company Logins: each company's Workday login, read straight from chrome.storage.local.
const logins = document.getElementById("logins");
const loginsSaid = document.getElementById("logins-said");
const exportButton = document.getElementById("logins-export");

async function savedLogins() {
  return (await chrome.storage.local.get(LOGINS_KEY))[LOGINS_KEY] ?? {};
}

async function listLogins() {
  const saved = Object.entries(await savedLogins()).sort(([a], [b]) => a.localeCompare(b));
  exportButton.disabled = !saved.length;
  if (!saved.length) {
    logins.replaceChildren(Object.assign(document.createElement("li"), { className: "muted", textContent: "None yet." }));
    return;
  }
  logins.replaceChildren(
    ...saved.map(([tenant, login]) => {
      const item = document.createElement("li");
      item.dataset.tenant = tenant;
      const name = document.createElement("span");
      name.append(Object.assign(document.createElement("strong"), { textContent: tenant }), document.createElement("br"),
        Object.assign(document.createElement("span"), { className: "muted", textContent: login.email }));
      const copy = Object.assign(document.createElement("button"), { type: "button", className: "secondary", textContent: "Copy" });
      copy.setAttribute("aria-label", `Copy the password for ${tenant}`);
      copy.addEventListener("click", async () => {
        // Read again at the press: the list may be older than the saved login.
        const now = (await savedLogins())[tenant];
        if (!now?.password) return void (loginsSaid.textContent = "That login is gone. Reload this page.");
        await navigator.clipboard.writeText(now.password);
        loginsSaid.textContent = `Copied the password for ${tenant}.`;
      });
      const remove = Object.assign(document.createElement("button"), { type: "button", className: "secondary", textContent: "Remove" });
      remove.setAttribute("aria-label", `Remove the login for ${tenant}`);
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        const removed = await chrome.runtime.sendMessage({ type: "workday/remove-login", tenant }).catch(() => null);
        if (!removed?.ok) {
          remove.disabled = false;
          loginsSaid.textContent = "WorkIt couldn't remove that login. Try again.";
          return;
        }
        loginsSaid.textContent = `Removed the login for ${tenant}.`;
      });
      const buttons = document.createElement("span");
      buttons.className = "buttons";
      buttons.append(copy, remove);
      item.append(name, buttons);
      return item;
    }),
  );
}

// A CSV in the columns Chrome's and Google's password managers import (name, url, username, password).
exportButton.addEventListener("click", async () => {
  const field = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = Object.entries(await savedLogins()).map(([tenant, login]) =>
    [`Workday (${tenant})`, `https://${tenant}/`, login.email, login.password].map(field).join(","));
  const csv = ["name,url,username,password", ...rows].join("\r\n") + "\r\n";
  const link = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
    download: "workit-workday-logins.csv",
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  loginsSaid.textContent = "Exported. Keep the file somewhere safe: it holds your passwords.";
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && LOGINS_KEY in changes) listLogins();
});

listLogins();
