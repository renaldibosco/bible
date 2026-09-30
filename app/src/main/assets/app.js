(() => {
  "use strict";

  // ------------------------------------------------------------ helpers
  const $ = (id) => document.getElementById(id);
  const native = typeof window.Bible !== "undefined";
  const NT_START = 39;
  const store = {
    get(k, d) { try { const v = localStorage.getItem("bible." + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem("bible." + k, JSON.stringify(v)); } catch (_) {} }
  };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nn = (b) => String(b + 1).padStart(2, "0");

  const state = {
    lang: store.get("lang", "en"),
    par: store.get("par", ""),
    book: store.get("book", 0),
    chap: store.get("chap", 1),
    fs: store.get("fs", 20),
    theme: store.get("theme", "paper"),
    rate: store.get("rate", 1.0),
    autoNext: store.get("autoNext", true),
    sel: new Set(),
    verses: [],        // current chapter [[label, text], ...]
    player: null
  };
  let marks = store.get("marks", {});          // "b:c:label" -> {color, note, t}
  const mkey = (b, c, label) => `${b}:${c}:${label}`;
  const saveMarks = () => store.set("marks", marks);
  if (!LANGS[state.lang]) state.lang = "en";
  if (state.par && (!LANGS[state.par] || state.par === state.lang)) state.par = "";

  // ------------------------------------------------------------ text data
  const cache = new Map();
  async function getBook(lang, b) {
    const key = lang + ":" + b;
    if (cache.has(key)) return cache.get(key);
    let data;
    if (native) {
      const raw = window.Bible.loadBook(lang, b + 1);
      data = raw ? JSON.parse(raw) : [];
    } else {
      const r = await fetch(`data/${lang}/${nn(b)}.json`);
      data = r.ok ? await r.json() : [];
    }
    if (cache.size > 24) cache.delete(cache.keys().next().value);
    cache.set(key, data);
    return data;
  }
  const bookName = (b, lang = state.lang) => BOOKS[lang][b];

  // ------------------------------------------------------------ rendering
  async function render(opts = {}) {
    const book = await getBook(state.lang, state.book);
    const count = book.length || CHAPTERS[state.book];
    state.chap = Math.min(Math.max(1, state.chap), count);
    state.verses = book[state.chap - 1] || [];
    let parMap = null;
    if (state.par) {
      const pb = await getBook(state.par, state.book);
      parMap = new Map();
      for (const [label, text] of (pb[state.chap - 1] || [])) {
        for (const n of expand(label)) if (!parMap.has(n)) parMap.set(n, text);
      }
    }
    clearSelection(true);
    const L = LANGS[state.lang];
    let html = `<div class="chap-head"><div class="book">${esc(bookName(state.book))}</div>` +
      `<div class="num">${state.chap}</div><div class="ver">${esc(L.version)}</div></div>`;
    if (!state.verses.length) {
      html += `<div class="empty-note">This chapter isn't available in ${esc(L.name)}.</div>`;
    }
    state.verses.forEach(([label, text], i) => {
      let par = "";
      if (parMap) {
        const bits = [...new Set(expand(label).map((n) => parMap.get(n)).filter(Boolean))];
        if (bits.length) par = `<span class="par" lang="${state.par}">${esc(bits.join(" "))}</span>`;
      }
      const m = marks[mkey(state.book, state.chap, label)];
      const cls = m && m.color ? ` hl-${m.color}` : "";
      const note = m && m.note ? `<button class="note-ic" data-i="${i}" aria-label="Open note"><svg viewBox="0 0 24 24"><path d="M5 19h4L19 9l-4-4L5 15v4z"/></svg></button>` : "";
      html += `<span class="verse${cls}" data-i="${i}" id="v${i}"><span class="n">${esc(label)}</span>${esc(text)}${note}${par}</span>`;
    });
    const el = $("chapter");
    el.dataset.lang = state.lang;
    el.lang = state.lang;
    el.innerHTML = html;
    $("refBook").textContent = bookName(state.book);
    $("refBtn").lang = state.lang;
    $("refChap").textContent = state.chap;
    $("langShort").textContent = L.short;
    $("prevBtn").disabled = state.book === 0 && state.chap === 1;
    $("nextBtn").disabled = state.book === 65 && state.chap === count;
    store.set("book", state.book); store.set("chap", state.chap);
    addHistory(state.book, state.chap);
    if (opts.scroll !== false) window.scrollTo(0, 0);
    if (state.player) markReading();
  }
  function expand(label) {
    const m = String(label).match(/^(\d+)(?:-(\d+))?/);
    if (!m) return [label];
    const a = +m[1], b = m[2] ? +m[2] : a;
    const out = [];
    for (let n = a; n <= b && out.length < 40; n++) out.push(String(n));
    return out;
  }

  async function go(book, chap, opts) {
    state.book = book; state.chap = chap;
    await render(opts);
  }
  async function step(dir) {
    let b = state.book, c = state.chap + dir;
    const count = (await getBook(state.lang, b)).length || CHAPTERS[b];
    if (c < 1) {
      if (b === 0) return false;
      b -= 1; c = (await getBook(state.lang, b)).length || CHAPTERS[b];
    } else if (c > count) {
      if (b === 65) return false;
      b += 1; c = 1;
    }
    await go(b, c);
    return true;
  }

  // ------------------------------------------------------------ verse selection
  $("chapter").addEventListener("click", (e) => {
    const ni = e.target.closest(".note-ic");
    if (ni) { e.stopPropagation(); openNote([+ni.dataset.i]); return; }
    const v = e.target.closest(".verse");
    if (!v) return;
    const s = window.getSelection();
    if (s && !s.isCollapsed && s.toString().trim()) return;   // user is selecting text
    const i = +v.dataset.i;
    if (state.sel.has(i)) { state.sel.delete(i); v.classList.remove("sel"); }
    else { state.sel.add(i); v.classList.add("sel"); }
    updateSelBar();
  });
  function updateSelBar() {
    const n = state.sel.size;
    $("selBar").hidden = n === 0 || !!state.player;
    document.body.classList.toggle("selecting", n > 0);
    $("selCount").textContent = n === 1 ? "1 verse" : `${n} verses`;
  }
  function clearSelection(silent) {
    state.sel.clear();
    document.querySelectorAll(".verse.sel").forEach((v) => v.classList.remove("sel"));
    if (!silent) updateSelBar(); else { $("selBar").hidden = true; document.body.classList.remove("selecting"); }
  }
  function selectedIdx() { return [...state.sel].sort((a, b) => a - b); }
  function refText(idx) {
    // "John 3:16-18" style reference for the chosen verses
    const labels = idx.map((i) => state.verses[i][0]);
    let ref = labels[0];
    if (labels.length > 1) {
      const nums = idx.map((i) => +expand(state.verses[i][0])[0]);
      const contiguous = nums.every((n, k) => k === 0 || n >= nums[k - 1]) && idx.every((v, k) => k === 0 || v === idx[k - 1] + 1);
      ref = contiguous ? `${labels[0].split("-")[0]}-${labels[labels.length - 1].split("-").pop()}` : labels.join(",");
    }
    return `${bookName(state.book)} ${state.chap}:${ref}`;
  }
  function selectionText() {
    const idx = selectedIdx();
    const body = idx.map((i) => (idx.length > 1 ? state.verses[i][0] + " " : "") + state.verses[i][1]).join("\n");
    return `${body}\n— ${refText(idx)} (${LANGS[state.lang].short})`;
  }
  $("selClear").onclick = () => clearSelection();
  $("selCopy").onclick = () => {
    const t = selectionText();
    if (native) window.Bible.copy(t);
    else navigator.clipboard && navigator.clipboard.writeText(t);
    toast("Copied");
    clearSelection();
  };
  $("selShare").onclick = () => {
    const t = selectionText();
    if (native) window.Bible.share(t);
    else if (navigator.share) navigator.share({ text: t }).catch(() => {});
    else { navigator.clipboard && navigator.clipboard.writeText(t); toast("Copied"); }
  };
  $("selListen").onclick = () => {
    const idx = selectedIdx();
    const items = idx.map((i) => ({ text: state.verses[i][1], lang: state.lang, verse: i }));
    play(items, { title: refText(idx), chapter: false, book: state.book, chap: state.chap });
    clearSelection();
  };

  // long-press text selection -> "Read aloud"
  let selTimer = 0;
  document.addEventListener("selectionchange", () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const s = window.getSelection();
      const ok = s && !s.isCollapsed && s.toString().trim().length > 1 &&
        $("chapter").contains(s.anchorNode) && !state.player;
      $("readSelection").hidden = !ok;
    }, 180);
  });
  $("readSelection").addEventListener("mousedown", (e) => e.preventDefault());
  $("readSelection").addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  $("readSelection").addEventListener("touchend", (e) => { e.preventDefault(); readSelection(); });
  $("readSelection").addEventListener("click", () => readSelection());

  function readSelection(textFromNative) {
    const text = (textFromNative || String(window.getSelection() || "")).trim();
    $("readSelection").hidden = true;
    if (!text) { toast("Select some text first"); return; }
    const items = splitByScript(text).map((r) => ({ text: r.text, lang: r.lang }));
    try { window.getSelection().removeAllRanges(); } catch (_) {}
    play(items, { title: "Selected text", sub: text.slice(0, 60), chapter: false });
  }
  window.readSelection = readSelection;

  function scriptOf(ch) {
    const c = ch.codePointAt(0);
    if (c >= 0x0B80 && c <= 0x0BFF) return "ta";
    if (c >= 0x0B00 && c <= 0x0B7F) return "or";
    if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) return "en";
    return "";
  }
  function splitByScript(text) {
    const runs = [];
    let cur = null;
    for (const ch of text) {
      const s = scriptOf(ch);
      if (!cur) cur = { lang: s || state.lang, text: "" };
      else if (s && s !== cur.lang && cur.text.trim()) { runs.push(cur); cur = { lang: s, text: "" }; }
      else if (s && !cur.text.trim()) cur.lang = s;
      cur.text += ch;
    }
    if (cur && cur.text.trim()) runs.push(cur);
    // split long runs into sentence-sized pieces so highlighting & pausing stay responsive
    const out = [];
    for (const r of runs) {
      for (const piece of r.text.split(/(?<=[.!?;।॥\n])\s+/)) if (piece.trim()) out.push({ lang: r.lang, text: piece.trim() });
    }
    return out;
  }

  // ------------------------------------------------------------ speech
  const tts = native ? {
    queue(items, rate) { window.Bible.speakQueue(JSON.stringify(items), rate); },
    stop() { window.Bible.stopSpeaking(); },
    status(tag) { try { return window.Bible.voiceStatus(tag); } catch (_) { return "unknown"; } }
  } : {
    queue(items, rate) {
      speechSynthesis.cancel();
      for (const it of items) {
        const u = new SpeechSynthesisUtterance(it.text);
        u.lang = it.tag; u.rate = rate;
        u.onstart = () => window.ttsEvent("start", it.id);
        u.onend = () => window.ttsEvent("done", it.id);
        u.onerror = (e) => { if (e.error !== "interrupted" && e.error !== "canceled") window.ttsEvent("error", it.id, e.error); };
        speechSynthesis.speak(u);
      }
    },
    stop() { speechSynthesis.cancel(); },
    status(tag) {
      const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
      if (!vs.length) return "unknown";
      return vs.some((v) => v.lang.replace("_", "-").toLowerCase().startsWith(tag.slice(0, 2))) ? "ok" : "missing";
    }
  };

  function speakable(t) {
    return t.replace(/\([^()]*\d+\s*[:.]\s*\d+[^()]*\)/g, " ")   // inline cross-references like (ஏசா. 40:3)
      .replace(/[\[\]]/g, "").replace(/\s+/g, " ").trim();
  }

  let seq = 0;
  function play(items, meta) {
    items = items.map((it) => ({ ...it, text: speakable(it.text) })).filter((it) => it.text);
    if (!items.length) { toast("Nothing to read"); return; }
    const langs = [...new Set(items.map((it) => it.lang))];
    for (const l of langs) {
      const st = tts.status(LANGS[l].tts);
      if (st === "missing") {
        toast(`${LANGS[l].name} voice isn't installed on this phone. Open Settings › Voice to add it.`, 5200);
        if (langs.length === 1) return;
      } else if (st === "noengine") {
        toast("No text-to-speech engine found. Install “Speech Services by Google” from Play Store.", 5200);
        return;
      }
    }
    tts.stop();
    const run = ++seq;
    items.forEach((it, k) => { it.id = `r${run}_${k}`; it.tag = LANGS[it.lang].tts; });
    state.player = { items, pos: 0, paused: false, meta, run };
    clearSelection(true);
    $("readSelection").hidden = true;
    document.body.classList.add("playing");
    $("player").hidden = false;
    $("playerTitle").textContent = meta.title;
    $("playerSub").textContent = meta.sub || LANGS[items[0].lang].name;
    setPauseIcon(false);
    $("rateBtn").textContent = state.rate.toFixed(1) + "×";
    tts.queue(items, state.rate);
    keepAwake(true);
  }
  function resumeFrom(pos) {
    const p = state.player;
    if (!p) return;
    p.pos = pos; p.paused = false;
    tts.stop();
    tts.queue(p.items.slice(pos), state.rate);
    setPauseIcon(false);
  }
  function stopPlayer() {
    tts.stop();
    setSleep(0);
    state.sleepEOC = false;
    state.player = null;
    document.body.classList.remove("playing");
    $("player").hidden = true;
    document.querySelectorAll(".verse.reading").forEach((v) => v.classList.remove("reading"));
    updateSelBar();
    keepAwake(false);
  }
  function setPauseIcon(paused) {
    $("pauseIcon").innerHTML = paused ? '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>' : '<path d="M8 5v14M16 5v14"/>';
    $("pauseBtn").setAttribute("aria-label", paused ? "Resume" : "Pause");
  }
  function markReading() {
    const p = state.player;
    document.querySelectorAll(".verse.reading").forEach((v) => v.classList.remove("reading"));
    if (!p) return;
    const it = p.items[p.pos];
    if (!it || it.verse == null || p.meta.book !== undefined && (p.meta.book !== state.book || p.meta.chap !== state.chap)) return;
    const el = $("v" + it.verse);
    if (el) {
      el.classList.add("reading");
      const r = el.getBoundingClientRect();
      if (r.top < 70 || r.bottom > window.innerHeight - 110) {
        window.scrollTo({ top: window.scrollY + r.top - window.innerHeight * 0.3, behavior: "smooth" });
      }
    }
  }
  window.ttsEvent = (type, id, msg) => {
    const p = state.player;
    if (type === "error" && !id && p) { toast(msg === "starting" ? "Voice is still starting, try again in a moment" : "Couldn't read aloud"); stopPlayer(); return; }
    if (!p || !id || !id.startsWith(`r${p.run}_`)) return;
    const k = +id.split("_")[1];
    if (type === "start") {
      p.pos = k;
      markReading();
      if (p.meta.chapter) $("playerSub").textContent = `Verse ${p.items[k].label || k + 1} · ${LANGS[p.items[k].lang].name}`;
    } else if (type === "done" && k === p.items.length - 1 && !p.paused) {
      if (state.sleepEOC) { state.sleepEOC = false; toast("Sleep timer: stopped at the end of the chapter"); stopPlayer(); }
      else if (p.meta.chapter && state.autoNext) {
        step(1).then((moved) => (moved ? playChapter(0) : stopPlayer()));
      } else stopPlayer();
    } else if (type === "error") {
      const l = p.items[k] ? LANGS[p.items[k].lang].name : "";
      if (msg === "nolang") toast(`${l} voice isn't installed on this phone. Open Settings › Voice to add it.`, 5200);
      else toast("Couldn't read aloud" + (msg ? ` (${msg})` : ""));
      stopPlayer();
    }
  };

  function playChapter(from) {
    const items = state.verses.map(([label, text], i) => ({ text, lang: state.lang, verse: i, label }))
      .slice(from || 0);
    play(items, { title: `${bookName(state.book)} ${state.chap}`, chapter: true, book: state.book, chap: state.chap });
  }
  $("playFab").onclick = () => {
    const idx = selectedIdx();
    playChapter(idx.length ? idx[0] : 0);
  };
  $("pauseBtn").onclick = () => {
    const p = state.player;
    if (!p) return;
    if (p.paused) resumeFrom(p.pos);
    else { p.paused = true; tts.stop(); setPauseIcon(true); }
  };
  $("stopBtn").onclick = stopPlayer;
  const RATES = [0.6, 0.75, 0.9, 1.0, 1.15, 1.3, 1.5, 1.75, 2.0];
  function setRate(r) {
    state.rate = Math.round(r * 100) / 100;
    store.set("rate", state.rate);
    $("rateVal").textContent = state.rate.toFixed(2).replace(/0$/, "") + "×";
    $("rateBtn").textContent = state.rate.toFixed(2).replace(/0$/, "") + "×";
    if (state.player && !state.player.paused) resumeFrom(state.player.pos);
  }
  function nextRate(dir) {
    let i = RATES.findIndex((r) => r >= state.rate - 0.001);
    if (i < 0) i = RATES.length - 1;
    i = dir > 0 ? (i + 1) % RATES.length : Math.max(0, i - 1);
    setRate(RATES[i]);
  }
  $("rateBtn").onclick = () => nextRate(1);
  $("rateUp").onclick = () => { if (state.rate < 2) nextRate(1); };
  $("rateDown").onclick = () => nextRate(-1);

  function keepAwake(on) { if (native && window.Bible.keepAwake) window.Bible.keepAwake(on); }

  // ------------------------------------------------------------ sheets
  let openSheet = null;
  function show(id) {
    hideSheet();
    openSheet = $(id);
    openSheet.hidden = false;
    $("scrim").hidden = false;
  }
  function hideSheet() {
    if (openSheet) openSheet.hidden = true;
    openSheet = null;
    $("scrim").hidden = true;
  }
  $("scrim").onclick = hideSheet;

  // book & chapter picker
  let testament = "ot";
  $("refBtn").onclick = () => {
    testament = state.book >= NT_START ? "nt" : "ot";
    renderBooks();
    $("chapterPick").hidden = true;
    $("bookList").hidden = false;
    show("pickSheet");
    const cur = document.querySelector(".book.current");
    if (cur) cur.scrollIntoView({ block: "center" });
  };
  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => {
    testament = t.dataset.testament;
    $("chapterPick").hidden = true; $("bookList").hidden = false;
    renderBooks();
    $("bookList").scrollTop = 0;
  }));
  function renderBooks() {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.testament === testament));
    const [a, z] = testament === "ot" ? [0, NT_START] : [NT_START, 66];
    let h = "";
    for (let b = a; b < z; b++) {
      h += `<button class="book${b === state.book ? " current" : ""}" data-b="${b}"><span class="bn">${esc(bookName(b))}</span>` +
        (state.lang !== "en" ? `<span class="be">${esc(BOOKS.en[b])}</span>` : `<span class="be">${CHAPTERS[b]}</span>`) + `</button>`;
    }
    $("bookList").innerHTML = h;
    $("pickSheet").lang = state.lang;
  }
  $("bookList").onclick = async (e) => {
    const btn = e.target.closest(".book");
    if (!btn) return;
    const b = +btn.dataset.b;
    const count = (await getBook(state.lang, b)).length || CHAPTERS[b];
    if (count === 1) { hideSheet(); go(b, 1); return; }
    $("pickBookName").textContent = bookName(b);
    let h = "";
    for (let c = 1; c <= count; c++) h += `<button data-c="${c}" class="${b === state.book && c === state.chap ? "current" : ""}">${c}</button>`;
    $("chapterGrid").innerHTML = h;
    $("chapterGrid").dataset.b = b;
    $("bookList").hidden = true;
    $("chapterPick").hidden = false;
    $("chapterPick").scrollTop = 0;
  };
  $("backToBooks").onclick = () => { $("chapterPick").hidden = true; $("bookList").hidden = false; };
  $("chapterGrid").onclick = (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    hideSheet();
    go(+$("chapterGrid").dataset.b, +btn.dataset.c);
  };

  // language
  $("langBtn").onclick = () => { renderLangs(); show("langSheet"); };
  function renderLangs() {
    let h = "";
    for (const [k, L] of Object.entries(LANGS)) {
      h += `<button class="choice${k === state.lang ? " on" : ""}" data-l="${k}"><div><div class="cn">${L.native}</div>` +
        `<div class="cv">${esc(L.version)}</div></div><span class="tick"></span></button>`;
    }
    $("langList").innerHTML = h;
    let p = `<button class="chip${!state.par ? " on" : ""}" data-p="">Off</button>`;
    for (const [k, L] of Object.entries(LANGS)) {
      if (k !== state.lang) p += `<button class="chip${k === state.par ? " on" : ""}" data-p="${k}">${L.native}</button>`;
    }
    $("parList").innerHTML = p;
  }
  $("langList").onclick = (e) => {
    const btn = e.target.closest(".choice");
    if (!btn) return;
    state.lang = btn.dataset.l;
    if (state.par === state.lang) state.par = "";
    store.set("lang", state.lang); store.set("par", state.par);
    if (state.player) stopPlayer();
    scheduleDaily();
    renderLangs();
    render({ scroll: false }).then(showVotd);
    setTimeout(hideSheet, 180);
  };
  $("parList").onclick = (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    state.par = btn.dataset.p;
    store.set("par", state.par);
    renderLangs();
    render({ scroll: false });
  };

  // settings
  $("menuBtn").onclick = () => { renderSettings(); show("menuSheet"); };
  function renderSettings() {
    $("fontVal").textContent = state.fs;
    document.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("on", s.dataset.theme === state.theme));
    $("rateVal").textContent = state.rate.toFixed(2).replace(/0$/, "") + "×";
    $("autoNext").checked = state.autoNext;
    renderVotdSettings();
    let h = "";
    for (const L of Object.values(LANGS)) {
      const st = tts.status(L.tts);
      const label = st === "ok" ? '<span class="ok">Ready</span>'
        : st === "missing" ? '<span class="no">Not installed</span>'
        : st === "noengine" ? '<span class="no">No speech engine</span>'
        : '<span>Checking…</span>';
      h += `<div class="voice-row"><span>${L.native} voice</span>${label}</div>`;
    }
    $("voiceList").innerHTML = h;
  }
  function applyLook() {
    document.body.dataset.theme = state.theme;
    document.documentElement.style.setProperty("--fs", state.fs + "px");
    if (native && window.Bible.setBars) window.Bible.setBars(state.theme === "night" ? "#13110F" : state.theme === "sepia" ? "#F3E9D6" : "#FBF8F2", state.theme === "night");
  }
  $("fontUp").onclick = () => { state.fs = Math.min(34, state.fs + 1); store.set("fs", state.fs); applyLook(); renderSettings(); };
  $("fontDown").onclick = () => { state.fs = Math.max(14, state.fs - 1); store.set("fs", state.fs); applyLook(); renderSettings(); };
  document.querySelectorAll(".swatch").forEach((s) => (s.onclick = () => {
    state.theme = s.dataset.theme; store.set("theme", state.theme); applyLook(); renderSettings();
  }));
  $("autoNext").onchange = (e) => { state.autoNext = e.target.checked; store.set("autoNext", state.autoNext); };
  $("voiceSettings").onclick = () => {
    if (native) window.Bible.openVoiceSettings();
    else toast("Voice settings open on the phone app");
  };
  window.voicesChanged = () => { if (openSheet === $("menuSheet")) renderSettings(); };
  if (!native && window.speechSynthesis) speechSynthesis.onvoiceschanged = window.voicesChanged;

  // search
  $("searchBtn").onclick = () => {
    show("searchSheet");
    $("searchInput").placeholder = `Search in ${LANGS[state.lang].native}`;
    setTimeout(() => $("searchInput").focus(), 250);
  };
  let searchRun = 0;
  $("searchForm").onsubmit = async (e) => {
    e.preventDefault();
    const q = $("searchInput").value.trim();
    $("searchInput").blur();
    if (q.length < 2) return;
    const run = ++searchRun;
    const lang = state.lang;
    const needle = q.toLowerCase();
    const results = [];
    let total = 0;
    $("searchResults").innerHTML = "";
    for (let b = 0; b < 66; b++) {
      if (run !== searchRun) return;
      $("searchResults").lang = lang;
      $("searchStatus").textContent = `Searching ${bookName(b, lang)}…`;
      const book = await getBook(lang, b);
      book.forEach((ch, ci) => ch.forEach(([label, text], vi) => {
        if (text.toLowerCase().includes(needle)) {
          total++;
          if (results.length < 400) results.push({ b, c: ci + 1, vi, label, text });
        }
      }));
      if (b % 6 === 5) await new Promise((r) => setTimeout(r, 0));
    }
    if (run !== searchRun) return;
    $("searchStatus").textContent = total ? `${total} verse${total === 1 ? "" : "s"} found${total > results.length ? ` · showing first ${results.length}` : ""}` : "No verses found";
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    $("searchResults").innerHTML = results.map((r, k) =>
      `<button class="result" data-k="${k}"><div class="rr">${esc(bookName(r.b, lang))} ${r.c}:${esc(r.label)}</div>` +
      `<div class="rt">${esc(r.text).replace(re, (m) => `<mark>${m}</mark>`)}</div></button>`).join("");
    $("searchResults").onclick = async (ev) => {
      const btn = ev.target.closest(".result");
      if (!btn) return;
      const r = results[+btn.dataset.k];
      hideSheet();
      await go(r.b, r.c);
      const v = $("v" + r.vi);
      if (v) {
        v.scrollIntoView({ block: "center" });
        v.classList.add("flash");
        setTimeout(() => v.classList.remove("flash"), 1700);
      }
    };
  };


  // ------------------------------------------------------------ highlights & notes
  document.querySelectorAll("#selBar .dot").forEach((d) => (d.onclick = () => {
    const color = d.dataset.color;
    for (const i of selectedIdx()) {
      const k = mkey(state.book, state.chap, state.verses[i][0]);
      const m = { ...(marks[k] || {}) };
      if (color) { m.color = color; m.t = Date.now(); } else delete m.color;
      if (!m.color && !m.note) delete marks[k]; else marks[k] = m;
      const el = $("v" + i);
      el.classList.remove("hl-y", "hl-g", "hl-b", "hl-p");
      if (color) el.classList.add("hl-" + color);
    }
    saveMarks();
    toast(color ? "Highlighted" : "Highlight removed");
    clearSelection();
  }));

  let noteTarget = null;
  function openNote(idx) {
    const first = idx[0];
    const k = mkey(state.book, state.chap, state.verses[first][0]);
    noteTarget = { key: k, ref: refText(idx) };
    $("noteRef").textContent = refText(idx);
    $("noteVerse").textContent = idx.map((i) => state.verses[i][1]).join(" ");
    $("noteVerse").lang = state.lang;
    $("noteText").value = (marks[k] && marks[k].note) || "";
    $("noteDelete").hidden = !(marks[k] && marks[k].note);
    show("noteSheet");
    setTimeout(() => $("noteText").focus(), 250);
  }
  $("selNote").onclick = () => { const idx = selectedIdx(); clearSelection(); openNote(idx); };
  $("noteSave").onclick = () => {
    const t = $("noteText").value.trim();
    const k = noteTarget.key;
    const m = { ...(marks[k] || {}) };
    if (t) { m.note = t; m.noteRef = noteTarget.ref; m.t = Date.now(); } else { delete m.note; delete m.noteRef; }
    if (!m.color && !m.note) delete marks[k]; else marks[k] = m;
    saveMarks();
    hideSheet();
    render({ scroll: false });
    toast(t ? "Note saved" : "Note removed");
  };
  $("noteDelete").onclick = () => { $("noteText").value = ""; $("noteSave").click(); };

  // ------------------------------------------------------------ history
  function addHistory(b, c) {
    let h = store.get("history", []).filter((x) => !(x.b === b && x.c === c));
    h.unshift({ b, c, t: Date.now() });
    store.set("history", h.slice(0, 20));
  }
  function ago(t) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} hr ago`;
    const d = Math.round(h / 24);
    return d === 1 ? "yesterday" : `${d} days ago`;
  }

  // ------------------------------------------------------------ library (My verses + history)
  let libTab = "marks", libFilter = "all";
  $("libBtn").onclick = () => { show("libSheet"); renderLib(); };
  document.querySelectorAll("[data-lib]").forEach((t) => (t.onclick = () => { libTab = t.dataset.lib; renderLib(); }));
  document.querySelectorAll("#markFilter .chip").forEach((c) => (c.onclick = () => { libFilter = c.dataset.f; renderLib(); }));
  function parseKey(k) { const [b, c, ...l] = k.split(":"); return { b: +b, c: +c, label: l.join(":") }; }
  async function renderLib() {
    document.querySelectorAll("[data-lib]").forEach((t) => t.classList.toggle("on", t.dataset.lib === libTab));
    document.querySelectorAll("#markFilter .chip").forEach((c) => c.classList.toggle("on", c.dataset.f === libFilter));
    $("markFilter").hidden = libTab !== "marks";
    const list = $("libList");
    list.lang = state.lang;
    if (libTab === "history") {
      const h = store.get("history", []);
      list.innerHTML = h.length ? h.map((x, k) =>
        `<button class="result hist" data-k="${k}"><div class="rt">${esc(bookName(x.b))} ${x.c}</div><div class="when">${ago(x.t)}</div></button>`).join("")
        : `<div class="empty-note">Chapters you read will appear here.</div>`;
      list.onclick = (e) => {
        const btn = e.target.closest(".result"); if (!btn) return;
        const x = h[+btn.dataset.k]; hideSheet(); go(x.b, x.c);
      };
      return;
    }
    let items = Object.entries(marks).map(([k, m]) => ({ ...parseKey(k), ...m }))
      .filter((m) => libFilter === "all" || (libFilter === "hl" ? m.color : m.note))
      .sort((a, b) => (b.t || 0) - (a.t || 0));
    let html = "";
    const v = await todayVerse();
    if (v && libFilter === "all") {
      html += `<button class="result today" data-today="1"><div class="rr">Verse of the day · ${esc(v.ref)}</div><div class="rt">${esc(v.text)}</div></button>`;
    }
    if (!items.length) {
      html += `<div class="empty-note">${libFilter === "note" ? "No notes yet. Tap a verse, then “Note”." : "Tap any verse and pick a colour to highlight it. Your highlights and notes appear here."}</div>`;
    }
    for (const [k, m] of items.entries()) {
      const book = await getBook(state.lang, m.b);
      const verse = (book[m.c - 1] || []).find((x) => x[0] === m.label);
      html += `<button class="result mark" data-k="${k}"><div class="rr">${m.color ? `<span class="mdot ${m.color}"></span>` : ""}${esc(bookName(m.b))} ${m.c}:${esc(m.label)}</div>` +
        `<div class="rt">${esc(verse ? verse[1] : "")}</div>` + (m.note ? `<div class="rnote">✎ ${esc(m.note)}</div>` : "") + `</button>`;
    }
    list.innerHTML = html;
    list.onclick = async (e) => {
      const btn = e.target.closest(".result"); if (!btn) return;
      hideSheet();
      if (btn.dataset.today) { openVerse(v.b, v.c, v.v); return; }
      const m = items[+btn.dataset.k];
      await go(m.b, m.c);
      const i = state.verses.findIndex((x) => x[0] === m.label);
      flashVerse(i);
    };
  }
  function flashVerse(i) {
    const el = $("v" + i);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1700);
  }
  async function openVerse(b, c, vnum) {
    await go(b, c);
    flashVerse(state.verses.findIndex((x) => expand(x[0]).includes(String(vnum))));
  }
  window.openRef = (b, c, v) => { hideSheet(); openVerse(b - 1, c, v); };

  // ------------------------------------------------------------ verse of the day
  let VOTD = null;
  async function votdList() {
    if (VOTD) return VOTD;
    try {
      VOTD = native ? JSON.parse(window.Bible.loadText("votd.json")) : await (await fetch("votd.json")).json();
    } catch (_) { VOTD = []; }
    return VOTD;
  }
  const dayIndex = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
  async function todayVerse(lang = state.lang) {
    const list = await votdList();
    if (!list.length) return null;
    const [b1, c, v] = list[dayIndex() % list.length];
    const b = b1 - 1;
    const verse = ((await getBook(lang, b))[c - 1] || []).find((x) => expand(x[0]).includes(String(v)));
    if (!verse) return null;
    return { b, c, v, lang, text: verse[1], ref: `${bookName(b, lang)} ${c}:${verse[0]}` };
  }
  async function showVotd() {
    const v = await todayVerse();
    if (!v || !store.get("votdShow", true) || store.get("votdSeen", -1) === dayIndex()) { $("votd").hidden = true; return; }
    $("votdText").textContent = v.text;
    $("votd").lang = state.lang;
    $("votdRef").textContent = v.ref;
    $("votd").hidden = false;
    $("votdClose").onclick = () => { store.set("votdSeen", dayIndex()); $("votd").hidden = true; };
    $("votdOpen").onclick = () => { store.set("votdSeen", dayIndex()); $("votd").hidden = true; openVerse(v.b, v.c, v.v); };
    $("votdListen").onclick = () => play([{ text: v.text, lang: v.lang }], { title: v.ref, chapter: false });
    $("votdImage").onclick = () => openImage(v.text, v.ref, v.lang);
  }

  // settings: daily notification
  function renderVotdSettings() {
    $("votdShow").checked = store.get("votdShow", true);
    $("votdNotify").checked = store.get("votdNotify", false);
    $("votdTime").value = store.get("votdTime", "07:00");
    $("votdTimeRow").hidden = !$("votdNotify").checked;
  }
  $("votdShow").onchange = (e) => { store.set("votdShow", e.target.checked); store.set("votdSeen", -1); showVotd(); };
  function scheduleDaily() {
    const on = store.get("votdNotify", false);
    const [h, m] = store.get("votdTime", "07:00").split(":").map(Number);
    if (native && window.Bible.setDailyVerse) window.Bible.setDailyVerse(on, h, m, state.lang, JSON.stringify(BOOKS[state.lang]));
  }
  $("votdNotify").onchange = (e) => {
    store.set("votdNotify", e.target.checked);
    $("votdTimeRow").hidden = !e.target.checked;
    if (e.target.checked && native && window.Bible.askNotifications) window.Bible.askNotifications();
    if (!native && e.target.checked) toast("Notifications work in the phone app");
    scheduleDaily();
    if (e.target.checked) toast(`You'll get a verse every morning at ${store.get("votdTime", "07:00")}`);
  };
  $("votdTime").onchange = (e) => { store.set("votdTime", e.target.value || "07:00"); scheduleDaily(); };
  window.notifyPermission = (granted) => {
    if (!granted) {
      store.set("votdNotify", false); $("votdNotify").checked = false; $("votdTimeRow").hidden = true;
      toast("Notifications are blocked for this app. Allow them in phone Settings to get the daily verse.", 4500);
      scheduleDaily();
    }
  };

  // ------------------------------------------------------------ share as image
  const IMG_STYLES = [
    { id: "wine", name: "Wine", bg: ["#7E2330", "#3E0D15"], ink: "#FBF3E2", accent: "#E2B769" },
    { id: "dawn", name: "Dawn", bg: ["#F9D776", "#F39A6E"], ink: "#3B1F14", accent: "#7A1F2B" },
    { id: "night", name: "Night", bg: ["#1B2440", "#0B0F1E"], ink: "#EEF1FA", accent: "#E2B769" },
    { id: "paper", name: "Paper", bg: ["#FBF8F2", "#EFE6D6"], ink: "#221C17", accent: "#7A1F2B" },
    { id: "olive", name: "Olive", bg: ["#4A5836", "#1F2718"], ink: "#F4F0E0", accent: "#D9C27A" }
  ];
  const FAMILY = { en: "Crimson Pro", ta: "Noto Serif Tamil", or: "Noto Serif Oriya" };
  let imgData = null;
  function openImage(text, ref, lang) {
    imgData = { text, ref, lang, style: store.get("imgStyle", "wine") };
    $("imgStyles").innerHTML = IMG_STYLES.map((st) =>
      `<button class="stylechip${st.id === imgData.style ? " on" : ""}" data-s="${st.id}" style="background:linear-gradient(135deg,${st.bg[0]},${st.bg[1]});color:${st.ink}">${st.name}</button>`).join("");
    show("imageSheet");
    drawImage();
  }
  $("imgStyles").onclick = (e) => {
    const b = e.target.closest(".stylechip"); if (!b) return;
    imgData.style = b.dataset.s; store.set("imgStyle", imgData.style);
    document.querySelectorAll(".stylechip").forEach((x) => x.classList.toggle("on", x === b));
    drawImage();
  };
  function wrapLines(ctx, text, maxW) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }
  async function drawImage() {
    const st = IMG_STYLES.find((x) => x.id === imgData.style) || IMG_STYLES[0];
    const cv = $("imgCanvas"), ctx = cv.getContext("2d");
    const W = cv.width, H = cv.height, pad = 110;
    const fam = FAMILY[imgData.lang] || FAMILY.en;
    try { await document.fonts.load(`400 60px "${fam}"`, imgData.text); await document.fonts.load(`600 40px "Crimson Pro"`); } catch (_) {}
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, st.bg[0]); g.addColorStop(1, st.bg[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // soft frame
    ctx.strokeStyle = st.accent; ctx.globalAlpha = 0.35; ctx.lineWidth = 3;
    ctx.strokeRect(46, 46, W - 92, H - 92); ctx.globalAlpha = 1;
    // quote mark
    ctx.fillStyle = st.accent; ctx.font = `600 170px "Crimson Pro", serif`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillText("“", W / 2, 250);
    // verse text, shrink until text + reference fit between the quote mark and the footer
    const areaTop = 290, areaBottom = H - 150, refBlock = 110;
    let size = imgData.lang === "en" ? 66 : 54, lines, lh;
    for (; size >= 24; size -= 2) {
      ctx.font = `400 ${size}px "${fam}", serif`;
      lines = wrapLines(ctx, imgData.text, W - pad * 2);
      lh = size * (imgData.lang === "en" ? 1.34 : 1.55);
      if (lines.length * lh + refBlock <= areaBottom - areaTop) break;
    }
    const blockH = lines.length * lh + refBlock;
    const top = areaTop + (areaBottom - areaTop - blockH) / 2 + lh / 2;
    ctx.fillStyle = st.ink; ctx.textBaseline = "middle";
    lines.forEach((l, k) => ctx.fillText(l, W / 2, top + k * lh));
    // reference
    const refY = top + (lines.length - 0.5) * lh + 36;
    ctx.fillStyle = st.accent; ctx.fillRect(W / 2 - 40, refY, 80, 3);
    ctx.font = `600 40px "${imgData.lang === "en" ? "Crimson Pro" : fam}", serif`;
    ctx.fillText(imgData.ref, W / 2, refY + 50);
    ctx.globalAlpha = 0.6; ctx.fillStyle = st.ink;
    ctx.font = `500 26px system-ui, sans-serif`;
    ctx.fillText(`Holy Bible · ${LANGS[imgData.lang].short}`, W / 2, H - 92);
    ctx.globalAlpha = 1;
  }
  function imageOut(save) {
    const url = $("imgCanvas").toDataURL("image/png");
    const name = "verse-" + imgData.ref.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) + ".png";
    if (native && window.Bible.shareImage) {
      window.Bible.shareImage(url.split(",")[1], name || "verse.png", !!save);
    } else {
      const a = document.createElement("a"); a.href = url; a.download = name || "verse.png"; a.click();
    }
  }
  $("imgShare").onclick = () => imageOut(false);
  $("imgSave").onclick = () => imageOut(true);
  $("selImage").onclick = () => {
    const idx = selectedIdx();
    const text = idx.map((i) => state.verses[i][1]).join(" ");
    const ref = refText(idx);
    clearSelection();
    openImage(text, ref, state.lang);
  };
  window.imageSaved = (ok) => toast(ok ? "Saved to your gallery (Pictures/Holy Bible)" : "Couldn't save the image");

  // ------------------------------------------------------------ sleep timer
  let sleepEnd = 0, sleepTick = 0, sleepTimerJs = 0;
  const SLEEP = [[0, "Off"], [10, "10 min"], [15, "15 min"], [30, "30 min"], [45, "45 min"], [60, "1 hour"], [-1, "End of chapter"]];
  $("sleepBtn").onclick = () => {
    const cur = state.sleepEOC ? -1 : sleepEnd ? "on" : 0;
    $("sleepList").innerHTML = SLEEP.map(([m, l]) => `<button class="chip${m === cur ? " on" : ""}" data-m="${m}">${l}</button>`).join("");
    show("sleepSheet");
  };
  $("sleepList").onclick = (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    const m = +b.dataset.m;
    hideSheet();
    if (m === -1) { setSleep(0); state.sleepEOC = true; $("sleepLabel").textContent = " end"; toast("Will stop at the end of this chapter"); }
    else { state.sleepEOC = false; setSleep(m); if (m) toast(`Reading will stop in ${m} minutes`); }
  };
  function setSleep(min) {
    clearInterval(sleepTick); clearTimeout(sleepTimerJs);
    sleepEnd = 0;
    if (native && window.Bible.sleepTimer) window.Bible.sleepTimer(min * 60000);
    $("sleepLabel").textContent = "";
    if (!min) return;
    sleepEnd = Date.now() + min * 60000;
    if (!native) sleepTimerJs = setTimeout(() => window.sleepFired(), min * 60000);
    const upd = () => { $("sleepLabel").textContent = " " + Math.max(1, Math.ceil((sleepEnd - Date.now()) / 60000)) + "m"; };
    upd(); sleepTick = setInterval(upd, 20000);
  }
  window.sleepFired = () => {
    sleepEnd = 0;
    if (state.player) { stopPlayer(); toast("Sleep timer: reading stopped. Good night 🌙", 3500); }
  };

  // ------------------------------------------------------------ navigation
  $("prevBtn").onclick = () => step(-1);
  $("nextBtn").onclick = () => step(1);

  let touch = null;
  $("reader").addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { touch = null; return; }
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  $("reader").addEventListener("touchend", (e) => {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
    const s = window.getSelection();
    if (Date.now() - touch.t < 600 && Math.abs(dx) > 80 && Math.abs(dy) < 50 && (!s || s.isCollapsed)) {
      step(dx < 0 ? 1 : -1);
    }
    touch = null;
  }, { passive: true });

  // Android back button: close things before leaving the app
  window.onBack = () => {
    if (openSheet) {
      if (openSheet === $("pickSheet") && !$("chapterPick").hidden) { $("backToBooks").click(); return true; }
      hideSheet(); return true;
    }
    if (state.sel.size) { clearSelection(); return true; }
    const s = window.getSelection();
    if (s && !s.isCollapsed) { s.removeAllRanges(); $("readSelection").hidden = true; return true; }
    return false;
  };

  let toastTimer = 0;
  function toast(msg, ms = 2200) {
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  // remember reading position
  let scrollTimer = 0;
  window.addEventListener("scroll", () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => store.set("scroll", window.scrollY), 300);
  }, { passive: true });

  // ------------------------------------------------------------ start
  applyLook();
  render({ scroll: false }).then(() => { window.scrollTo(0, store.get("scroll", 0)); showVotd(); });
  scheduleDaily();
})();
