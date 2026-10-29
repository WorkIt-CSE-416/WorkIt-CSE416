// SmartRecruiters' one-click form comes in two pages: the first (résumé,
// contact, consent), then the screening questions. Once the first page is
// filled, content-script.js asks this whether to move on: when no field on
// it needs the student (none failed, none required still empty), the engine
// presses its Next (never Submit; the engine refuses on the last page) and
// the screening page is filled in turn. Otherwise the first page is left to
// the student, with a line saying they press Next themselves.
(() => {
  window.WIA = window.WIA || {};
  const STEP_LINE = "_step";

  /** @returns {Promise<boolean>} whether the screening page now shows, for the fill to fill it */
  window.WIA.smartRecruitersNext = async function smartRecruitersNext(prepared) {
    const { status } = window.WIA;
    const send = window.WIA.ui.ask;
    if (/\/screening\/?$/.test(location.pathname)) return false; // already the last page
    const needed = await send({ type: "fill/required", site: prepared.site, questions: prepared.questions }).catch(() => null);
    // A required answer still being written is lost once the page is left; an optional one (the
    // message to the hiring team) is not worth holding the page for: the student can go Back to it.
    const failed = status.summary().fields.some((row) => row.status === "failed" || (row.required && row.status === "needs_generation"));
    const stay = (reason) => {
      status.register(STEP_LINE, "SmartRecruiters: first page", true, undefined, "todo");
      status.setStatus(STEP_LINE, "failed", reason);
      return false;
    };
    if (!needed?.ok || needed.empty.length || failed) return stay("Answer what's open on this page, then press Next. WorkIt fills the screening questions when they show.");
    const moved = await send({ type: "fill/next", step: "application" }).catch((error) => ({ ok: false, error: error.message }));
    if (!moved?.ok) return stay(`SmartRecruiters didn't move on (${moved?.error ?? "no answer"}). Press Next yourself; WorkIt fills the screening questions when they show.`);
    return moved.step === "screening";
  };
})();
