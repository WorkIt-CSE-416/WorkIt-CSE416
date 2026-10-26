// The extension's Workday Sign-Up page (KAN-369), its options page: the one
// registration email and password the student may set for every company's
// Workday (background/workday-logins.js uses them in place of a password
// made per company).
//
// THE PASSWORD NEVER LEAVES THIS BROWSER. This page writes it straight to
// chrome.storage.local (`workday_signup`); it is never in a message, a log,
// an API call or the webapp. The page asks the worker only for the student's
// WorkIt email, to prefill the box, and never shows a saved password back.

const SIGNUP_KEY = "workday_signup";

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
  said.textContent = "Saved. WorkIt uses this login at each company's Workday from now on.";
});

clear.addEventListener("click", async () => {
  await chrome.storage.local.remove(SIGNUP_KEY);
  password.value = "";
  await prefill();
  said.textContent = "Cleared. WorkIt makes a new password for each company's Workday again.";
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
