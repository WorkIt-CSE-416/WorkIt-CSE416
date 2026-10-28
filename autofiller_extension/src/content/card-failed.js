// The failed-field card (KAN-369): a field whose page doesn't show the answer
// WorkIt put gets a row card (row-card.js) that says "We put X; the page
// shows Y", why in plain words, and the site's own error text when the page
// marked the field invalid. Put mine back fills the planned answer once more
// and reads it back; Keep the page's takes what the page shows as the
// student's own answer, so the row no longer needs them. A value the site
// already turned down (it marked the field invalid, or Put mine back didn't
// take) is not filled again. The fill (content-script.js) hands each Plan to
// `use`. Loaded after row-card.js, overlay.js and batch-tab.js, before
// content-script.js, as window.WIA.failedCard.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  const { status, overlay, rowCard } = window.WIA;
  // Where the engine fills one field alone without touching another (its fillEach retry, decision 710).
  // Workable blanks what it isn't given; Workday and Eightfold change steps and questions.
  const ONE_FIELD_SITES = new Set(["greenhouse", "lever", "ashby", "rippling"]);
  const YOURS = "You kept what the page shows.";

  /** The latest Plan's fill: `{ site, answers, questions, read(names), put(name) }` (content-script.js). */
  let fill = null;
  // What the page showed for each failed row, by key, for the row's state it was read at: { at, shows, error, invalid }.
  const looked = new Map();
  // The fields whose value the site turned down again after Put mine back: never filled again.
  const turnedDown = new Set();
  const busy = new Set();

  const isEmpty = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  const words = (v) => (isEmpty(v) ? "(empty)" : Array.isArray(v) ? v.join(", ") : String(v));
  const stateOf = (row) => `${row.status}\n${row.reason ?? ""}`;
  const kindOf = (key) => fill?.questions.find((q) => q.name === key)?.kind;

  /** A failed field with an answer WorkIt planned, and not a file (checked as it is attached). */
  function carded(row) {
    const answer = fill?.answers[row.key];
    return Boolean(fill && !row.note && row.status === "failed" && answer !== undefined && kindOf(row.key) !== "file" && (typeof answer !== "object" || Array.isArray(answer)));
  }

  /**
   * The site's own error for the field, when the page marked it invalid: the
   * element aria-errormessage or aria-describedby names, else the nearest
   * alert or error-styled text around the field.
   */
  function siteError(field) {
    if (!field) return { invalid: false, error: "" };
    const controls = [field, ...field.querySelectorAll("input, select, textarea, [role=combobox]")];
    const marked = controls.find((c) => c.getAttribute("aria-invalid") === "true");
    if (!marked) return { invalid: false, error: "" };
    const ids = `${marked.getAttribute("aria-errormessage") ?? ""} ${marked.getAttribute("aria-describedby") ?? ""}`.split(/\s+/).filter(Boolean);
    let error = [...new Set(ids.map((id) => document.getElementById(id)?.innerText.trim()).filter(Boolean))].join(" ");
    for (let box = marked.parentElement; !error && box && box !== document.body; box = box.parentElement) {
      error = box.querySelector('[role="alert"], [class*="error" i]')?.innerText.trim() ?? "";
      if (box.querySelectorAll("input, select, textarea").length > controls.length) break; // past this field's own box
    }
    return { invalid: true, error };
  }

  /** Reads what the page shows for a failed row, and the site's error, then draws its card again. */
  async function look(row) {
    const at = stateOf(row);
    looked.set(row.key, { at });
    const shows = (await fill.read([row.key]).catch(() => ({})))[row.key];
    if (looked.get(row.key)?.at !== at) return;
    looked.set(row.key, { at, shows, ...siteError(window.WIA.fieldOf?.(row.key)) });
    // The row keeps what its page showed as it failed: the student's edit is a change from it (content-script.js's watchEdits).
    status.setStatus(row.key, row.status, row.reason, shows);
  }

  /** Why, in plain words: the site's, empty, another value. */
  function why(row, seen) {
    if (turnedDown.has(row.key)) return "It didn't take again, so WorkIt won't fill it again.";
    if (seen.invalid) return "The site rejected this value.";
    if (isEmpty(seen.shows)) return kindOf(row.key) === "text" || kindOf(row.key) === "textarea" ? "This field ended up empty on the page." : "This dropdown never committed a choice.";
    return "The page changed it.";
  }

  async function putBack(key) {
    busy.add(key);
    overlay.refresh();
    const result = await fill.put(key).catch((error) => ({ status: "failed", reason: error.message }));
    busy.delete(key);
    if (result.status !== "filled") turnedDown.add(key);
    looked.delete(key); // read the page again for the card
    status.setStatus(key, result.status, result.reason, result.shows);
  }

  function keepPage(row, shows) {
    if (isEmpty(shows)) status.setStatus(row.key, "skipped", "You left this blank.");
    else status.setStatus(row.key, "filled", YOURS, shows, "student");
  }

  rowCard.add((row) => {
    if (!carded(row)) return null;
    const seen = looked.get(row.key);
    if (seen?.at !== stateOf(row)) {
      look(row);
      return { lines: [`We put ${words(fill.answers[row.key])}.`] };
    }
    if (!("shows" in seen)) return { lines: [`We put ${words(fill.answers[row.key])}.`] };
    const buttons = [];
    // Not a value the site already turned down: WorkIt doesn't fight the site.
    if (ONE_FIELD_SITES.has(fill.site) && !seen.invalid && !turnedDown.has(row.key)) buttons.push({ label: "Put mine back", primary: true, onClick: () => putBack(row.key) });
    // An empty field the form requires can't be kept: the job system would refuse the submit.
    if (!(isEmpty(seen.shows) && row.required)) buttons.push({ label: "Keep the page's", onClick: () => keepPage(row, seen.shows) });
    return {
      lines: [`We put ${words(fill.answers[row.key])}; the page shows ${words(seen.shows)}.`, why(row, seen)],
      quote: seen.error || undefined,
      busy: busy.has(row.key),
      buttons,
    };
  });

  window.WIA.failedCard = {
    /** The latest Plan's fill, for its rows' cards. */
    use(next) {
      fill = next;
      looked.clear();
      overlay.refresh();
    },
  };
})();
