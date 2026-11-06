"""The Apply window's page: its HTML, CSS and script, served by the dashboard
(dashboard.py). Every value from a form or the Tracker is set as text, never as markup."""

PAGE = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Apply</title>
<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Geist+Mono:wght@400&display=swap"><style>{style}</style>
{tabs}{inbox}{history}{accounts}<div id="workers" hidden>
<div id="grid" style="grid-template-columns: repeat({columns}, minmax(0, 1fr)); grid-template-rows: repeat({rows}, minmax(0, 1fr))">{tiles}</div>
</div>
<script>
const workers = {workers};
const TOKEN = '{closing}';
// The Sent row's links are the window's own: a click there never takes control of the tile.
document.addEventListener('mousedown', e => { if (e.target.closest('.sent, .askclaude')) e.stopPropagation(); }, true);
// One event at a time, in order: sent at once, a burst of keys could reach the page shuffled.
let chain = Promise.resolve();
const send = (k, event) => (chain = chain.then(() => fetch(`/input/${k}`, {method: 'POST', headers: {'X-Apply-Token': TOKEN}, body: JSON.stringify(event)}))
  .then(r => r.status === 200 ? r.json() : null).catch(() => null));
// A trackpad sends dozens of wheel events a second: they go as one every 50 ms.
let wheel = null;
const scroll = (k, e, at) => {
  const lines = e.deltaMode === 1 ? 40 : 1;
  if (wheel) { wheel.dx += e.deltaX * lines; wheel.dy += e.deltaY * lines; return; }
  wheel = {type: 'wheel', dx: e.deltaX * lines, dy: e.deltaY * lines, ...at};
  setTimeout(() => { send(k, wheel); wheel = null; }, 50);
};
const MODIFIER_KEYS = ['Alt', 'Control', 'Meta', 'Shift', 'CapsLock', 'Fn'];
const SHORTCUTS = 'azyx';  // Cmd/Ctrl + these reach the page; Cmd+C copies from it, Cmd+V pastes; the rest stay the window's
const BUTTONS = ['left', 'middle', 'right'];
const MODIFIERS = ['Alt', 'Control', 'Meta', 'Shift'];
// Click a tile and it fills the window and takes the keyboard: Lisul is
// controlling that browser till Esc. The click itself only enlarges it,
// so a click on a small tile never lands on the page (on Submit, say).
let controlled = null;
let menu = null;  // a <select>'s options, drawn here: headless Chrome draws none
const closeMenu = () => { if (menu) menu.remove(); menu = null; };
const openMenu = (k, select, at) => {
  closeMenu();
  const tile = document.querySelector(`.tile[data-k="${k}"]`), img = document.getElementById('frame-' + k);
  menu = document.createElement('div');
  menu.className = 'menu';
  select.options.forEach((option, index) => {
    const row = document.createElement('div');
    row.textContent = option.label || '\u00a0';
    row.title = option.label;
    row.className = [index === select.selected && 'chosen', option.disabled && 'disabled'].filter(Boolean).join(' ');
    row.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); send(k, {type: 'choose', index}); closeMenu(); });
    menu.appendChild(row);
  });
  tile.appendChild(menu);
  menu.style.left = Math.min(img.offsetLeft + at.x, tile.clientWidth - menu.offsetWidth) + 'px';
  menu.style.top = Math.min(img.offsetTop + at.y, tile.clientHeight - menu.offsetHeight) + 'px';
  menu.querySelector('.chosen')?.scrollIntoView({block: 'nearest'});
};
const control = (k) => {
  closeMenu();
  document.querySelectorAll('.tile').forEach(t => t.classList.toggle('big', t.dataset.k == k));
  controlled = k;
  if (k !== null) document.getElementById('frame-' + k).focus();
};
const show = (k, jpeg) => {
  const img = document.getElementById('frame-' + k);
  if (!img) return;
  const old = img.src;
  img.src = URL.createObjectURL(new Blob([jpeg], {type: 'image/jpeg'}));
  if (old.startsWith('blob:')) URL.revokeObjectURL(old);
};
// Every tile's frames come on one connection (/frames): (worker, length), then the JPEG.
const play = async () => {
  try {
    const reader = (await fetch('/frames')).body.getReader();
    let buffer = new Uint8Array(0);
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      const joined = new Uint8Array(buffer.length + value.length);
      joined.set(buffer); joined.set(value, buffer.length); buffer = joined;
      while (buffer.length >= 8) {
        const head = new DataView(buffer.buffer, buffer.byteOffset, 8);
        const k = head.getUint32(0), length = head.getUint32(4);
        if (buffer.length < 8 + length) break;
        show(k, buffer.slice(8, 8 + length));
        buffer = buffer.slice(8 + length);
      }
    }
  } catch (e) {}
  setTimeout(play, 1000);  // the dashboard restarting: pick the frames up again
};
if (workers) play();
// The page asked for a file (headless Chrome shows no picker): pick it here and it is sent to the page.
const read = (file) => new Promise(done => { const r = new FileReader();
  r.onload = () => done({name: file.name, data: r.result.split(',')[1]}); r.readAsDataURL(file); });
for (let k = 0; k < workers; k++) {
  const bar = document.getElementById('file-' + k), picker = bar.querySelector('input');
  picker.addEventListener('change', async () => {
    send(k, {type: 'files', files: await Promise.all([...picker.files].map(read))});
    picker.value = ''; bar.hidden = true;
  });
  bar.querySelector('button').addEventListener('click', () => { send(k, {type: 'files', files: []}); bar.hidden = true; });
}
for (let k = 0; k < workers; k++) {
  const img = document.getElementById('frame-' + k);
  const at = (e) => { const r = img.getBoundingClientRect();
    return {x: e.clientX - r.left, y: e.clientY - r.top, w: img.clientWidth, h: img.clientHeight}; };
  let pressed = false;
  const tile = document.querySelector(`.tile[data-k="${k}"]`);
  tile.addEventListener('mousedown', e => { if (controlled !== k) { e.preventDefault(); control(k); } });
  img.addEventListener('mousedown', e => { if (controlled !== k) return;
    e.preventDefault(); pressed = true; closeMenu();
    const point = at(e);
    send(k, {type: 'down', button: BUTTONS[e.button], clicks: e.detail, ...point})
      .then(reply => reply && reply.menu && openMenu(k, reply.menu, point)); });
  // Let go anywhere, even off the tile, and the page lets go too.
  window.addEventListener('mouseup', e => { if (!pressed) return; pressed = false;
    send(k, {type: 'up', button: BUTTONS[e.button], clicks: e.detail, ...at(e)}); });
  let moved = 0;
  img.addEventListener('mousemove', e => { if (controlled === k && Date.now() - moved > 50) { moved = Date.now(); send(k, {type: 'move', ...at(e)}); } });
  img.addEventListener('wheel', e => { e.preventDefault(); scroll(k, e, at(e)); }, {passive: false});
  img.addEventListener('contextmenu', e => e.preventDefault());
}
// Cmd+C (and Cmd+X) copies the text selected on the page to this Mac's clipboard.
const copy = async (k, cut) => {
  const reply = await send(k, {type: 'copy'});
  if (reply && reply.text) { try { await navigator.clipboard.writeText(reply.text); } catch (e) {} }
  if (cut) send(k, {type: 'key', key: 'Backspace'});
};
document.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('.askclaude')) return;  // typing to Claude, not to the page
  if (controlled === null || e.isComposing || MODIFIER_KEYS.includes(e.key)) return;
  if (e.key === 'Escape' && menu) { closeMenu(); return; }
  if (e.key === 'Escape') { send(controlled, {type: 'key', key: 'Escape'}); control(null); return; }
  const command = e.metaKey || e.ctrlKey, letter = e.key.length === 1 ? e.key.toLowerCase() : '';
  if (command && letter === 'v') return;  // the paste event sends it
  if (command && (letter === 'c' || letter === 'x')) { e.preventDefault(); copy(controlled, letter === 'x'); return; }
  if (command && letter && !SHORTCUTS.includes(letter)) return;  // Cmd+R, Cmd+W...: the window's, never the page's
  e.preventDefault();
  if (letter && !command) send(controlled, {type: 'text', text: e.key});
  else send(controlled, {type: 'key', key: e.key, modifiers: MODIFIERS.filter(m => e.getModifierState(m))});
});
document.addEventListener('paste', e => {
  if (controlled === null || (e.target.closest && e.target.closest('.askclaude'))) return;
  e.preventDefault();
  send(controlled, {type: 'text', text: e.clipboardData.getData('text')});
});
setInterval(async () => {
  let state;
  try { state = await (await fetch('/state?front=' + (document.hasFocus() ? 1 : 0))).json(); } catch (e) { return; }
  if (state.tiles.length > workers) { location.reload(); return; }  // a link sent in (--into): its tile too
  renderInbox(state);
  state.tiles.forEach((c, k) => {
    const banner = document.getElementById('banner-' + k);
    banner.className = 'banner ' + c.tone + (c.verified ? ' verified' : '');
    // A filling tile says what Apply is doing, small too: "Filling · Planning answers for 'Application Questions'".
    banner.querySelector('.label').textContent = c.tone === 'filling' && c.doing ? `${c.label} · ${c.doing}` : c.label;
    banner.querySelector('.fields').textContent = c.asked ? `${c.filled} of ${c.asked} answers` : '';
    banner.title = [c.label, c.detail].filter(Boolean).join('\\n');
    const detail = document.getElementById('detail-' + k);
    if (detail.dataset.shown !== c.detail + (c.error || '')) {  // drawn again only when it changed, so Details stays open
      detail.dataset.shown = c.detail + (c.error || '');
      detail.textContent = c.detail;
      if (c.error) {
        const more = document.createElement('details'), what = document.createElement('summary');
        what.textContent = 'Details';
        more.append(what, c.error);
        detail.append(more);
      }
    }
    const words = [c.company, c.role, c.system].filter(Boolean).join(' · ');
    const caption = document.getElementById('caption-' + k);
    caption.textContent = words || `Browser ${k + 1}`;
    caption.title = c.line || words;
    const sent = document.getElementById('sent-' + k), files = c.files || [];
    const before = c.status === 'filling' && !!c.stage;  // held for Start: written, not yet attached
    if (sent.dataset.files !== JSON.stringify([files, before])) {  // drawn again only when the list changed
      sent.dataset.files = JSON.stringify([files, before]);
      sent.replaceChildren(...files.map((f, i) => {
        const doc = document.createElement('span'), view = document.createElement('a'), find = document.createElement('button');
        doc.className = 'doc'; doc.title = `${f.label}: ${f.name}`;
        view.textContent = 'View'; view.href = `/file/${k}/${i}`; view.target = '_blank';
        find.textContent = 'Show in Finder';
        find.onclick = () => fetch(`/reveal/${k}/${i}`, {method: 'POST', headers: {'X-Apply-Token': TOKEN}});
        doc.append(`${before ? 'Will attach' : 'Attached'} ${f.name} `, view, ' · ', find);
        return doc;
      }));
      sent.hidden = !files.length;
    }
    const paused = document.getElementById('resume-' + k), resume = c.resume;
    paused.hidden = !resume;
    if (resume) {
      paused.querySelector('button').disabled = !resume.ok;
      paused.querySelector('button').textContent = resume.label || 'Resume';
      paused.querySelector('.why').textContent = resume.why || 'Fixed it on the page? Resume goes on from there.';
    }
    drawAsk(k, c);
    const capture = document.getElementById('capture-' + k);
    capture.hidden = !c.capture;
    capture.textContent = capture.title = c.capture || '';
    const bar = document.getElementById('file-' + k);
    bar.hidden = !c.file;
    bar.querySelector('input').multiple = c.file === 'selectMultiple';
  });
}, 1000);
// Ask Claude (KAN-638): Lisul tells Claude what is wrong on the held form, and Claude fixes it there. One thread per
// Application, shared with `apply ask` in a terminal. A fact he stated is saved to his answers only on his click.
const askLine = (t) => {
  const lines = [make('div', {className: 'you', textContent: `You${t.via === 'terminal' ? ' (terminal)' : ''}: ${t.message}`})];
  if (t.state === 'waiting' || t.state === 'working') {
    lines.push(make('div', {className: 'claude working', textContent: 'Claude is working on the form…'}));
    return make('div', {className: 'turn'}, lines);
  }
  lines.push(make('div', {className: 'claude' + (t.state === 'failed' ? ' error' : ''), textContent: `Claude: ${t.reply || ''}`}));
  for (const c of t.changed || []) lines.push(make('div', {className: 'did', textContent:
    `Changed ${c.field}${c.step ? ' (' + c.step + ')' : ''} → ${c.shown} · ${c.read_back}`}));
  for (const c of t.couldnt || []) lines.push(make('div', {className: 'did error', textContent: `Couldn't: ${c}`}));
  for (const w of t.waiting || []) lines.push(make('div', {className: 'did needs', textContent: `Yours to do: ${w}`}));
  (t.offers || []).forEach((o, index) => {
    const save = make('button', {className: 'tonal', textContent: o.saved ? 'Saved' : 'Save to my answers', disabled: !!o.saved,
      title: 'Later forms answer this question from your Answer bank', onclick: async () => {
        save.disabled = true;
        try {
          const reply = await fetch('/ask/remember', {method: 'POST', body: JSON.stringify({ask: t.id, index}),
            headers: {'Content-Type': 'application/json', 'X-Apply-Token': TOKEN}});
          const data = await reply.json();
          toast(reply.ok ? data.message : data.error || 'Not saved.');
          if (!reply.ok) save.disabled = false;
        } catch (e) { toast('Apply is not answering: is it still running?'); save.disabled = false; }
      }});
    lines.push(make('div', {className: 'offer'}, `Remember for later forms? ${o.question} → ${o.answer} `, save));
  });
  return make('div', {className: 'turn'}, lines);
};
const drawAsk = (k, c) => {
  const bar = document.getElementById('ask-' + k), thread = c.thread || [];
  if (!bar) return;
  bar.hidden = !c.askable && !thread.length;
  const busy = thread.some(t => t.state === 'waiting' || t.state === 'working');
  const input = bar.querySelector('input'), button = bar.querySelector('button.go');
  input.disabled = button.disabled = !c.askable || busy;
  input.placeholder = c.askable ? 'Tell Claude what to fix on this form, e.g. "page 2’s GPA is wrong"' : 'The form is no longer held for you';
  const drawn = JSON.stringify(thread);
  if (bar.dataset.thread !== drawn) {
    bar.dataset.thread = drawn;
    const list = bar.querySelector('.thread');
    list.replaceChildren(...thread.map(askLine));
    list.scrollTop = list.scrollHeight;  // the latest reply in view
  }
};
document.addEventListener('submit', async (e) => {
  const bar = e.target.closest && e.target.closest('.askclaude');
  if (!bar) return;
  e.preventDefault();
  const input = bar.querySelector('input'), k = bar.id.replace('ask-', '');
  if (!input.value.trim()) return;
  input.disabled = true;
  try {
    const reply = await fetch('/ask', {method: 'POST', body: JSON.stringify({id: `tile-${k}`, message: input.value}),
      headers: {'Content-Type': 'application/json', 'X-Apply-Token': TOKEN}});
    const data = await reply.json();
    if (!reply.ok) throw new Error(data.error || 'Not sent.');
    input.value = '';
  } catch (err) { toast(err.message || 'Apply is not answering: is it still running?'); input.disabled = false; }
}, true);
// A Mac app outlives its last window: say the window closed, so Apply quits its Chrome too.
addEventListener('pagehide', () => navigator.sendBeacon('/closed', '{closing}'));
</script>
{answers}"""


NO_RUN = ('<div class="norun">No applications are being filled. A live run (<b>apply run</b>) sends them; '
          'a practice run (<b>apply rehearse</b>) sends nothing. Each one Apply fills shows here. '
          '<button onclick="tab(\'inbox\')">Go to Inbox</button></div>')

# Atop History: a link to an Application Lisul submitted himself, for the Tracker.
APPLIED = """<details class="applied"><summary>Applied somewhere yourself?</summary>
  <p class="help">Paste the job's link and Apply won't apply there again.</p>
  <div class="card add">
    <input id="applied-link" placeholder="https://…" maxlength="8000" autocomplete="off">
    <div class="actions"><button id="applied-button" class="primary">Add</button><span class="status" id="applied-status"></span></div>
  </div>
</details>
"""

TABS = """<div id="runbar"><span class="brand">Apply</span><span id="mode" hidden></span>{sample}
<span id="runline"></span><button id="start" class="primary" hidden>Start</button></div>
<nav id="tabs" role="tablist">
<button id="tab-inbox" role="tab">Needs you</button><button id="tab-workers" role="tab">Live</button><button id="tab-history" role="tab">History</button>{answers_tab}{accounts_tab}
</nav>
"""

# The Answers tab: everything Apply answers from, his to read, and his
# one-off answers, his answers to Missing facts and his Stock answers to edit.
# Every value is set as text, never as markup: questions come from employers' forms.
ANSWERS = r"""<div id="answers" hidden>
<div class="bar">
  <input id="search" type="search" placeholder="Search questions, answers, companies…" autocomplete="off">
  <div class="segments" role="radiogroup" aria-label="Show">
    <label><input type="radio" name="answers-filter" value="check"> To check <span id="check-count"></span></label>
    <label><input type="radio" name="answers-filter" value="all"> All</label>
    <label><input type="radio" name="answers-filter" value="facts"> Your facts</label>
  </div>
  <span id="answers-status" class="status"></span>
</div>
<section id="sec-bank">
  <h2>Saved answers <span class="count" id="bank-count"></span></h2>
  <div class="hidden-note"></div>
  <div id="bank"></div>
  <button id="add-open" class="tonal">+ Add an answer</button>
  <div class="card add" id="add-card" hidden>
    <div class="q">Add an answer</div>
    <input id="add-question" placeholder="The question, as a form asks it" maxlength="1000">
    <textarea id="add-answer" rows="2" placeholder="Your answer" maxlength="20000"></textarea>
    <div class="actions"><button id="add-button" class="primary">Add answer</button><span class="status" id="add-status"></span></div>
  </div>
</section>
<section id="sec-answered">
  <h2>Your answers to questions only you could answer <span class="count" id="answered-count"></span></h2>
  <div class="hidden-note"></div>
  <div id="answered"></div>
</section>
<section id="sec-stock">
  <h2>Your core essay answers</h2>
  <div class="hidden-note"></div>
  <div id="stock"></div>
</section>
<section id="sec-facts">
  <h2>Your facts</h2>
  <div id="profile-facts"></div>
</section>
</div>
<script>
(() => {
const TOKEN = '{token}';
let view = null, opened = null;
const drafts = new Map(), statuses = new Map();  // by 'bank:'/'answered:'/'stock:' + question or key
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  children.flat(Infinity).forEach(c => c != null && e.append(c));
  return e;
};
const shown = (answer) => Array.isArray(answer) ? answer.join(', ') : answer;

const load = async () => {
  try {
    const reply = await fetch('/answers');
    if (!reply.ok) throw new Error();
    view = await reply.json();
    render();
  } catch (e) { say($('answers-status'), ['Apply is not answering: is it still running?', 'error']); }
};
// The tab reads the bank again whenever the window comes back to it, so it is never stale.
addEventListener('focus', () => { if (!$('answers').hidden && !drafts.size) load(); });

const post = async (path, body) => {
  let reply, data;
  try {
    reply = await fetch('/answers/' + path, {method: 'POST', body: JSON.stringify(body),
      headers: {'Content-Type': 'application/json', 'X-Apply-Token': TOKEN}});
    data = await reply.json();
  } catch (e) { throw new Error('Apply is not answering: is it still running?'); }
  if (!reply.ok) throw new Error(data.error || 'Not saved.');
  return data;
};
const say = (node, [text, kind] = ['', '']) => { if (node) { node.textContent = text; node.className = 'status ' + kind; } };

// An edit to one entry: saved, the tab read again; or refused, its draft kept with why.
const edit = async (key, path, body, done) => {
  statuses.set(key, ['Saving…', '']);
  say(document.querySelector(`[data-key="${CSS.escape(key)}"] .status`), statuses.get(key));
  try {
    view = await post(path, body);
    drafts.delete(key);
    statuses.set(key, [done, 'ok']);
  } catch (e) { statuses.set(key, [e.message, 'error']); }
  render();
};

// The answer an open bank entry's editor holds: Lisul's own words, else the options he picked.
const answerOf = (entry, draft) => {
  if (draft.other.trim()) return draft.other.trim();
  if (entry.options.length && Array.isArray(entry.answer)) return entry.options.filter(o => draft.picked.includes(o));
  if (entry.options.length) return draft.picked[0] || '';
  return draft.text;
};
const draftOf = (key, entry) => drafts.get(key) || (entry.options.length
  ? {picked: [].concat(entry.answer).filter(a => entry.options.includes(a)),
     other: [].concat(entry.answer).filter(a => !entry.options.includes(a)).join('; '), text: ''}
  : {picked: [], other: '', text: entry.answer});

const bankEntry = (entry) => {
  const key = 'bank:' + entry.question, isOpen = opened === key;
  const status = el('span', {className: 'status'});
  say(status, statuses.get(key) || (drafts.has(key) ? ['Unsaved changes', 'unsaved'] : ['', '']));
  const card = el('div', {className: 'card bank-entry' + (isOpen ? ' open' : ''), tabIndex: 0},
    el('div', {className: 'head', onclick: () => { opened = isOpen ? null : key; statuses.delete(key); render(); }},
      el('div', {className: 'q', textContent: entry.question}),
      el('div', {className: 'a', textContent: shown(entry.answer)}),
      el('div', {className: 'meta'},
        entry.reviewed ? null : el('span', {className: 'badge unreviewed', textContent: 'Check this'}),
        el('span', {textContent: entry.source === 'lisul' ? 'Written by you' : 'Written by Claude'}),
        entry.uses && !entry.reviewed ? el('span', {className: 'badge used',
          textContent: `Used on ${entry.uses + 1} applications` + (entry.last_used ? ' · last ' + entry.last_used : '')}) : null,
        el('span', {textContent: [entry.company && 'first asked by ' + entry.company, entry.date].filter(Boolean).join(' · ')}))));
  card.dataset.key = key;
  card.dataset.text = [entry.question, shown(entry.answer), entry.company, ...entry.options].join('\n').toLowerCase();
  card.dataset.review = entry.reviewed ? '' : '1';
  if (!isOpen) return card;
  const draft = draftOf(key, entry);
  const changed = () => { drafts.set(key, draft); statuses.delete(key); say(status, ['Unsaved changes', 'unsaved']); };
  const editor = el('div', {className: 'editor'});
  if (entry.options.length && Array.isArray(entry.answer)) {
    editor.append(el('div', {className: 'options'}, entry.options.map(option => {
      const box = el('input', {type: 'checkbox', value: option, checked: draft.picked.includes(option)});
      box.onchange = () => { draft.picked = entry.options.filter(o => o === option ? box.checked : draft.picked.includes(o)); changed(); };
      return el('label', {}, box, el('span', {textContent: option}));
    })));
  } else if (entry.options.length) {
    const select = el('select', {}, el('option', {value: '', textContent: '— pick one —'}),
      entry.options.map(o => el('option', {value: o, textContent: o, selected: draft.picked[0] === o})));
    select.onchange = () => { draft.picked = select.value ? [select.value] : []; changed(); };
    editor.append(select);
  } else {
    const text = el('textarea', {rows: Math.min(10, 2 + Math.floor(draft.text.length / 90)), value: draft.text, maxLength: 20000});
    text.oninput = () => { draft.text = text.value; changed(); };
    editor.append(text);
  }
  if (entry.options.length) {
    const other = el('input', {className: 'other', value: draft.other, maxLength: 20000,
      placeholder: 'Or write your own answer (used instead of the options)'});
    other.oninput = () => { draft.other = other.value; changed(); };
    editor.append(other);
  }
  editor.append(el('div', {className: 'actions'},
    el('button', {className: 'primary', textContent: 'Save',
      onclick: () => edit(key, 'bank/save', {question: entry.question, answer: answerOf(entry, draft)}, 'Saved')}),
    entry.reviewed ? null : el('button', {className: 'tonal', textContent: 'Looks right',
      onclick: () => edit(key, 'bank/review', {question: entry.question}, 'Marked checked')}),
    el('button', {className: 'danger', textContent: 'Delete', onclick: async () => {
      if (!confirm('Delete this answer? Claude writes it again the next time a form asks.\n\n' + entry.question)) return;
      try {
        view = await post('bank/delete', {question: entry.question});
        drafts.delete(key); opened = null;
        say($('answers-status'), ['Deleted: ' + entry.question, 'ok']);
      } catch (e) { statuses.set(key, [e.message, 'error']); }
      render();
    }}),
    el('button', {className: 'text', textContent: 'Close', onclick: () => { opened = null; render(); }}),
    status));
  card.append(editor);
  return card;
};

// An always-open editor: an answer to a Missing fact, or a Stock answer (or an essay offered as one).
const textEntry = (kind, label, answer, path, body, button = 'Save', done = 'Saved') => {
  const key = kind + ':' + label, status = el('span', {className: 'status'});
  const text = el('textarea', {rows: Math.min(12, 2 + Math.floor(String(answer).length / 90)), maxLength: 20000,
                               value: drafts.has(key) ? drafts.get(key) : answer});
  say(status, statuses.get(key) || (drafts.has(key) ? ['Unsaved changes', 'unsaved'] : ['', '']));
  text.oninput = () => { drafts.set(key, text.value); statuses.delete(key); say(status, ['Unsaved changes', 'unsaved']); };
  const card = el('div', {className: 'card ' + kind + '-entry'},
    el('div', {className: 'q', textContent: label}), text,
    el('div', {className: 'actions'},
      el('button', {className: 'primary', textContent: button, onclick: () => edit(key, path, body(text.value), done)}), status));
  card.dataset.key = key;
  card.dataset.text = (label + '\n' + answer).toLowerCase();
  return card;
};

const render = () => {
  if (!view) return;
  const keep = document.activeElement && document.activeElement.closest('[data-key]')?.dataset.key;
  const toReview = view.bank.filter(e => !e.reviewed).length;
  $('bank-count').textContent = `${view.bank.length} · ${toReview} to check`;
  $('check-count').textContent = toReview ? `(${toReview})` : '';
  if (!document.querySelector('[name=answers-filter]:checked'))  // to check first, while any wait
    document.querySelector(`[name=answers-filter][value=${toReview ? 'check' : 'all'}]`).checked = true;
  $('bank').replaceChildren(...(view.bank.length ? view.bank.map(bankEntry)
    : [el('div', {className: 'empty', textContent: 'No saved answers yet: Claude adds one the first time a form asks.'})]));
  $('answered-count').textContent = String(view.answered.length);
  $('answered').replaceChildren(...(view.answered.length ? view.answered.map(a =>
      textEntry('answered', a.question, a.answer, 'answered/save', value => ({question: a.question, answer: value})))
    : [el('div', {className: 'empty', textContent: 'None yet.'})]));
  $('stock').replaceChildren(...view.stock.map(s => {
    const label = s.key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
    return textEntry('stock', label, s.answer, 'stock/save', value => ({key: s.key, answer: value}));
  }), ...view.stock_types.map(s =>
    textEntry('stock', `${s.type} (first written for ${s.company}: ${s.question})`, s.answer, 'stock/type/save',
              value => ({type: s.type, answer: value}))
  ), ...view.stock_offers.map(o =>
    textEntry('stock', `Save as stock answer? ${o.type}, written for ${o.company}: ${o.question}`, o.answer, 'stock/keep',
              value => ({type: o.type, company: o.company, question: o.question, answer: value}),
              'Save as stock answer', 'Saved as stock answer')
  ));
  $('profile-facts').replaceChildren(...view.profile.map(section => {
    const group = el('div', {className: 'fact-group'}, el('h3', {textContent: section.section.replace(/_/g, ' ')}),
      el('dl', {className: 'facts'}, section.facts.map(([k, v]) => {
        const row = [el('dt', {textContent: k.replace(/_/g, ' ').replace(/\./g, ' › ')}),
                     el('dd', {className: v ? '' : 'blank', textContent: v || '—'})];
        row.forEach(r => r.dataset.text = (section.section + ' ' + k + ' ' + v).toLowerCase());
        return row;
      })));
    return group;
  }));
  filter();
  if (keep) document.querySelector(`[data-key="${CSS.escape(keep)}"] textarea, [data-key="${CSS.escape(keep)}"] input`)?.focus();
};

// The search box and the To check / All / Your facts filter narrow every section; a section
// they empty says how many they hid, so it never looks as if there were none.
const FILTERS = {check: 'the To check filter', facts: 'the Your facts filter'};
const filter = () => {
  const words = $('search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const mode = document.querySelector('[name=answers-filter]:checked')?.value || 'all';
  const hit = (node) => words.every(w => node.dataset.text.includes(w));
  $('sec-bank').hidden = mode === 'facts';
  ['sec-answered', 'sec-stock', 'sec-facts'].forEach(id => $(id).hidden = mode === 'check');
  document.querySelectorAll('#answers [data-key]').forEach(card =>
    card.hidden = !hit(card) || (mode === 'check' && !card.dataset.review && !statuses.has(card.dataset.key)));  // one just checked stays
  document.querySelectorAll('#profile-facts dt, #profile-facts dd').forEach(cell => cell.hidden = !hit(cell));
  document.querySelectorAll('.fact-group').forEach(g => g.hidden = !g.querySelector('dt:not([hidden])'));
  document.querySelectorAll('#answers section').forEach(section => {
    const note = section.querySelector('.hidden-note'), cards = section.querySelectorAll('[data-key]');
    if (!note) return;
    const hidden = [...cards].filter(c => c.hidden).length;
    note.replaceChildren(...(hidden ? [`${hidden} hidden by ${words.length ? 'your search' : FILTERS[mode] || 'a filter'}`,
      el('button', {textContent: 'Show all', onclick: () => {
        $('search').value = ''; document.querySelector('[name=answers-filter][value=all]').checked = true; filter(); }})] : []));
  });
};
$('search').oninput = filter;
document.querySelectorAll('[name=answers-filter]').forEach(r => r.onchange = filter);
$('add-open').onclick = () => { $('add-card').hidden = false; $('add-open').hidden = true; $('add-question').focus(); };

if ($('applied-button')) $('applied-button').onclick = async () => {
  const url = $('applied-link').value.trim();
  if (!url) return say($('applied-status'), ['Paste a link first.', 'error']);
  $('applied-button').disabled = true;
  say($('applied-status'), ['Claude is reading the link…', '']);
  try {
    let reply, data;
    try {
      reply = await fetch('/applied', {method: 'POST', body: JSON.stringify({url}),
        headers: {'Content-Type': 'application/json', 'X-Apply-Token': TOKEN}});
      data = await reply.json();
    } catch (e) { throw new Error('Apply is not answering: is it still running?'); }
    if (!reply.ok) throw new Error(data.error || 'Nothing was added.');
    $('applied-link').value = '';
    say($('applied-status'), [data.message, 'ok']);
  } catch (e) { say($('applied-status'), [e.message, 'error']); }
  $('applied-button').disabled = false;
};
$('applied-link')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('applied-button').click(); });

$('add-button').onclick = async () => {
  const question = $('add-question').value.trim(), answer = $('add-answer').value.trim();
  say($('add-status'), ['Adding…', '']);
  try {
    view = await post('bank/add', {question, answer});
    $('add-question').value = $('add-answer').value = '';
    opened = null;
    say($('add-status'), ['Added', 'ok']);
    statuses.set('bank:' + question, ['Added', 'ok']);  // shown, whatever the filter, so he sees it landed
    render();
  } catch (e) { say($('add-status'), [e.message, 'error']); }
};

window.addEventListener('beforeunload', e => { if (drafts.size) e.preventDefault(); });
window.loadAnswers = load;  // the tabs (INBOX) read it again each time the tab opens
})();
</script>
"""

# The Inbox: every Application that waits on Lisul, one row each, grouped by
# what he is asked to do; and the tabs. Rows are drawn again only when what
# they show changed, so an open row or a half-typed answer stays.
INBOX = r"""<div id="inbox" hidden><div class="inbox-wrap"><div id="inbox-list"></div></div></div>
<div id="toast" hidden><span></span> <button>Undo</button></div>
<script>
const WORDS = {words};
const make = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  children.flat(Infinity).forEach(c => c != null && c !== false && e.append(c));
  return e;
};
// Tabs, the address keeping the one open: the Inbox first, for what waits on Lisul.
const PANES = ['inbox', 'workers', 'history', 'answers', 'accounts'];
const tab = (name) => {
  if (!document.getElementById(name)) name = 'inbox';
  PANES.forEach(pane => {
    const node = document.getElementById(pane), button = document.getElementById('tab-' + pane);
    if (node) node.hidden = pane !== name;
    if (button) button.setAttribute('aria-selected', pane === name);
  });
  if (name !== 'workers') control(null);
  if (name === 'answers' && window.loadAnswers) loadAnswers();
  if (name === 'accounts' && window.loadAccounts) loadAccounts();
  history.replaceState(null, '', '#' + name);
};
document.querySelectorAll('#tabs [role=tab]').forEach(b => b.onclick = () => tab(b.id.slice(4)));
addEventListener('DOMContentLoaded', () => tab(location.hash.slice(1)));
addEventListener('hashchange', () => tab(location.hash.slice(1)));  // a link to #history, say, with no reload

// Asks, in the order they come: a sign-in blocks every job on its site; an answer, an OK, a fix, a finish.
const KINDS = {'needs sign-in': 'Sign in', 'missing fact': 'Question', held: 'Approve', check: 'Fix', 'needs code': 'Code',
               handoff: 'Finish'};
const dismissed = new Set(JSON.parse((() => { try { return sessionStorage.getItem('apply.dismissed'); } catch (e) {} })() || '[]'));
const keepDismissed = () => { try { sessionStorage.setItem('apply.dismissed', JSON.stringify([...dismissed])); } catch (e) {} };
let last = null, drawn = '';
const ago = (at) => {
  if (!at) return '';
  if (at.length === 10) return at;  // a Tracker row's date
  const minutes = Math.round((Date.now() - new Date(at)) / 60000);
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : at.slice(11, 16);
};
let toastTimer = null;
const toast = (text, undo) => {
  const node = document.getElementById('toast');
  node.querySelector('span').textContent = text;
  node.querySelector('button').hidden = !undo;
  node.querySelector('button').onclick = () => { node.hidden = true; undo(); };
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 5000);
};
const copyButton = (label, text) => make('button', {className: 'primary', textContent: label, title: text, onclick: async (e) => {
  try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; } catch (err) { e.target.textContent = text; }
}});
// The tile still showing this Application, if its Worker hasn't moved on: there it can be fixed in place.
const liveTile = (item) => (last.tiles || []).findIndex(t => item.from !== 'tracker' && t.posting_url
  && t.posting_url === item.posting_url && t.status === item.status);
// Bring a Worker's own Chrome window forward, for what the tile cannot do (a sign-in, a captcha, a dialog).
window.openChrome = async (k) => {
  try {
    const reply = await fetch(`/show/${k}`, {method: 'POST', headers: {'X-Apply-Token': TOKEN}});
    if (!reply.ok) toast((await reply.json()).error || "That browser couldn't be opened.");
  } catch (e) { toast('Apply is not answering: is it still running?'); }
};
// Resume: a rehearsal paused mid-form goes on from the page as Lisul left it. When it can't (its tab
// closed), the button stays, off, and says why.
const resume = async (id, button) => {
  button.disabled = true;
  try {
    const reply = await fetch('/resume', {method: 'POST', body: JSON.stringify({id}),
                                          headers: {'Content-Type': 'application/json', 'X-Apply-Token': TOKEN}});
    const data = await reply.json();
    if (!reply.ok) throw new Error(data.error || 'Not resumed.');
    toast(data.message); refresh();
  } catch (err) { toast(err.message || 'Apply is not answering: is it still running?'); button.disabled = false; }
};
const resumeButton = (item) => make('button', {className: 'primary', textContent: item.resume.label || 'Resume', disabled: !item.resume.ok,
  title: item.resume.ok ? 'Apply goes on from the page as you left it; it never presses Submit' : item.resume.why,
  onclick: (e) => resume(item.id, e.target)});
// A tile's own Resume (Live tab), by its Worker's number; the click doesn't enlarge the tile.
document.addEventListener('click', (e) => {
  const button = e.target.closest && e.target.closest('.resumebar button');
  if (!button) return;
  e.stopPropagation();
  resume(`tile-${button.closest('.resumebar').id.replace('resume-', '')}`, button);
}, true);
// What resolves a row, the main one first (an answer box does, for a question).
const action = (item) => {
  if (item.resume) {
    const rest = (({resume: _, ...other}) => action(other))(item);
    return [resumeButton(item), ...[].concat(rest || []).map(b => { if (b && b.classList) b.classList.remove('primary'); return b; }),
            item.resume.why ? make('span', {className: 'then', textContent: item.resume.why}) : null];
  }
  const k = liveTile(item), ctx = last.context || {};
  if (item.kind === 'blocked' && ctx.everyday && item.posting_url) return make('button', {className: 'primary',
    textContent: 'Open in my Chrome', title: 'Your everyday Chrome, where the WorkIt extension fills it',
    onclick: async (e) => {  // only his press opens it: a rehearsal never pops a window by itself (KAN-590)
      e.target.disabled = true;
      try {
        const reply = await fetch('/everyday', {method: 'POST', body: JSON.stringify({id: item.id}),
                                                headers: {'Content-Type': 'application/json', 'X-Apply-Token': TOKEN}});
        const data = await reply.json();
        if (!reply.ok) throw new Error(data.error || 'Not opened.');
        toast(data.message);
      } catch (err) { toast(err.message || 'Apply is not answering: is it still running?'); }
      e.target.disabled = false;
    }});
  if (item.kind === 'missing fact' && ctx.answers) return null;
  if (item.kind === 'held' && ctx.approve && item.application_id) return make('button', {className: 'primary', textContent: 'Approve',
    title: 'It is sent at the next check', onclick: async (e) => {  // approving resolves it
      e.target.disabled = true;
      try {
        const edit = editedEssays(item);  // his words in place of Claude's, if he edited them
        const reply = await fetch('/approve', {method: 'POST', body: JSON.stringify(edit === null ? {id: item.id} : {id: item.id, essays: edit}),
                                               headers: {'Content-Type': 'application/json', 'X-Apply-Token': TOKEN}});
        const data = await reply.json();
        if (!reply.ok) throw new Error(data.error || 'Not approved.');
        essayDrafts.delete(item.application_id); keepEssays();
        toast(data.message); refresh();
      } catch (err) { toast(err.message || 'Apply is not answering: is it still running?'); e.target.disabled = false; }
    }});
  if (k >= 0) {
    const here = (main) => make('button', {className: main ? 'primary' : '', textContent: 'Fix here', title: 'Type into it in this window',
                                           onclick: () => { tab('workers'); control(k); }});
    const chrome = (main) => ctx.show ? make('button', {className: main ? 'primary' : '', textContent: 'Open in Chrome',
                                                        title: 'Its own browser window', onclick: () => openChrome(k)}) : null;
    // A sign-in wants the real window: password autofill, Sign in with Google, a code by text.
    return item.kind === 'needs sign-in' && ctx.show ? [chrome(true), here(false)] : [here(true), chrome(false)];
  }
  if (item.kind === 'needs sign-in' && item.posting_url) return copyButton('Copy sign-in command', `apply sign-in ${item.posting_url}`);
  if (item.posting_url) return make('a', {className: 'button', href: item.posting_url, target: '_blank', textContent: 'Open the posting ↗'});
  return null;
};
// Verifying's flags (apply.verify): each its field and why, each dismissed on its own. Apply keeps a dismissal
// for the Application (verify.dismiss): its flag is gone after a reload and holds no new run. A Hold of a live
// run whose every flag is dismissed can then be approved.
const flagList = (item) => make('ul', {className: 'flags'}, (item.flags || []).map(f => make('li', {},
  f.field ? make('b', {textContent: f.field}) : null, make('span', {textContent: f.field ? ` ${f.why}` : f.why}),
  make('button', {className: 'tonal', textContent: 'Dismiss', title: 'Nothing to fix here: drop this flag',
    onclick: async (e) => {
      e.target.disabled = true;
      try {
        const reply = await fetch('/dismiss', {method: 'POST', body: JSON.stringify({id: item.id, field: f.field, why: f.why}),
                                               headers: {'Content-Type': 'application/json', 'X-Apply-Token': TOKEN}});
        const data = await reply.json();
        if (!reply.ok) throw new Error(data.error || 'Not dismissed.');
        refresh();
      } catch (err) { toast(err.message || 'Apply is not answering: is it still running?'); e.target.disabled = false; }
    }}))));
const dismiss = (item) => make('button', {className: 'close', textContent: '×', title: 'Hide it here; your Tracker keeps it',
  ariaLabel: 'Dismiss', onclick: () => {
    dismissed.add(item.id); keepDismissed(); drawInbox();
    toast(`Hid ${item.company || 'it'}.`, () => { dismissed.delete(item.id); keepDismissed(); drawInbox(); });
  }});
const who = (item) => {
  const words = [item.company || 'An application', item.role, item.system].filter(Boolean).join(' · ');
  return item.posting_url ? make('a', {className: 'name', href: item.posting_url, target: '_blank', textContent: words, title: 'Open the posting'})
    : make('span', {className: 'name', textContent: words});
};
// A Hold's essays, his to edit before he approves, as the retired Tracker Sheet's Essay cell was: one box per
// question, with only the essay's text (the question heading and Plan lines stay with Apply). Approve sends his
// texts, in order. The edit is kept, by Application ID, until he approves, also if the window reloads.
const essayDrafts = new Map(Object.entries(JSON.parse((() => { try { return sessionStorage.getItem('apply.essays'); } catch (e) {} })() || '{}')));
const keepEssays = () => { try { sessionStorage.setItem('apply.essays', JSON.stringify(Object.fromEntries(essayDrafts))); } catch (e) {} };
const essayTexts = (item) => {  // his draft if it still fits the Hold's essays, else Claude's
  const draft = essayDrafts.get(item.application_id), claude = item.essays.map((e) => e.text);
  return Array.isArray(draft) && draft.length === claude.length ? draft : claude;
};
const editedEssays = (item) => {
  const texts = essayTexts(item);
  return texts.some((text, i) => text !== item.essays[i].text) ? texts : null;
};
const essayBox = (item) => {
  const status = make('span', {className: 'status'});
  const undo = make('button', {className: 'text', textContent: "Put back Claude's", hidden: true});
  const boxes = item.essays.map((essay, i) => {
    const text = make('textarea', {className: 'essay', maxLength: 100000, value: essayTexts(item)[i],
                                   rows: Math.min(16, 3 + Math.floor(essay.text.length / 90) + essay.text.split('\n').length)});
    text.dataset.key = `essay|${item.application_id}|${i}`;
    text.oninput = () => {
      const texts = [...essayTexts(item)]; texts[i] = text.value;
      essayDrafts.set(item.application_id, texts); keepEssays(); say();
    };
    return [make('label', {className: 'question', textContent: essay.question}), text];
  });
  const say = () => {
    const edited = editedEssays(item) !== null;
    status.textContent = edited ? 'Edited: Approve sends your edit' : ''; status.className = 'status unsaved';
    undo.hidden = !edited;
  };
  undo.onclick = () => {
    essayDrafts.delete(item.application_id); keepEssays();
    boxes.forEach(([, text], i) => { text.value = item.essays[i].text; }); say();
  };
  say();
  return make('div', {className: 'ask'}, make('label', {textContent: 'The essays Claude wrote: edit them here before you approve'}),
              ...boxes.flat(), make('div', {className: 'essay-row'}, status, undo));
};
// A box per question only Lisul can answer: saved where the run reads it, the draft kept if it is refused.
// One its form offers options for shows them as the form does, a list to pick one or boxes to tick,
// with a box to write his own answer instead; the run fills the form with what he picked.
const typed = new Map(), picked = new Map();  // drafts, by "id|question": his words, and the options he picked
const answerBox = (item, question) => {
  const key = `${item.id}|${question}`, status = make('span', {className: 'status'});
  const choice = (item.choices || {})[question], many = choice && choice.kind === 'multi_select';
  const wantsFile = choice && choice.kind === 'file', need = (item.required || {})[question];
  if (wantsFile) return fileBox(item, question, need);
  const picks = () => picked.get(key) || [];
  const box = make('input', {className: 'answer', value: typed.get(key) || '', maxLength: 20000,
                             placeholder: (choice ? 'Or write your own answer (used instead of the options)' : 'Your answer')
                               + (need === false ? ', or leave blank to skip' : ''),
                             oninput: () => typed.set(key, box.value)});
  box.dataset.key = key;
  let options = null;
  if (many) {
    options = make('div', {className: 'options'}, choice.options.map(option => {
      const tick = make('input', {type: 'checkbox', value: option, checked: picks().includes(option)});
      tick.onchange = () => picked.set(key, choice.options.filter(o => o === option ? tick.checked : picks().includes(o)));
      return make('label', {}, tick, make('span', {textContent: option}));
    }));
  } else if (choice) {
    options = make('select', {}, make('option', {value: '', textContent: '— pick one —'}),
      choice.options.map(o => make('option', {value: o, textContent: o, selected: picks()[0] === o})));
    options.dataset.key = key + '|pick';
    options.onchange = () => picked.set(key, options.value ? [options.value] : []);
  }
  // His own words, else what he picked: several joined by "; ", as the Answer cell holds them.
  const answer = () => box.value.trim() || picks().join('; ');
  const save = make('button', {className: 'primary', textContent: 'Save answer', onclick: async () => {
    save.disabled = true; status.textContent = 'Saving…'; status.className = 'status';
    try {
      if (!answer() && need !== false) throw new Error(choice ? 'Pick an option or write an answer.' : 'Write an answer.');
      let reply, data;
      try {
        reply = await fetch('/answer', {method: 'POST', body: JSON.stringify({id: item.id, question, answer: answer()}),
          headers: {'Content-Type': 'application/json', 'X-Apply-Token': TOKEN}});
        data = await reply.json();
      } catch (e) { throw new Error('Apply is not answering: is it still running?'); }
      if (!reply.ok) throw new Error(data.error || 'Not saved.');
      typed.delete(key); picked.delete(key);
      toast(data.message);
      refresh();
    } catch (e) { status.textContent = e.message; status.className = 'status error'; save.disabled = false; }
  }});
  box.addEventListener('keydown', e => { if (e.key === 'Enter') save.click(); });
  // An optional one still gets an answer, but may be saved blank to skip it.
  return make('div', {className: 'ask'}, make('label', {textContent: question}, needFlag(need)), whereLine(item, question),
              options, make('div', {className: 'answer-row'}, box, save, goToButton(item, question)), status);
};
// Go to question: the held form's own browser comes forward (or its tile, when it has no window), scrolled to
// the field, which is focused and outlined. Answered there, it leaves Needs you once he leaves the field.
// Only for a form still held open in its Worker's browser (dashboard.on_form).
const heldOpen = (item) => item.from !== 'tracker' && item.status !== 'missing fact' && !item.live
  && Number.isInteger(item.worker) && item.worker >= 0 && liveTile(item) >= 0;
const goToButton = (item, question) => heldOpen(item) ? make('button', {className: 'goto', textContent: 'Go to question',
  title: 'Shows this question on the form, to answer it there', onclick: async (e) => {
    e.target.disabled = true;
    try {
      let reply, data;
      try {
        reply = await fetch('/goto', {method: 'POST', body: JSON.stringify({id: item.id, question}),
          headers: {'Content-Type': 'application/json', 'X-Apply-Token': TOKEN}});
        data = await reply.json();
      } catch (err) { throw new Error('Apply is not answering: is it still running?'); }
      if (!reply.ok) throw new Error(data.error || "Couldn't go to it.");
      if (!data.front) { tab('workers'); control(item.worker); }  // no window of its own: its tile is the browser
      toast(data.message);
    } catch (err) { toast(err.message); }
    e.target.disabled = false;
  }}) : null;
// The question's one context line (apply.asking): its step, the question it follows and its pair, or its essay.
const whereLine = (item, question) => (item.where || {})[question]
  ? make('div', {className: 'where', textContent: item.where[question]}) : null;
// Whether the form requires it, as its own flag says.
const needFlag = (need) => need === undefined ? null : make('span', {className: 'need ' + (need ? 'required' : 'optional'),
                                                                     textContent: need ? 'Required' : 'Optional'});
// A question the form answers with a file, offered as the form offers it: a file from this Mac, which
// Claude attaches to the open form, or Dropbox or Google Drive, picked on the form itself in its tile.
const fileBox = (item, question, need) => {
  const status = make('span', {className: 'status'});
  const send = async (chosen) => {
    status.textContent = chosen ? `Attaching ${chosen.name}…` : 'Skipping…'; status.className = 'status';
    try {
      const data = chosen ? await new Promise((done, fail) => {
        const reader = new FileReader();
        reader.onload = () => done(String(reader.result).split(',')[1]); reader.onerror = fail;
        reader.readAsDataURL(chosen);
      }) : null;
      let reply, sent;
      try {
        reply = await fetch('/answer', {method: 'POST', body: JSON.stringify({id: item.id, question, answer: '',
          file: chosen ? {name: chosen.name, data} : null}), headers: {'Content-Type': 'application/json', 'X-Apply-Token': TOKEN}});
        sent = await reply.json();
      } catch (e) { throw new Error('Apply is not answering: is it still running?'); }
      if (!reply.ok) throw new Error(sent.error || 'Not attached.');
      toast(sent.message);
      refresh();
    } catch (e) { status.textContent = e.message; status.className = 'status error'; }
  };
  const pick = make('input', {type: 'file', accept: '.pdf,.doc,.docx,.txt,.rtf', hidden: true,
                              onchange: () => pick.files[0] && send(pick.files[0])});
  const onForm = (where) => () => {
    if (!Number.isInteger(item.worker) || item.worker < 0) { status.textContent = 'Its form is closed.'; return; }
    tab('workers'); control(item.worker);
    toast(`Press ${where} on the ${item.company || 'open'} form and pick the file there.`);
  };
  const buttons = make('div', {className: 'file-options'},
    make('button', {className: 'primary', textContent: 'Attach from this Mac', onclick: () => pick.click()}),
    make('button', {textContent: 'Dropbox', onclick: onForm('Dropbox')}),
    make('button', {textContent: 'Google Drive', onclick: onForm('Google Drive')}),
    need === false ? make('button', {textContent: 'Skip', onclick: () => send(null)}) : null, goToButton(item, question), pick);
  return make('div', {className: 'ask'}, make('label', {textContent: question}, needFlag(need)), whereLine(item, question), buttons,
              make('div', {className: 'file-types', textContent: 'PDF, Word, text or RTF'}), status);
};
// Each answer Claude wrote on a held form, with its "Add context and regenerate" (KAN-599): Lisul types what Claude
// should know or change, and Claude writes that one answer again into the form's field. The form's own page has the
// same button beside the field.
const writtenList = (item) => make('details', {}, make('summary', {textContent: `What Claude wrote (${item.written.length})`}),
  item.written.map(w => {
    const key = `regen|${item.posting_url}|${w.name}`, status = make('span', {className: 'status'});
    const working = w.state === 'working';
    const box = make('textarea', {className: 'answer', rows: 2, maxLength: 2000, value: typed.get(key) || '', hidden: !typed.has(key),
      placeholder: 'What should Claude know or change? e.g. Lead with the club project; I led a team of 5 there.',
      oninput: () => typed.set(key, box.value)});
    box.dataset.key = key;
    const go = make('button', {className: 'primary', textContent: 'Regenerate', hidden: !typed.has(key), onclick: async () => {
      go.disabled = true; status.textContent = 'Asking Claude…'; status.className = 'status';
      try {
        let reply, data;
        try {
          reply = await fetch('/regenerate', {method: 'POST', body: JSON.stringify({id: item.id, name: w.name, context: box.value}),
            headers: {'Content-Type': 'application/json', 'X-Apply-Token': TOKEN}});
          data = await reply.json();
        } catch (e) { throw new Error('Apply is not answering: is it still running?'); }
        if (!reply.ok) throw new Error(data.error || 'Not regenerated.');
        typed.delete(key);
        toast(data.message);
        refresh();
      } catch (e) { status.textContent = e.message; status.className = 'status error'; go.disabled = false; }
    }});
    const open = make('button', {className: 'tonal', textContent: working ? 'Claude is rewriting this answer…' : '↻ Add context and regenerate',
      disabled: working, title: 'Tell Claude more, and it writes this answer again on the form. Nothing is sent.',
      onclick: () => { typed.set(key, typed.get(key) || ''); box.hidden = go.hidden = false; box.focus(); }});
    return make('div', {className: 'ask written'}, make('label', {textContent: w.label}),
      make('div', {className: 'written-text', textContent: w.text}),
      w.why ? make('div', {className: 'why' + (w.state === 'failed' ? ' error' : ''), textContent: w.why}) : null,
      make('div', {className: 'answer-row'}, open), box, make('div', {className: 'actions'}, go, status));
  }));
const row = (item) => {
  const ctx = last.context || {}, asks = item.kind === 'missing fact' && ctx.answers ? item.questions || [] : [];
  const failed = item.tone === 'failed', main = failed ? null : action(item);
  const card = make('div', {className: 'item ' + item.tone, tabIndex: 0},
    make('div', {className: 'top'},
      make('span', {className: 'kind', textContent: failed ? "Couldn't finish" : KINDS[item.kind] || '', title: (WORDS[item.kind] || ['', ''])[1]}),
      item.verified ? make('span', {className: 'chip verified', textContent: '✓ Verified', title: (WORDS.verified || ['', ''])[1]}) : null,
      make('span', {className: 'ago', textContent: ago(item.at)}), failed ? null : dismiss(item)),
    make('div', {className: 'do', textContent: failed ? item.label.replace(/^Couldn't finish: /, '').replace(/^./, c => c.toUpperCase()) : item.do}),
    make('div', {className: 'who'}, who(item)),
    item.why && !asks.length && !failed && !item.flags ? make('div', {className: 'why', textContent: item.why}) : null,
    item.flags ? flagList(item) : null,
    item.notes && item.notes.length ? make('details', {}, make('summary', {textContent: `Notes from verifying (${item.notes.length})`}),
      make('div', {textContent: item.notes.join('\n')})) : null,
    asks.map(question => answerBox(item, question)),
    item.kind === 'held' && ctx.approve && item.application_id && item.essays && item.essays.length ? essayBox(item) : null,
    item.written && item.written.length ? writtenList(item)
      : item.drafted && item.drafted.length ? make('details', {}, make('summary', {textContent: `What Claude wrote (${item.drafted.length})`}),
      make('div', {textContent: item.drafted.join('\n')})) : null,
    item.error ? make('details', {}, make('summary', {textContent: 'Details'}), make('div', {textContent: item.error})) : null,
    main || item.kind === 'held' ? make('div', {className: 'actions'}, main,
      item.kind === 'held' ? make('span', {className: 'then', textContent: 'Sent at the next check, within 5 minutes'}) : null) : null);
  card.dataset.id = item.id;
  return card;
};
const empty = () => {
  const ctx = last.context || {}, filling = (last.tiles || []).filter(t => t.tone === 'filling' || t.tone === 'verifying').length;
  if (!ctx.workers && !ctx.rows && !ctx.tracker_error) return make('div', {className: 'empty-state'},
    make('h2', {textContent: 'Apply fills internship applications for you.'}),
    make('p', {}, 'Try it with a practice run, which sends nothing: ', make('code', {textContent: 'apply rehearse <job link>'})),
    make('p', {}, 'Then start for real: ', make('code', {textContent: 'apply run'})),
    make('p', {className: 'safe', textContent: 'Apply never sends without your OK to a company on your check-first list, '
      + 'an application with an essay about the company, its first 10 applications, or any it cannot check against '
      + 'your facts. Anything that needs you appears here.'}));
  if (ctx.workers) return make('div', {className: 'empty-state'}, make('h2', {textContent: 'Nothing needs you right now.'}),
    make('p', {textContent: filling ? `Apply is filling ${filling} application${filling === 1 ? '' : 's'}.`
      : "Anything Apply can't finish alone lands here."}));
  return make('div', {className: 'empty-state'}, make('h2', {textContent: 'All done.'}),
    make('p', {textContent: [ctx.sweep_at ? `Next daily check for new jobs at ${ctx.sweep_at}.` : '',
                             ctx.sent_today ? `${ctx.sent_today} sent today.` : ''].filter(Boolean).join(' ') || 'No run going.'}),
    ctx.tracker_error ? make('p', {textContent: "Your Tracker couldn't be read, so its rows aren't listed here."}) : null);
};
const drawInbox = () => {
  if (!last) return;
  const items = last.items.filter(i => !dismissed.has(i.id) && !i.answered);
  const asks = items.filter(i => i.tone === 'needs'), failed = items.filter(i => i.tone === 'failed');
  const list = document.getElementById('inbox-list');
  const keep = document.activeElement && document.activeElement.closest('.item')?.dataset.id;
  const typing = document.activeElement && document.activeElement.dataset.key;
  const caret = typing ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  const opened = (d) => (d.closest('[data-id]')?.dataset.id || '') + '|' + d.querySelector('summary').textContent.split(' ')[0];
  const open = [...list.querySelectorAll('details[open]')].map(opened);
  const order = Object.keys(KINDS), sorted = [...asks].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  list.replaceChildren(...(sorted.length ? sorted.map(row) : [empty()]),
    failed.length ? make('details', {className: 'failures'},
      make('summary', {textContent: `${failed.length} couldn't finish · nothing was sent, and Apply will try again`}),
      failed.map(row)) : '');
  list.querySelectorAll('details').forEach(d => { if (open.includes(opened(d))) d.open = true; });  // as Lisul left them
  if (typing) {
    const box = list.querySelector(`[data-key="${CSS.escape(typing)}"]`);
    box?.focus();
    if (box && caret[0] !== null && box.setSelectionRange) box.setSelectionRange(...caret);
  }
  else if (keep) list.querySelector(`[data-id="${CSS.escape(keep)}"]`)?.focus();
  const count = document.getElementById('tab-inbox');
  if (count) count.textContent = asks.length ? `Needs you · ${asks.length}` : 'Needs you';
  document.title = asks.length ? `Apply (${asks.length})` : 'Apply';  // the Dock and Cmd-Tab show it
};
// Called with each /state: drawn again only when what the Inbox shows changed.
const at = (iso) => iso ? iso.slice(11, 16) : '';
// The status bar: the kind of run, and what it is doing as a whole, in one line.
const filling = (state) => (state.tiles || []).filter(t => t.tone === 'filling' || t.tone === 'verifying').length;
const sent = (state) => state.items.filter(i => i.tone === 'submitted' && i.from !== 'tracker').length;
const drawRun = (state) => {
  const run = state.run || {}, ctx = state.context || {};
  const mode = document.getElementById('mode'), line = document.getElementById('runline');
  mode.hidden = !run.mode;
  mode.className = run.mode || '';
  mode.textContent = run.mode === 'rehearsal' ? 'Practice run · nothing is sent' : 'Live run';
  mode.title = (WORDS[run.mode] || ['', ''])[1];
  const start = document.getElementById('start'), forms = (state.tiles || []).length;
  start.hidden = !['waiting', 'ready'].includes(run.start);
  start.disabled = run.start !== 'ready';
  start.textContent = run.start === 'ready' ? `Start filling all ${forms}` : `Getting ${forms} forms ready…`;
  start.onclick = () => { start.disabled = true; fetch('/start', {method: 'POST', body: TOKEN}).then(refresh); };
  line.className = run.paused_until || run.capped || run.unchecked ? 'paused' : '';
  line.textContent = run.unchecked ? run.unchecked  // KAN-621: a check that couldn't run is never silent
    : run.paused_until ? `Paused: Claude's usage limit is reached. Picks up again at ${at(run.paused_until)}.`
    : run.capped ? `Today's limit reached (${run.cap}). ${run.tomorrow} more go tomorrow.`
    : ctx.workers ? [filling(state) ? `${filling(state)} filling` : '', run.queued ? `${run.queued} queued` : '',
                     sent(state) ? `${sent(state)} sent` : 'nothing sent yet', run.cap ? `${run.today} of ${run.cap} today` : ''].filter(Boolean).join(' · ')
    : ctx.sweep_at ? `Idle until the daily check at ${ctx.sweep_at}` : 'No run going';
};
const refresh = async () => { try { renderInbox(await (await fetch('/state')).json()); } catch (e) {} };
window.renderInbox = (state) => {
  last = state;
  drawRun(state);
  drawHistory(state);
  document.querySelectorAll('.note .chrome').forEach(b => b.hidden = !(state.context || {}).show);
  const shown = JSON.stringify([state.items.map(i => [i.id, i.status, i.tone, i.kind, i.flags, i.questions, i.answered,
                                                    (i.written || []).map(w => [w.text, w.state, w.why])]), (state.tiles || []).map(t => [t.posting_url, t.status]),
                                state.context, state.summary, [...dismissed], Math.floor(Date.now() / 60000)]);
  if (shown === drawn) return;
  drawn = shown;
  drawInbox();
};
</script>
"""

# History: what Apply did this run and today, and why, newest first; each
# Application's timeline under it. Skips are one click away, not hidden.
HISTORY = r"""<div id="history" hidden><div class="inbox-wrap">
<div id="history-list"></div><div class="history-bar"><span id="history-tracker"></span></div>
{applied}</div></div>
<script>
const VERDICTS = {submitted: '✓ Sent', needs: '◐ Waiting', ready: '○ Filled', failed: '✕ Couldn\'t', ended: '– Skipped'};
const whyLine = (item) => {
  if (item.tone === 'needs') return [item.do, item.why].filter(Boolean).join(': ');
  if (item.tone === 'failed') return `${item.label}. Nothing was sent.`;
  if (item.tone === 'ended') return item.label.replace(/^Skipped: /, '');
  const drafted = (item.drafted || []).length;
  return [item.tone === 'submitted' && !item.why ? 'Every answer was checked against your facts before it was sent' : item.why,
          drafted ? `${drafted === 1 ? '1 answer' : drafted + ' answers'} written by Claude: check ${drafted === 1 ? 'it' : 'them'} in Saved answers` : '']
    .filter(Boolean).join('. ');
};
let historyDrawn = '';
const drawHistory = (state) => {
  const shown = JSON.stringify([state.items.map(i => [i.id, i.status]), state.context]);
  if (shown === historyDrawn) return;
  historyDrawn = shown;
  const all = state.items.filter(i => !i.live), ctx = state.context || {};  // a form still filling hasn't ended
  document.getElementById('history-tracker').replaceChildren(ctx.tracker_url
    ? make('a', {href: ctx.tracker_url, target: '_blank', textContent: 'Every application is in your Applications Tracker on WorkIt ↗'}) : '');
  document.getElementById('history-list').replaceChildren(...(all.length ? all.map(item => {
    const files = item.from === 'tracker' ? [] : (item.files || []);
    const row = make('div', {className: 'done ' + item.tone + (item.verified ? ' verified' : ''), tabIndex: 0},
      make('span', {className: 'when', textContent: item.at ? (item.at.length > 10 ? item.at.slice(11, 16) : item.at.slice(5)) : ''}),
      make('span', {className: 'verdict', textContent: item.verified && item.tone !== 'submitted' ? '✓ Verified' : VERDICTS[item.tone] || ''}),
      make('div', {className: 'what'},
        make('div', {}, item.company ? who(item) : 'The run'),
        make('div', {className: 'why', textContent: whyLine(item)}),
        files.length ? make('div', {className: 'links'},
          files.map((f, i) => make('a', {href: `/file/item/${item.id}/${i}`, target: '_blank',
            // the file sent, by its name: the form's own label ("Upload your resume/CV") read as a step left to do
            textContent: 'Sent: ' + (f.name || f.label), title: f.label || ''}))) : null));
    row.dataset.id = item.id;
    return row;
  }) : [make('div', {className: 'history-empty', textContent:
    'Nothing has ended yet. Each application shows here once Apply sends it, stops for you or skips it.'})]));
};
</script>
"""

# The Accounts tab (KAN-591): each Employer account Apply made, to sign in to it himself. A password is never in
# the page: Copy password asks the server, which puts it on the clipboard and replies with a message alone.
ACCOUNTS_TAB = '<button id="tab-accounts" role="tab">Accounts</button>'
ACCOUNTS = r"""<div id="accounts" hidden><div class="inbox-wrap">
<h2>Your accounts on job sites</h2>
<p class="help">Apply made these to apply for you. Each password is only in your Mac's Keychain. Copy password puts
it on the clipboard for a minute.</p>
<div id="accounts-list"></div><span id="accounts-status" class="status"></span>
</div></div>
<script>
(() => {
const $ = (id) => document.getElementById(id);
const press = async (path, site, status) => {
  status.textContent = ''; status.className = 'status';
  try {
    const reply = await fetch(path, {method: 'POST', body: JSON.stringify({site}),
                                     headers: {'Content-Type': 'application/json', 'X-Apply-Token': TOKEN}});
    const data = await reply.json();
    if (!reply.ok) throw new Error(data.error || 'Not done.');
    status.textContent = data.message; status.className = 'status ok';
  } catch (err) {
    status.textContent = err.message || 'Apply is not answering: is it still running?'; status.className = 'status error';
  }
};
window.loadAccounts = async () => {
  let view;
  try {
    const reply = await fetch('/accounts', {headers: {'X-Apply-Token': TOKEN}});
    if (!reply.ok) throw new Error();
    view = await reply.json();
  } catch (e) { $('accounts-status').textContent = 'Apply is not answering: is it still running?'; return; }
  $('accounts-list').replaceChildren(...(view.accounts.length ? view.accounts.map(a => {
    const status = make('span', {className: 'status'});
    return make('div', {className: 'card account'},
      make('div', {className: 'q', textContent: a.company || a.site}),
      make('div', {className: 'meta', textContent: `${a.site} · ${a.login} · made ${a.created}`}),
      make('div', {className: 'actions'},
        make('button', {className: 'primary', textContent: 'Copy password', onclick: () => press('/accounts/copy', a.site, status)}),
        make('button', {className: 'tonal', textContent: 'Open sign-in page', title: 'In your everyday Chrome',
                        onclick: () => press('/accounts/open', a.site, status)}),
        status));
  }) : [make('div', {className: 'history-empty', textContent: 'Apply has made no accounts yet.'})]));
};
})();
</script>
"""

# The window's one stylesheet: WorkIt's, so Apply reads as part of it rather
# than a product of its own. Its tokens and shapes come from WorkIt's
# frontend (src/app/globals.css and components/ui): Plus Jakarta Sans with
# bold sans headings; the seeker shell's lavender frame (--page) under
# floating white panels at 20px corners; 8px buttons, 10px bordered cards,
# full pills only for its search field, segmented control and badges; its
# violet for every action, link and the tab open, its rail lavender for what
# is chosen; its ink, slate and status colours, with its amber warning
# marking what needs Lisul; and its white toast in the corner. WorkIt has no
# dark theme, so the dark one below is those roles on a dark lavender frame.
STYLE = r"""
  :root {
    color-scheme: light;
    --page: #f1eef9; --panel: #fff; --well: #f7f7f7; --hover: #f0f0f0; --line: #e3e9f0; --line-soft: #e8ebf5; --rail-line: #e6e0f8;
    --control-line: #8a8f9a; --segments: rgb(18 26 40 / .05);
    --ink: #121a28; --body: #3b3e46; --muted: #596980; --faint: #94969d;
    --brand: #6d3fd8; --brand-hover: #5b30c0; --brand-active: #4c27a3; --on-brand: #fff; --tint: #efeaff; --tint-ink: #5b30c0; --chosen: #e9e2ff;
    --needs: #8a5a00; --needs-tint: #fdf0d9;
    --good: #107a52; --good-tint: #e3f7f0; --bad: #c02a3d; --bad-tint: #fce9eb; --wait: #8a5a00; --wait-tint: #fdf0d9;
    --toast: #121a28; --on-toast: #f5f5f5;
    --lift: 0 1px 2px rgb(18 26 40 / .04), 0 8px 20px rgb(18 26 40 / .06);
    --lift-high: 0 2px 4px rgb(18 26 40 / .04), 0 10px 24px rgb(18 26 40 / .08);
    --shell-lift: 0 1px 2px rgb(18 26 40 / .05);
    --sans: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    --mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) { :root {
    color-scheme: dark;
    --page: #17141f; --panel: #211e2a; --well: #1c1a24; --hover: #2a2734; --line: #34303f; --line-soft: #2e2b38; --rail-line: #2f2a3d;
    --control-line: #6b6f7a; --segments: rgb(255 255 255 / .06);
    --ink: #ecebf0; --body: #c9cad1; --muted: #a3acbd; --faint: #7d8089;
    --brand: #a58bfa; --brand-hover: #b9a4fb; --brand-active: #c9b8ff; --on-brand: #17112b; --tint: #2f2748; --tint-ink: #c9b8ff; --chosen: #3a3058;
    --needs: #f2c46b; --needs-tint: #3a3020;
    --good: #6fd3a6; --good-tint: #1b3329; --bad: #f4a3ad; --bad-tint: #44212a; --wait: #f2c46b; --wait-tint: #3a3020;
    --toast: #ecebf0; --on-toast: #17141f;
    --lift: 0 1px 2px rgb(0 0 0 / .3), 0 8px 20px rgb(0 0 0 / .25);
    --lift-high: 0 2px 4px rgb(0 0 0 / .3), 0 10px 24px rgb(0 0 0 / .4);
    --shell-lift: 0 1px 2px rgb(0 0 0 / .3);
  } }

  html, body { margin: 0; height: 100%; background: var(--page); color: var(--ink); font: 400 14px/1.43 var(--sans);
               -webkit-font-smoothing: antialiased; }
  body { display: flex; flex-direction: column; gap: 12px; padding: 12px; box-sizing: border-box; }
  a { color: var(--brand); text-decoration: none; font-weight: 500; }
  a:hover { color: var(--brand-hover); text-decoration: underline; text-underline-offset: 4px; }
  :focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
  [hidden] { display: none !important; }
  h2, h3 { font-family: var(--sans); font-weight: 700; letter-spacing: -.01em; color: var(--ink); }
  code { font: 12.5px/1.6 var(--mono); padding: 2px 7px; border-radius: 6px; background: var(--well); }
  details summary { cursor: pointer; color: var(--muted); font-weight: 500; }
  details summary:hover { color: var(--ink); }

  /* Buttons: WorkIt's. Violet for the one main action; white with a soft rule, or plain text, for the rest. */
  button, a.button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 38px; padding: 0 16px;
                     box-sizing: border-box; border-radius: 8px; border: 1px solid var(--line-soft); background: var(--panel);
                     color: var(--ink); font: 500 13px/1 var(--sans); white-space: nowrap; cursor: pointer; text-decoration: none;
                     transition: background-color .15s ease-out, border-color .15s ease-out, color .15s ease-out, transform .15s ease-out; }
  button:hover, a.button:hover { background: var(--hover); color: var(--ink); text-decoration: none; }
  button:active:not(:disabled), a.button:active { transform: scale(.98); }
  button:disabled { opacity: .5; cursor: default; }
  button.primary, a.button.primary { background: var(--brand); border-color: transparent; color: var(--on-brand); }
  button.primary:hover, a.button.primary:hover { background: var(--brand-hover); color: var(--on-brand); }
  button.primary:active, a.button.primary:active { background: var(--brand-active); }
  button.tonal { background: var(--tint); border-color: transparent; color: var(--tint-ink); }
  button.text, button.danger, button.close { border-color: transparent; background: transparent; padding: 0 10px; color: var(--muted); }
  button.text:hover, button.close:hover { background: var(--hover); color: var(--ink); }
  button.danger { color: var(--bad); }
  button.danger:hover { background: var(--bad-tint); color: var(--bad); }
  button.close { width: 28px; height: 28px; padding: 0; border-radius: 50%; font-size: 18px; color: var(--faint); }

  input:not([type]), input[type=search], textarea, select {
    box-sizing: border-box; width: 100%; padding: 9px 12px; border: 1px solid var(--control-line); border-radius: 8px;
    background: var(--panel); color: var(--ink); font: 400 14px/1.43 var(--sans); }
  input:not([type]):focus, input[type=search]:focus, textarea:focus, select:focus {
    outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--tint); }
  input::placeholder, textarea::placeholder { color: var(--muted); }
  textarea { resize: vertical; min-height: 3.2em; }
  input[type=checkbox] { accent-color: var(--brand); width: 16px; height: 16px; margin: 0; vertical-align: -3px; }

  /* Top: one floating panel, as WorkIt's top bar: the product, the run in a few words, then the tabs. */
  #runbar, #tabs { background: var(--panel); border: 1px solid var(--rail-line); }
  #runbar { flex: none; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; margin-bottom: -12px; padding: 14px 20px 6px;
            border-bottom: 0; border-radius: 20px 20px 0 0; color: var(--muted); font-size: 13px; }
  .brand { font: 700 20px/1 var(--sans); letter-spacing: -.02em; color: var(--ink); }
  #mode { align-self: center; display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 12px;
          font: 500 11px/1 var(--sans); background: var(--well); color: var(--muted); }
  #sample { align-self: center; display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 12px;
    background: #fde68a; color: #78350f; font-weight: 600; }
  #mode.run { background: var(--good-tint); color: var(--good); }
  #mode.rehearsal { background: var(--tint); color: var(--tint-ink); }
  #mode::before { content: ""; width: 6px; height: 6px; border-radius: 50%; margin-right: 7px; background: currentColor; }
  #runline { font-size: 13px; }
  #start { margin-left: auto; font-size: 15px; padding: 8px 18px; }
  #runline.paused { color: var(--wait); font-weight: 500; }
  #tabs { flex: none; display: flex; gap: 2px; padding: 4px 14px 10px; border-top: 0; border-radius: 0 0 20px 20px;
          box-shadow: var(--shell-lift); overflow-x: auto; }
  #tabs button { height: 34px; padding: 0 12px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); font-weight: 500; }
  #tabs button:hover { background: var(--tint); color: var(--ink); }
  #tabs button[aria-selected=true] { background: var(--chosen); color: var(--tint-ink); font-weight: 600; }

  /* Panes: a floating panel, as WorkIt's main one, around one readable column. */
  #inbox, #history, #answers, #accounts, #workers { border: 1px solid var(--rail-line); border-radius: 20px; background: var(--panel);
                                          box-shadow: var(--shell-lift); }
  #inbox, #history, #answers, #accounts { flex: 1; min-height: 0; overflow: auto; user-select: text; -webkit-user-select: text; }
  .inbox-wrap { max-width: 720px; margin: 0 auto; padding: 24px 24px 64px; }
  #answers { padding: 0 24px 64px; }
  #answers section { max-width: 720px; margin: 0 auto; }

  /* Needs you: a card per ask. Its kind in amber, what to do, who, why, one action. */
  .item { position: relative; margin: 0 0 12px; padding: 18px 20px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel);
          box-shadow: var(--lift); outline: none; }
  .item:focus-visible { border-color: var(--brand); box-shadow: var(--lift), 0 0 0 1px var(--brand); }
  .top { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .kind { font: 600 11px/1 var(--sans); letter-spacing: .08em; text-transform: uppercase; color: var(--needs); cursor: help; }
  .item.failed .kind { color: var(--bad); }
  .ago { flex: 1; font-size: 11px; color: var(--muted); }
  .top .close { margin: -6px -8px -6px 0; }
  .do { font: 700 18px/1.35 var(--sans); letter-spacing: -.01em; color: var(--ink); }
  .who { margin-top: 2px; font-size: 13px; color: var(--muted); }
  .who a.name { color: var(--muted); font-weight: 400; }
  .who a.name:hover { color: var(--brand); }
  .why { margin-top: 8px; color: var(--body); overflow-wrap: anywhere; }
  .flags { margin: 10px 0 0; padding: 0; list-style: none; display: grid; gap: 6px; }
  .flags li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 6px; padding: 8px 10px; border-radius: 8px;
              background: var(--needs-tint); color: var(--body); overflow-wrap: anywhere; }
  .flags li b { color: var(--needs); font-weight: 600; }
  .flags li span { flex: 1 1 12em; min-width: 0; }
  .flags li button { height: 26px; padding: 0 10px; font-size: 12px; }
  .chip.verified { margin-left: 8px; padding: 1px 8px; border-radius: 999px; font: 500 11px/1.6 var(--sans); background: var(--good-tint); color: var(--good); }
  .item .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 16px; }
  .item .then { font-size: 12px; color: var(--muted); }
  .item details { margin-top: 10px; font-size: 13px; }
  .item details div { margin-top: 6px; padding: 10px 12px; border-radius: 8px; background: var(--well); white-space: pre-line; overflow-wrap: anywhere; color: var(--body); }
  .ask { margin-top: 14px; }
  .ask > label { display: block; margin-bottom: 8px; color: var(--body); font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
  .ask .options, .ask select { margin-bottom: 8px; }
  .ask > .where { margin: -4px 0 8px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
  .ask > label.question { margin: 10px 0 4px; color: var(--ink); font-weight: 600; }
  .ask .need { margin-left: 8px; padding: 1px 6px; border: 1px solid var(--rail-line); border-radius: 999px;
               font-size: 11px; font-weight: 500; color: var(--muted); white-space: nowrap; }
  .ask .need.required { color: var(--body); }
  .answer-row { display: flex; gap: 8px; align-items: center; }
  .essay-row { display: flex; gap: 8px; align-items: center; justify-content: space-between; min-height: 28px; margin-top: 4px; }
  .answer-row input { flex: 1; min-width: 0; }
  .answer-row .goto { white-space: nowrap; }
  .file-options { display: flex; flex-wrap: wrap; gap: 8px; }
  .file-types { margin-top: 6px; font-size: 12px; color: var(--muted); }
  .failures { margin-top: 28px; font-size: 13px; }
  .failures > summary { padding: 6px 0 12px; }
  .empty-state { padding: 72px 8px 24px; text-align: center; color: var(--muted); font-size: 14px; }
  .empty-state h2 { margin: 0 0 10px; font-size: 26px; line-height: 1.25; letter-spacing: -.02em; }
  .empty-state p { margin: 6px 0; }
  .empty-state .safe { max-width: 520px; margin: 28px auto 0; font-size: 12px; color: var(--muted); }

  /* WorkIt's toast: a white card in the bottom right corner. */
  #toast { position: fixed; right: 16px; bottom: 16px; z-index: 5; display: flex; align-items: center; gap: 12px;
           width: min(24rem, calc(100vw - 32px)); box-sizing: border-box; padding: 10px 8px 10px 16px;
           border: 1px solid var(--line-soft); border-radius: 10px; background: var(--panel); color: var(--ink); font-size: 14px;
           box-shadow: var(--lift-high); }
  #toast span { flex: 1; min-width: 0; }
  #toast button { flex: none; height: 30px; border: 0; background: transparent; color: var(--brand); }
  #toast button:hover { background: var(--tint); color: var(--brand-hover); }

  /* History: one quiet list. */
  #history-list:not(:empty) { border: 1px solid var(--line); border-radius: 10px; background: var(--panel); box-shadow: var(--lift); overflow: hidden; }
  .done { display: grid; grid-template-columns: 44px 92px 1fr; gap: 0 12px; padding: 14px 20px; outline: none; }
  .done + .done { border-top: 1px solid var(--line); }
  .done:focus-visible { box-shadow: inset 0 0 0 2px var(--brand); }
  .done .when { padding-top: 1px; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .done .verdict { justify-self: start; align-self: start; padding: 2px 10px; border-radius: 999px; font: 500 11px/1.6 var(--sans); white-space: nowrap;
                   background: var(--well); color: var(--muted); }
  .done.submitted .verdict, .done.verified .verdict { background: var(--good-tint); color: var(--good); }
  .done.needs .verdict { background: var(--needs-tint); color: var(--needs); }
  .done.failed .verdict { background: var(--bad-tint); color: var(--bad); }
  .done .what { min-width: 0; overflow-wrap: anywhere; }
  .done .what > div:first-child, .done .what > div:first-child a { color: var(--ink); font-weight: 600; }
  .done .why { color: var(--muted); font-size: 13px; }
  .done .links { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 4px; font-size: 13px; }
  .history-bar { margin: 14px 4px; font-size: 13px; }
  .history-empty { padding: 72px 8px; text-align: center; color: var(--muted); }
  details.applied { margin: 24px 4px 0; }
  details.applied .help { margin: 10px 0; font-size: 13px; color: var(--muted); }
  details.applied .card { display: grid; gap: 10px; }
  details.applied .actions { display: flex; gap: 10px; align-items: center; }
  @media (max-width: 560px) { .done { grid-template-columns: 44px 1fr; } .done .what { grid-column: 1 / -1; margin-top: 6px; } }

  /* Answers: a search field and three choices, then the answers themselves. */
  .bar { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px;
         max-width: 720px; margin: 0 auto; padding: 20px 0 12px; background: var(--panel); }
  #search { flex: 1 1 220px; width: auto; min-width: 0; height: 40px; padding: 0 16px; border: 0; border-radius: 999px; background: var(--well); }
  #search:hover { background: var(--hover); }
  #search:focus { box-shadow: 0 0 0 2px var(--brand); }
  .segments { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--segments); }
  .segments label { display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: 999px; cursor: pointer;
                    color: var(--muted); font-weight: 500; font-size: 12px; white-space: nowrap; }
  .segments label:hover { color: var(--ink); }
  .segments input { display: none; }
  .segments label:has(input:checked) { background: var(--panel); color: var(--ink);
                                       box-shadow: 0 1px 2px rgb(18 26 40 / .08), 0 2px 8px rgb(18 26 40 / .08); }
  #check-count:not(:empty) { margin-left: 4px; color: var(--needs); }
  #answers h2 { margin: 28px 0 10px; font-size: 20px; }
  #answers h3 { margin: 18px 0 6px; font: 600 13px/1.3 var(--sans); color: var(--muted); text-transform: capitalize; }
  .count { margin-left: 6px; font: 400 13px/1 var(--sans); color: var(--muted); }
  .hidden-note { display: flex; align-items: center; gap: 4px; margin: -4px 0 10px; font-size: 12px; color: var(--muted); }
  .hidden-note:empty { display: none; }
  .hidden-note button { height: 26px; padding: 0 8px; border: 0; background: none; color: var(--brand); }
  #add-open { margin-top: 6px; }
  .card { margin: 0 0 10px; padding: 14px 18px; min-width: 0; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); box-shadow: var(--lift); }
  .card.add { display: grid; gap: 10px; }
  .account .actions { margin-top: 10px; }
  .bank-entry { outline: none; }
  .bank-entry .head { cursor: pointer; }
  .bank-entry:hover { background: var(--hover); }
  .bank-entry.open { background: var(--panel); }
  .bank-entry:focus-visible, .bank-entry.open { border-color: var(--brand); box-shadow: var(--lift), 0 0 0 1px var(--brand); }
  .q { font-weight: 600; overflow-wrap: anywhere; }
  .a { margin-top: 4px; color: var(--body); overflow-wrap: anywhere; white-space: pre-line; display: -webkit-box;
       -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .open .a { display: none; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; margin-top: 8px; font-size: 11px; color: var(--muted); }
  .badge { padding: 2px 8px; border-radius: 6px; font: 500 12px/1.4 var(--sans); white-space: nowrap; }
  .badge.unreviewed { background: var(--needs-tint); color: var(--needs); }
  .badge.used { background: var(--tint); color: var(--tint-ink); }
  .editor { display: grid; gap: 10px; margin-top: 12px; }
  .options { display: grid; gap: 6px; }
  .options label { display: flex; gap: 10px; align-items: center; overflow-wrap: anywhere; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .status { font-size: 12px; color: var(--muted); }
  .status.unsaved { color: var(--wait); }
  .status.ok { color: var(--good); }
  .status.error { color: var(--bad); font-weight: 500; }
  .stock-entry .q, .answered-entry .q { margin-bottom: 8px; }
  .facts { display: grid; grid-template-columns: minmax(9em, 32%) 1fr; gap: 6px 16px; padding: 16px 18px; border: 1px solid var(--line);
           border-radius: 10px; background: var(--panel); box-shadow: var(--lift); }
  .facts dt { color: var(--muted); font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
  .facts dd { margin: 0; color: var(--ink); white-space: pre-line; overflow-wrap: anywhere; }
  .facts dd.blank { color: var(--faint); }
  .empty { color: var(--muted); }
  @media (max-width: 560px) { .facts { grid-template-columns: 1fr; } .facts dd { margin-bottom: 6px; } }

  /* Live: a card per browser, its header coloured by its state. */
  #workers { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; user-select: none; -webkit-user-select: none; }
  .norun { max-width: 520px; margin: 0 auto; padding: 72px 24px; text-align: center; color: var(--muted); font-size: 14px; }
  .norun button { margin: 18px auto 0; }
  #grid { display: grid; flex: 1; min-height: 0; gap: 12px; padding: 16px; box-sizing: border-box; }
  .tile { position: relative; display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden;
          border: 1px solid var(--line); border-radius: 10px; background: var(--panel); box-shadow: var(--lift); }
  .tile:not(.big) { cursor: pointer; }
  .tile.big { position: fixed; inset: 12px; z-index: 2; border-color: var(--brand); border-radius: 20px; box-shadow: var(--lift-high), 0 0 0 1px var(--brand); }
  .banner { display: flex; flex-wrap: wrap; column-gap: 8px; align-items: center; min-height: 36px; padding: 6px 14px; box-sizing: border-box;
            font-weight: 600; font-size: 13px; background: var(--well); color: var(--ink); }
  .banner .label { flex: 1 1 11em; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .banner .fields { flex: none; font-weight: 400; font-size: 12px; color: var(--muted); }
  .banner.filling { background: var(--tint); color: var(--tint-ink); }
  /* Verifying: the form is read back and checked; a small spinner before its label. Verified: a check mark. */
  .banner.verifying { background: var(--tint); color: var(--tint-ink); }
  .banner.verifying .label::before { content: ""; display: inline-block; width: 10px; height: 10px; margin-right: 8px; vertical-align: -1px;
                                     border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%;
                                     animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .banner.verifying .label::before { animation-duration: 3s; } }
  .banner.verified .label::before { content: "✓"; margin-right: 6px; color: var(--good); }
  .banner.ready { background: var(--panel); box-shadow: inset 0 -1px 0 var(--line); }  /* filled, not sent: never the green of sent */
  .banner.submitted { background: var(--good-tint); color: var(--good); }
  .banner.needs { background: var(--needs-tint); color: var(--needs); }
  .banner.failed { background: var(--bad-tint); color: var(--bad); }
  .caption { padding: 6px 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; color: var(--muted); }
  .sent { display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 0 14px 6px; font-size: 12px; color: var(--muted); cursor: default; }
  .capture { padding: 0 14px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; color: var(--needs); cursor: default; }
  .sent .doc { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .sent a, .sent button { height: auto; padding: 0; border: 0; border-radius: 0; background: none; font: 500 12px/1.4 var(--sans); color: var(--brand); }
  .detail { display: none; flex: none; max-height: 40%; overflow: auto; padding: 12px 16px; white-space: pre-line; background: var(--well); }
  .detail details { margin-top: 6px; white-space: pre-wrap; }
  .tile.big .detail:not(:empty) { display: block; }
  img { flex: 1; min-height: 0; width: 100%; object-fit: contain; object-position: center; outline: none; background: var(--well); }
  img:not([src]) { visibility: hidden; }  /* no frame yet: no broken-picture icon */
  .hint { display: none; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 8px 16px; border-radius: 8px;
          background: var(--toast); color: var(--on-toast); font-weight: 500; white-space: nowrap; pointer-events: none; box-shadow: var(--lift-high); }
  .tile:not(.big):hover .hint { display: block; }
  .note { display: none; align-items: center; gap: 12px; padding: 8px 14px; background: var(--brand); color: var(--on-brand);
          font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile.big .note { display: flex; }
  .note button { height: 28px; border-color: transparent; background: var(--on-brand); color: var(--brand); }
  .menu { position: absolute; z-index: 3; max-height: 50%; min-width: 180px; max-width: 80%; overflow: auto; padding: 6px;
          border: 1px solid var(--line-soft); border-radius: 10px; background: var(--panel); color: var(--ink); box-shadow: var(--lift-high); }
  .menu div { padding: 0 10px; height: 34px; line-height: 34px; border-radius: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: default; }
  .menu div:hover { background: var(--hover); }
  .menu div.chosen { background: var(--chosen); color: var(--tint-ink); }
  .menu div.disabled { color: var(--faint); pointer-events: none; }
  .written-text { white-space: pre-wrap; font-size: 13px; margin: 4px 0 6px; color: var(--text, inherit); }
  .written .why.error { color: var(--error, #b00020); }
  .resumebar { display: flex; align-items: center; gap: 12px; padding: 0 14px 8px; font-size: 12px; color: var(--muted); }
  .resumebar button { height: 30px; }
  .askclaude { flex: none; padding: 0 14px 8px; font-size: 12px; cursor: default; user-select: text; -webkit-user-select: text; }
  .askclaude .thread { max-height: 9em; overflow: auto; }
  .tile.big .askclaude .thread { max-height: 22vh; }
  .tile:not(.big) .askclaude .turn:not(:last-child) { display: none; }  /* a small tile shows the latest only */
  .askclaude .turn { padding: 4px 0; border-top: 1px solid var(--line); }
  .askclaude .you { color: var(--muted); }
  .askclaude .claude.working { color: var(--tint-ink); }
  .askclaude .error { color: var(--bad); }
  .askclaude .needs { color: var(--needs); }
  .askclaude .offer { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .askclaude .offer button { height: 26px; }
  .askclaude form { display: flex; gap: 8px; padding-top: 4px; }
  .askclaude input { flex: 1; min-width: 0; height: 30px; }
  .askclaude button.go { height: 30px; }
  .filebar { position: absolute; left: 10px; right: 10px; bottom: 10px; z-index: 3; display: flex; align-items: center; gap: 8px;
             padding: 6px 6px 6px 16px; border: 1px solid var(--line-soft); border-radius: 10px; background: var(--panel); color: var(--ink);
             white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: var(--lift-high); }
  #grid:has(.tile.big) .tile:not(.big) .filebar { display: none; }  /* another tile's bar never covers the enlarged one */
  .filebar label { display: inline-flex; align-items: center; height: 30px; padding: 0 14px; border-radius: 8px; cursor: pointer;
                   background: var(--brand); color: var(--on-brand); font-weight: 500; }
  .filebar label:hover { background: var(--brand-hover); }
  .filebar button { height: 30px; border: 0; background: transparent; color: var(--muted); }
"""
