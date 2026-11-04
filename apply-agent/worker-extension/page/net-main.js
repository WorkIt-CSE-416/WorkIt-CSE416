// Put into a watched tab's frames in the page's MAIN world (ops/accounts.js), only while Apply
// watches that tab. It reads the answers to the page's own fetch and XHR calls (the body only for
// a call that isn't a GET, such as Workday's Create Account), and notes a window.open Chrome's
// pop-up blocker refused. It changes nothing the page does: each call goes on as the page made it.
// Its news goes to page/net-relay.js as a "apply-worker-net" event on the document.

(() => {
  if (window.__applyNetWatch) return;
  Object.defineProperty(window, "__applyNetWatch", { value: true });
  const EVENT = "apply-worker-net";
  const LIMIT = 256 * 1024; // characters of a body sent up at most
  const tell = (news) => {
    try {
      document.dispatchEvent(new CustomEvent(EVENT, { detail: JSON.stringify(news) }));
    } catch {}
  };
  const absolute = (url) => {
    try {
      return new URL(String(url), location.href).href;
    } catch {
      return String(url);
    }
  };
  const report = (requested, method, url, status, body) => {
    const news = { requested: absolute(requested), method: String(method || "GET").toUpperCase(), url: absolute(url || requested), status };
    if (typeof body === "string" && news.method !== "GET") {
      news.body = body.slice(0, LIMIT);
      news.truncated = body.length > LIMIT;
    }
    tell(news);
  };

  const fetch_ = window.fetch;
  if (fetch_) {
    window.fetch = function fetch(input, init) {
      const answer = fetch_.apply(this, arguments);
      try {
        const requested = input instanceof Request ? input.url : input;
        const method = (init && init.method) || (input instanceof Request ? input.method : "GET");
        answer.then((response) => {
          const done = (body) => report(requested, method, response.url, response.status, body);
          if (String(method).toUpperCase() === "GET") done();
          else response.clone().text().then(done, () => done());
        }, () => {});
      } catch {}
      return answer;
    };
  }

  const open_ = XMLHttpRequest.prototype.open;
  const send_ = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function open(method, url) {
    try {
      this.__applyCall = { method, url };
    } catch {}
    return open_.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function send() {
    try {
      const call = this.__applyCall;
      if (call) {
        this.addEventListener("loadend", () => {
          let body;
          try {
            body = this.responseType === "" || this.responseType === "text" ? this.responseText
              : this.responseType === "json" ? JSON.stringify(this.response) : undefined;
          } catch {}
          report(call.url, call.method, this.responseURL, this.status, body);
        });
      }
    } catch {}
    return send_.apply(this, arguments);
  };

  const windowOpen = window.open;
  window.open = function open(url) {
    const opened = windowOpen.apply(this, arguments);
    try {
      if (!opened && url) tell({ popup: absolute(url) });
    } catch {}
    return opened;
  };
})();
