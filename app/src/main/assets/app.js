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
      html += `<span class="verse" data-i="${i}" id="v${i}"><span class="n">${esc(label)}</span>${esc(text)}${par}</span>`;
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
      if (p.meta.chapter && state.autoNext) {
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
    renderLangs();
    render({ scroll: false });
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
  render({ scroll: false }).then(() => window.scrollTo(0, store.get("scroll", 0)));
})();
