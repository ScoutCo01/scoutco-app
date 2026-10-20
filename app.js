(function () {
  "use strict";

  var CONFIG = window.SCOUTCO_CONFIG || {};
  var KEY_CODE = "scoutco.code";
  var KEY_CACHE = "scoutco.program";
  var KEY_WEEK = "scoutco.week";
  var KEY_BLOCK = "scoutco.block";
  var KEY_OUTBOX = "scoutco.outbox";
  var KEY_COMMENTS = "scoutco.comments";
  var KEY_TICKS = "scoutco.ticks";
  var KEY_WEIGHTS = "scoutco.weights";
  var KEY_CHECKINS = "scoutco.checkins";
  var KEY_TODOS = "scoutco.todos";
  var KEY_INSTALL_DISMISSED = "scoutco.installDismissed";

  var COACH = String(CONFIG.coachName || "Kirst");

  var $ = function (id) { return document.getElementById(id); };
  function freshState() {
    return { code: null, data: null, block: null, week: null, openDays: {}, drafts: {}, weightDrafts: {}, info: {},
      view: "program", ci: null, liftPick: null, todoDraft: "", todoAll: false };
  }
  var state = freshState();

  // ---------- storage helpers (never let storage errors break the app) ----------
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }
  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function safeUrl(u) {
    u = String(u || "").trim();
    return /^https?:\/\//i.test(u) ? u : "";
  }
  function normaliseCode(c) { return String(c || "").trim().toUpperCase(); }

  // ---------- views ----------
  function show(view) {
    ["loginView", "programView", "loadingView"].forEach(function (id) {
      $(id).classList.toggle("hidden", id !== view);
    });
    $("menuBtn").classList.toggle("hidden", view !== "programView");
    closeMenu();
  }

  // ---------- fetching ----------
  function fetchProgram(code) {
    if (code === "DEMO" || !CONFIG.apiUrl) {
      if (code !== "DEMO") {
        return Promise.reject(new Error("The app isn't connected to the program sheet yet. Try the code DEMO."));
      }
      return Promise.resolve(demoData());
    }
    var url = CONFIG.apiUrl + (CONFIG.apiUrl.indexOf("?") === -1 ? "?" : "&") +
      "code=" + encodeURIComponent(code) + "&t=" + Date.now();
    return fetch(url, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw Object.assign(new Error("Couldn't reach the program sheet."), { network: true });
        return r.json();
      }, function () {
        throw Object.assign(new Error("You're offline."), { network: true });
      })
      .then(function (json) {
        if (json && json.error) throw new Error(json.error);
        return json;
      });
  }

  function signIn(code) {
    code = normaliseCode(code);
    if (!code) return;
    var btn = $("loginBtn");
    btn.disabled = true; btn.textContent = "Opening…";
    $("loginError").classList.add("hidden");
    fetchProgram(code).then(function (data) {
      state.code = code;
      save(KEY_CODE, code);
      setData(data, false);
    }).catch(function (err) {
      $("loginError").textContent = err.message || "Something went wrong. Please try again.";
      $("loginError").classList.remove("hidden");
    }).then(function () {
      btn.disabled = false; btn.textContent = "Open my program";
    });
  }

  function refresh(silent) {
    if (!state.code) return;
    if (!silent) show("loadingView");
    return fetchProgram(state.code).then(function (data) {
      setData(data, false);
    }).catch(function (err) {
      var cached = load(KEY_CACHE, null);
      if (err.network && cached && cached.code === state.code) {
        setData(cached.data, true);
      } else if (!err.network) {
        // Code no longer valid (e.g. coach turned the client off).
        signOut(err.message);
      } else {
        show("loginView");
        $("loginError").textContent = err.message;
        $("loginError").classList.remove("hidden");
      }
    });
  }

  function setData(data, offline) {
    state.data = data;
    mergeWeights(data && data.weights);
    mergeTicks(data && data.ticks);
    mergeCheckins(data && data.checkins);
    mergeTodos(data && data.todos);
    if (state.view !== "program" && !viewList().some(function (v) { return v[0] === state.view; })) state.view = "program";
    if (!offline) save(KEY_CACHE, { code: state.code, data: data });
    var blocks = getBlocks(data);
    // On a new day, go back to the current week (the coach's dates win over the last tab tapped).
    var today = todayDay().toDateString();
    if (state.openedOn !== today) { state.openedOn = today; state.manual = false; state.openDays = {}; }
    var now = state.manual ? null : currentByDate(blocks);
    if (now) {
      state.block = now.block; state.week = now.week;
    } else {
      state.block = pick(blocks, state.block, load(KEY_BLOCK, null));
      state.week = pick(currentWeeks(), state.week, load(KEY_WEEK, null));
    }
    $("offlineNotice").classList.toggle("hidden", !offline);
    render();
    show("programView");
    maybeShowInstall();
  }

  function signOut(message) {
    remove(KEY_CODE); remove(KEY_CACHE); remove(KEY_WEEK); remove(KEY_BLOCK); remove(KEY_OUTBOX); remove(KEY_TODOS);
    state = freshState();
    $("codeInput").value = "";
    $("loginError").textContent = message || "";
    $("loginError").classList.toggle("hidden", !message);
    show("loginView");
  }

  // ---------- sending ticks & comments to the coach's sheet ----------
  // Events wait in an outbox until the sheet confirms it saved them, so nothing is lost offline.
  var flushing = false;
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function canSend() { return CONFIG.apiUrl && state.code && state.code !== "DEMO"; }
  function queue(ev) {
    if (!canSend()) return null;
    ev.id = newId();
    var box = load(KEY_OUTBOX, []).filter(function (x) {
      return !((ev.type === "tick" || ev.type === "weight" || ev.type === "note" || ev.type === "checkin" || ev.type === "todo") && x.type === ev.type && x.key === ev.key); // only the latest value matters
    });
    box.push(ev);
    save(KEY_OUTBOX, box);
    flush();
    return ev.id;
  }
  function isPending(id) { return load(KEY_OUTBOX, []).some(function (x) { return x.id === id; }); }
  function flush() {
    if (flushing || !canSend()) return;
    var box = load(KEY_OUTBOX, []);
    if (!box.length) return;
    flushing = true;
    fetch(CONFIG.apiUrl, { method: "POST", body: JSON.stringify({ code: state.code, events: box }) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) {
          var saved = res.saved || [];
          save(KEY_OUTBOX, load(KEY_OUTBOX, []).filter(function (x) { return saved.indexOf(x.id) === -1; }));
          if (state.data) render();
        }
      })
      .catch(function () { /* try again later */ })
      .then(function () { flushing = false; });
  }
  window.addEventListener("online", flush);

  function commentsFor(dayKey) { return (load(KEY_COMMENTS, {})[state.code + "|" + dayKey]) || []; }
  function addComment(dayKey, entry) {
    var all = load(KEY_COMMENTS, {}), k = state.code + "|" + dayKey;
    (all[k] = all[k] || []).push(entry);
    save(KEY_COMMENTS, all);
  }

  // ---------- blocks & weeks ----------
  // Older sheets send program.weeks with no blocks; treat that as one unnamed block.
  function getBlocks(data) {
    var p = (data && data.program) || {};
    if (p.blocks) return p.blocks;
    return p.weeks ? [{ name: "", weeks: p.weeks }] : [];
  }
  function currentBlock() {
    var blocks = getBlocks(state.data);
    return blocks.filter(function (b) { return b.name === state.block; })[0] || blocks[0] || null;
  }
  function currentWeeks() { var b = currentBlock(); return b ? b.weeks : []; }
  function pick(list, current, saved) {
    var names = list.map(function (x) { return x.name; });
    if (names.indexOf(current) !== -1) return current;
    if (names.indexOf(saved) !== -1) return saved;
    return list.length ? list[0].name : null;
  }
  // ---------- dates ----------
  function parseDay(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function todayDay() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function shortDate(d) { return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }); }
  function weekStart(block, i) { var s = parseDay(block.start); return s ? addDays(s, 7 * i) : null; }

  // The block and week that today falls in, using block start dates. Null if no dates are set.
  function currentByDate(blocks) {
    var today = todayDay(), best = null;
    blocks.forEach(function (b) {
      var s = parseDay(b.start);
      if (s && s <= today && (!best || s >= parseDay(best.start))) best = b;
    });
    if (!best) {
      var upcoming = blocks.filter(function (b) { return parseDay(b.start); })
        .sort(function (a, b) { return parseDay(a.start) - parseDay(b.start); })[0];
      return upcoming && upcoming.weeks.length ? { block: upcoming.name, week: upcoming.weeks[0].name } : null;
    }
    if (!best.weeks.length) return null;
    var i = Math.floor((today - parseDay(best.start)) / 864e5 / 7);
    i = Math.max(0, Math.min(i, best.weeks.length - 1));
    return { block: best.name, week: best.weeks[i].name };
  }
  function isThisWeek(block, i) {
    var s = weekStart(block, i); if (!s) return false;
    var t = todayDay(); return t >= s && t < addDays(s, 7);
  }

  function scope(week, day) { return (state.block ? state.block + "|" : "") + week + "|" + day; }

  // ---------- ticks ----------
  function tickKey(week, day, idx) { return state.code + "|" + scope(week, day) + "|" + idx; }
  function getTicks() { return load(KEY_TICKS, {}); }
  function setTick(key, on) {
    var t = getTicks();
    if (on) t[key] = Date.now(); else delete t[key]; // the time it was ticked, for the progress screen
    save(KEY_TICKS, t);
  }
  // The sheet sends back every exercise this client has ticked (with the time), so progress
  // follows them to a new phone and older ticks get a date.
  function mergeTicks(server) {
    if (!server || !state.code) return;
    var t = getTicks(), changed = false, waiting = {};
    load(KEY_OUTBOX, []).forEach(function (x) { if (x.type === "tick") waiting[x.key] = true; });
    Object.keys(server).forEach(function (rest) {
      if (waiting[rest]) return;
      var k = state.code + "|" + rest, at = +server[rest] || 1;
      if (!t[k] || (t[k] === 1 && at > 1)) { t[k] = at; changed = true; }
    });
    if (changed) save(KEY_TICKS, t);
  }

  // A Clients row with Type "Coach" is the coach's own schedule: each row is a client,
  // the box under it holds session notes, and there's no "comments for your coach" box.
  function isCoach() {
    var c = (state.data && state.data.client) || {};
    return /\bcoach\b/i.test(String(c.type || ""));
  }

  // ---------- weights used ----------
  // Saved on the phone as { "<code>|<block>|<week>|<session>|<n>": { w: "40 kg", ex: "back squat", wk: "Week 2", at: ms } }
  function getWeights() { return load(KEY_WEIGHTS, {}); }
  function exName(s) { return String(s || "").trim().toLowerCase(); }
  function setWeight(key, w, ex, wk) {
    var all = getWeights();
    if (w) all[key] = { w: w, ex: exName(ex), wk: wk || "", at: Date.now() };
    else delete all[key];
    save(KEY_WEIGHTS, all);
  }
  // The sheet sends back everything this client has logged, so weights follow them to a new phone.
  function mergeWeights(server) {
    if (!server || !state.code) return;
    var all = getWeights(), changed = false;
    var waiting = {};
    load(KEY_OUTBOX, []).forEach(function (x) { if (x.type === "weight" || x.type === "note") waiting[x.key] = true; });
    Object.keys(server).forEach(function (rest) {
      var k = state.code + "|" + rest, sv = server[rest], mine = all[k];
      if (waiting[rest] || !sv) return; // not saved to the sheet yet: the phone's value is newer
      if (!mine || (sv.at || 0) >= (mine.at || 0)) {
        if (sv.w) all[k] = { w: String(sv.w), ex: exName(sv.ex), wk: sv.wk || "", at: sv.at || 0 };
        else delete all[k];
        changed = true;
      }
    });
    if (changed) save(KEY_WEIGHTS, all);
  }
  // The most recent weight logged for the same exercise in another session.
  function lastTime(key, name, weights) {
    var target = exName(name), prefix = state.code + "|", best = null;
    if (!target) return null;
    Object.keys(weights).forEach(function (k) {
      var v = weights[k];
      if (k === key || k.indexOf(prefix) !== 0 || !v || v.ex !== target || !v.w) return;
      if (!best || (v.at || 0) > (best.at || 0)) best = v;
    });
    return best;
  }

  // ---------- online clients ----------
  // Clients whose Type mentions "online" get the weekly check-in and the book-a-call button.
  function isOnline() {
    var c = (state.data && state.data.client) || {};
    return /online/i.test(String(c.type || ""));
  }
  function bookingUrl() { return safeUrl(((state.data && state.data.settings) || {}).bookingUrl); }

  // ---------- weeks on the calendar (Monday to Sunday) ----------
  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay() + 6) % 7)); }
  function isoDay(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function thisWeekOf() { return isoDay(mondayOf(new Date())); }

  // ---------- weekly pulse check ----------
  var SCORES = [
    { id: "sleep", name: "Sleep" },
    { id: "nutrition", name: "Nutrition" },
    { id: "energy", name: "Energy" },
    { id: "soreness", name: "Soreness", hint: "3 = not sore" },
    { id: "head", name: "Head noise", hint: "anxiety and stress, 3 = calm" }
  ];
  var SCORE_WORDS = { 1: "Bad", 2: "OK", 3: "Good" };
  // Saved on the phone as { "<code>|<week of yyyy-mm-dd>": { sleep: 1-3, ..., bw, note, reply, at } }
  function getCheckins() { return load(KEY_CHECKINS, {}); }
  function myCheckins() {
    var all = getCheckins(), prefix = state.code + "|", out = [];
    Object.keys(all).forEach(function (k) {
      if (k.indexOf(prefix) === 0) out.push(Object.assign({ week: k.slice(prefix.length) }, all[k]));
    });
    return out.sort(function (a, b) { return a.week < b.week ? 1 : -1; });
  }
  function checkinFor(week) { return getCheckins()[state.code + "|" + week] || null; }
  function mergeCheckins(server) {
    if (!server || !state.code) return;
    var all = getCheckins(), waiting = {};
    load(KEY_OUTBOX, []).forEach(function (x) { if (x.type === "checkin") waiting[x.key] = true; });
    server.forEach(function (c) {
      if (!c || !c.week) return;
      var k = state.code + "|" + c.week, mine = all[k];
      if (waiting[c.week]) { if (mine) mine.reply = c.reply || ""; return; } // keep their newer answers, but show Kirst's reply
      all[k] = { sleep: c.sleep, nutrition: c.nutrition, energy: c.energy, soreness: c.soreness, head: c.head,
        bw: c.bw || "", note: c.note || "", reply: c.reply || "", at: c.at || (mine && mine.at) || 0 };
    });
    save(KEY_CHECKINS, all);
  }
  // The latest reply Kirst typed on the Check-ins tab, if it's from the last 3 weeks.
  function latestReply() {
    var cutoff = isoDay(addDays(mondayOf(new Date()), -14));
    var withReply = myCheckins().filter(function (c) { return c.reply && c.week >= cutoff; });
    return withReply[0] || null;
  }
  function weekLabel(week) { var d = parseDay(week); return d ? "week of " + shortDate(d) : week; }

  // ---------- coach to-do list ----------
  // The list lives on the To-do tab of the sheet. Kirst can add and tick tasks there or here.
  // Saved on the phone as { code, list: [{ id, text, done, at, doneAt }] } in the sheet's order.
  function getTodos() { var t = load(KEY_TODOS, null); return t && t.code === state.code ? t.list : []; }
  function saveTodos(list) { save(KEY_TODOS, { code: state.code, list: list }); }
  function applyTodo(list, ev) {
    var i = -1;
    list.forEach(function (t, n) { if (t.id === ev.key) i = n; });
    if (ev.del) { if (i >= 0) list.splice(i, 1); return; }
    if (i >= 0) {
      if (list[i].done !== !!ev.done) { list[i].done = !!ev.done; list[i].doneAt = ev.done ? ev.at || Date.now() : 0; }
    } else if (ev.text) {
      list.push({ id: ev.key, text: ev.text, done: !!ev.done, at: ev.added || 0, doneAt: ev.done ? ev.at || 0 : 0 });
    }
  }
  // The sheet's list wins, except for changes made here that haven't reached the sheet yet.
  function mergeTodos(server) {
    if (!Array.isArray(server) || !state.code) return; // older script: keep what's on the phone
    var list = server.filter(function (t) { return t && t.id && t.text; }).map(function (t) {
      return { id: String(t.id), text: String(t.text), done: !!t.done, at: +t.at || 0, doneAt: +t.doneAt || 0 };
    });
    load(KEY_OUTBOX, []).forEach(function (x) { if (x.type === "todo") applyTodo(list, x); });
    saveTodos(list);
  }
  function changeTodo(ev) {
    ev.type = "todo";
    ev.at = Date.now();
    var list = getTodos();
    applyTodo(list, ev);
    saveTodos(list);
    queue(ev);
    render();
  }
  function addTodo(text) {
    text = String(text || "").trim().slice(0, 300);
    if (!text) return;
    var now = Date.now();
    changeTodo({ key: "t" + newId(), text: text, done: false, added: now });
  }
  function todoById(id) { return getTodos().filter(function (t) { return t.id === id; })[0]; }

  function renderTodo() {
    var list = getTodos();
    var open = list.filter(function (t) { return !t.done; });
    var done = list.filter(function (t) { return t.done; }).sort(function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); });
    var shown = state.todoAll ? done : done.slice(0, 10);
    var waiting = {};
    load(KEY_OUTBOX, []).forEach(function (x) { if (x.type === "todo") waiting[x.key] = true; });
    var item = function (t) {
      return '<li class="todo-item' + (t.done ? " done" : "") + '">' +
        '<button class="check" data-todo-tick="' + esc(t.id) + '" aria-pressed="' + t.done + '" aria-label="' + (t.done ? "Untick " : "Tick off ") + esc(t.text) + '">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0b1a14" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>' +
        "</button>" +
        '<div class="todo-text"><span>' + esc(t.text) + "</span>" +
          (t.done && t.doneAt ? '<small>Done ' + esc(new Date(t.doneAt).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })) + "</small>" : "") +
          (waiting[t.id] && canSend() ? "<small>Saving…</small>" : "") +
        "</div>" +
        '<button class="todo-del" data-todo-del="' + esc(t.id) + '" aria-label="Delete ' + esc(t.text) + '">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        "</button></li>";
    };
    $("todoPane").innerHTML =
      '<section class="card todo">' +
        "<h2>To-do</h2>" +
        '<form class="todo-add" data-todo-form autocomplete="off">' +
          '<label for="todo-new" class="sr-only">New task</label>' +
          '<input id="todo-new" class="ci-input" data-todo-new="1" type="text" maxlength="300" enterkeyhint="done" placeholder="e.g. Send Lauren invoice" value="' + esc(state.todoDraft) + '">' +
          '<button class="btn primary" type="submit">Add</button>' +
        "</form>" +
        (open.length ? '<ul class="todo-list">' + open.map(item).join("") + "</ul>" :
          '<p class="muted todo-empty">' + (list.length ? "All done. Nice work!" : "Nothing on your list yet.") + "</p>") +
        '<p class="muted small">You can also type tasks on the To-do tab of your sheet. They show here next time the app opens.</p>' +
      "</section>" +
      (done.length ? '<h3 class="section-title">Done (' + done.length + ")</h3>" +
        '<section class="card todo"><ul class="todo-list">' + shown.map(item).join("") + "</ul>" +
        (done.length > shown.length || state.todoAll && done.length > 10 ?
          '<button class="btn small ghost" data-todo-all>' + (state.todoAll ? "Show fewer" : "Show all " + done.length) + "</button>" : "") +
        "</section>" : "");
  }

  function viewList() {
    var v;
    if (isCoach()) v = [["program", "Schedule"], ["todo", "To-do"]];
    else {
      v = [["program", "Program"]];
      if (isOnline()) v.push(["checkin", "Check-in"]);
      v.push(["progress", "Progress"]);
    }
    if (siteLinks().length) v.push(["site", "ScoutCo HQ"]);
    return v;
  }
  function renderViewTabs() {
    var views = viewList();
    if (!views.some(function (v) { return v[0] === state.view; })) state.view = "program";
    var due = isOnline() && !checkinFor(thisWeekOf());
    var openTodos = isCoach() ? getTodos().filter(function (t) { return !t.done; }).length : 0;
    $("viewTabs").classList.toggle("hidden", views.length < 2);
    $("viewTabs").innerHTML = views.map(function (v) {
      return '<button class="view-tab" role="tab" data-view="' + v[0] + '" aria-selected="' + (v[0] === state.view) + '">' +
        esc(v[1]) + (v[0] === "checkin" && due ? '<span class="dot" aria-label="due"></span>' : "") +
        (v[0] === "todo" && openTodos ? '<span class="count" aria-label="' + openTodos + ' to do">' + openTodos + "</span>" : "") + "</button>";
    }).join("");
    $("programPane").classList.toggle("hidden", state.view !== "program");
    $("checkinPane").classList.toggle("hidden", state.view !== "checkin");
    $("progressPane").classList.toggle("hidden", state.view !== "progress");
    $("todoPane").classList.toggle("hidden", state.view !== "todo");
    $("sitePane").classList.toggle("hidden", state.view !== "site");
  }

  // Links to the ScoutCo website, set in config.js (websiteLinks).
  function siteLinks() {
    var list = (window.SCOUTCO_CONFIG || {}).websiteLinks || [];
    return list.filter(function (l) { return l && l.label && /^https?:\/\//.test(String(l.url || "")); });
  }
  function renderSite() {
    $("sitePane").innerHTML = '<ul class="site-links">' + siteLinks().map(function (l) {
      return '<li><a class="site-link" href="' + esc(l.url) + '" target="_blank" rel="noopener">' +
        "<span>" + esc(l.label) + "</span>" +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>' +
        "</a></li>";
    }).join("") + "</ul>" +
      '<p class="muted small">Opens the ScoutCo website in your browser.</p>';
  }

  function renderReplyNote() {
    var el = $("replyNote");
    var r = isOnline() ? latestReply() : null;
    if (!r) { el.classList.add("hidden"); return; }
    el.innerHTML = "<strong>Reply from " + esc(COACH) + "</strong>" + esc(r.reply) +
      '<div class="small muted reply-week">On your check-in for the ' + esc(weekLabel(r.week)) + "</div>";
    el.classList.remove("hidden");
  }

  // "Book a check-in call" shows in the second-last week of the block they're in today
  // (week 3 of a 4-week block), once a booking link is on the Settings tab.
  function renderBookCall(blocks) {
    var el = $("bookCall"), url = bookingUrl(), show = false;
    if (isOnline() && url) {
      var now = currentByDate(blocks);
      var b = now && blocks.filter(function (x) { return x.name === now.block; })[0];
      if (b && b.weeks.length >= 2) {
        var wi = b.weeks.length - 2;
        show = b.weeks[wi].name === now.week && isThisWeek(b, wi);
      }
    }
    el.classList.toggle("hidden", !show);
    if (!show) return;
    el.innerHTML = "<div><strong>Time for your check-in call</strong>" +
      "<div>Your block finishes next week. Book a call with " + esc(COACH) + " to go over how it went and plan what's next.</div></div>" +
      '<a class="btn primary" href="' + esc(url) + '" target="_blank" rel="noopener">Book a check-in call</a>';
  }

  function renderCheckin() {
    var week = thisWeekOf();
    var saved = checkinFor(week);
    if (!state.ci || state.ci.week !== week) {
      state.ci = Object.assign({ week: week }, saved || {});
      state.ci.error = "";
    }
    var d = state.ci;
    var pending = load(KEY_OUTBOX, []).some(function (x) { return x.type === "checkin" && x.key === week; });
    var rows = SCORES.map(function (sc) {
      return '<div class="ci-row"><div class="ci-name">' + esc(sc.name) +
        (sc.hint ? '<small>' + esc(sc.hint) + "</small>" : "") + '</div><div class="ci-scale" role="radiogroup" aria-label="' + esc(sc.name) + '">' +
        [1, 2, 3].map(function (n) {
          return '<button type="button" class="ci-btn s' + n + '" role="radio" data-score="' + sc.id + '" data-val="' + n +
            '" aria-checked="' + (+d[sc.id] === n) + '"><b>' + n + "</b>" + SCORE_WORDS[n] + "</button>";
        }).join("") + "</div></div>";
    }).join("");
    var status = saved ? (pending ? "Sending…" : "Sent ✓ " + new Date(saved.at || Date.now()).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })) : "";
    var history = myCheckins().filter(function (c) { return c.week !== week; }).slice(0, 8);

    $("checkinPane").innerHTML =
      '<section class="card ci">' +
        '<h2>Weekly pulse check</h2>' +
        '<p class="muted small">This ' + esc(weekLabel(week)) + '. Tap 1 for bad, 2 for OK or 3 for good. ' + esc(COACH) + " reads every one.</p>" +
        rows +
        '<label class="ci-label" for="ci-bw">Bodyweight <span class="muted">(optional)</span></label>' +
        '<input id="ci-bw" class="ci-input" data-ci="bw" type="text" inputmode="decimal" maxlength="20" autocomplete="off" placeholder="e.g. 72.5 kg" value="' + esc(d.bw || "") + '">' +
        '<label class="ci-label" for="ci-note">Note for ' + esc(COACH) + "</label>" +
        '<textarea id="ci-note" class="ci-input" data-ci="note" rows="3" maxlength="2000" placeholder="Anything ' + esc(COACH) + ' should know this week?">' + esc(d.note || "") + "</textarea>" +
        (d.error ? '<p class="error">' + esc(d.error) + "</p>" : "") +
        '<div class="ci-actions"><span class="small muted">' + esc(status) + "</span>" +
          '<button class="btn primary" data-ci-send>' + (saved ? "Update check-in" : "Send check-in") + "</button></div>" +
        (saved && saved.reply ? '<div class="coach-note"><strong>Reply from ' + esc(COACH) + "</strong>" + esc(saved.reply) + "</div>" : "") +
      "</section>" +
      (history.length ? '<h3 class="section-title">Earlier check-ins</h3>' + history.map(historyHtml).join("") : "");
  }

  function historyHtml(c) {
    return '<div class="card ci-past"><div class="ci-past-head">' + esc(weekLabel(c.week).replace(/^w/, "W")) + "</div>" +
      '<div class="ci-pills">' + SCORES.map(function (sc) {
        var v = +c[sc.id];
        return '<span class="pill s' + (v || 0) + '">' + esc(sc.name) + " " + (v || "–") + "</span>";
      }).join("") + (c.bw ? '<span class="pill">' + esc(c.bw) + "</span>" : "") + "</div>" +
      (c.note ? '<div class="ci-past-note">' + esc(c.note) + "</div>" : "") +
      (c.reply ? '<div class="coach-note"><strong>Reply from ' + esc(COACH) + "</strong>" + esc(c.reply) + "</div>" : "") +
    "</div>";
  }

  function sendCheckin() {
    var d = state.ci;
    var missing = SCORES.filter(function (sc) { return !(+d[sc.id] >= 1 && +d[sc.id] <= 3); });
    if (missing.length) {
      d.error = "Please pick a number for " + missing.map(function (m) { return m.name; }).join(", ") + ".";
      render();
      return;
    }
    d.error = "";
    var all = getCheckins(), k = state.code + "|" + d.week, old = all[k] || {};
    var entry = { bw: String(d.bw || "").trim().slice(0, 20), note: String(d.note || "").trim().slice(0, 2000), reply: old.reply || "", at: Date.now() };
    SCORES.forEach(function (sc) { entry[sc.id] = +d[sc.id]; });
    all[k] = entry;
    save(KEY_CHECKINS, all);
    var ev = { type: "checkin", key: d.week, weekOf: d.week, bw: entry.bw, note: entry.note };
    SCORES.forEach(function (sc) { ev[sc.id] = entry[sc.id]; });
    queue(ev);
    state.ci = null;
    render();
  }

  // ---------- progress screen ----------
  function blockScope(bName, week, day) { return (bName ? bName + "|" : "") + week + "|" + day; }
  function numberIn(s) { var m = /(\d+(?:\.\d+)?)/.exec(String(s || "").replace(",", ".")); return m ? parseFloat(m[1]) : null; }
  function unitIn(s) { var m = /\d\s*(kg|lb|lbs|s|sec|m|km|min)\b/i.exec(String(s || "")); return m ? m[1].toLowerCase() : ""; }
  function titleCase(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }

  // Each session with at least one exercise ticked, with the time of its first tick.
  function trainedSessions() {
    var t = getTicks(), prefix = state.code + "|", out = {};
    Object.keys(t).forEach(function (k) {
      if (k.indexOf(prefix) !== 0 || !t[k]) return;
      var session = k.slice(prefix.length).replace(/\|[^|]*$/, "");
      var at = t[k] > 1 ? t[k] : 0;
      if (!(session in out) || (at && (!out[session] || at < out[session]))) out[session] = at;
    });
    return out;
  }

  function renderProgress(blocks) {
    var trained = trainedSessions();
    var DAY = 864e5, thisMon = mondayOf(new Date());

    // Sessions per calendar week, for the streak and the bar chart.
    var perWeek = {};
    Object.keys(trained).forEach(function (s) {
      if (!trained[s]) return;
      var wk = isoDay(mondayOf(new Date(trained[s])));
      perWeek[wk] = (perWeek[wk] || 0) + 1;
    });
    var streak = 0, start = perWeek[isoDay(thisMon)] ? 0 : 1; // this week only breaks the streak once it's over
    for (var i = start; perWeek[isoDay(addDays(thisMon, -7 * i))]; i++) streak++;
    var thisWeek = perWeek[isoDay(thisMon)] || 0;

    // Sessions trained in the block they're on.
    var now = currentByDate(blocks);
    var bName = now ? now.block : state.block;
    var blk = blocks.filter(function (b) { return b.name === bName; })[0] || blocks[0];
    var total = 0, doneInBlock = 0;
    if (blk) blk.weeks.forEach(function (w) {
      w.days.forEach(function (d) { total++; if (blockScope(blk.name, w.name, d.name) in trained) doneInBlock++; });
    });

    var weeks8 = [];
    for (var j = 7; j >= 0; j--) {
      var m = addDays(thisMon, -7 * j);
      weeks8.push({ label: j === 0 ? "Now" : m.getDate() + "/" + (m.getMonth() + 1), value: perWeek[isoDay(m)] || 0 });
    }

    // Weights: one line per exercise.
    var lifts = {}, weights = getWeights(), prefix = state.code + "|";
    Object.keys(weights).forEach(function (k) {
      var v = weights[k];
      if (k.indexOf(prefix) !== 0 || !v || !v.w || !v.ex) return;
      var n = numberIn(v.w);
      if (n == null) return;
      (lifts[v.ex] = lifts[v.ex] || []).push({ x: v.at || 0, y: n, text: v.w, wk: v.wk });
    });
    var liftNames = Object.keys(lifts).sort(function (a, b) { return lifts[b].length - lifts[a].length || a.localeCompare(b); });
    if (liftNames.indexOf(state.liftPick) === -1) state.liftPick = liftNames[0] || null;
    var liftHtml;
    if (!liftNames.length) {
      liftHtml = '<p class="muted small">Type the weight you use in the "Weight used" box under each exercise, and your lifts will chart here.</p>';
    } else {
      var pts = lifts[state.liftPick].filter(function (p) { return p.x; }).sort(function (a, b) { return a.x - b.x; });
      var best = lifts[state.liftPick].reduce(function (a, p) { return !a || p.y > a.y ? p : a; }, null);
      var latest = pts[pts.length - 1] || lifts[state.liftPick][0];
      liftHtml = '<select class="lift-pick" data-lift aria-label="Exercise">' + liftNames.map(function (n) {
          return '<option value="' + esc(n) + '"' + (n === state.liftPick ? " selected" : "") + ">" + esc(titleCase(n)) + "</option>";
        }).join("") + "</select>" +
        '<div class="stat-row"><div><b>' + esc(best.text) + '</b><span>Best</span></div><div><b>' + esc(latest.text) + "</b><span>Latest</span></div></div>" +
        (pts.length >= 2 ? lineChart(pts, unitIn(best.text)) : '<p class="muted small">Log this one again next time to see a chart.</p>');
    }

    var html =
      '<div class="tiles">' +
        '<div class="tile"><b>' + streak + '</b><span>' + (streak === 1 ? "week" : "weeks") + " in a row</span></div>" +
        '<div class="tile"><b>' + doneInBlock + "<small>/" + total + '</small></b><span>sessions this block</span></div>' +
        '<div class="tile"><b>' + thisWeek + '</b><span>' + (thisWeek === 1 ? "session" : "sessions") + " this week</span></div>" +
      "</div>" +
      (streak ? '<p class="streak-line">🔥 ' + streak + "-week streak. Train this week to keep it going.</p>" :
        '<p class="streak-line muted">Tick off a session this week to start a streak.</p>') +
      '<section class="card"><h3>Sessions per week</h3>' + barChart(weeks8) + "</section>" +
      '<section class="card"><h3>Your lifts</h3>' + liftHtml + "</section>";

    if (isOnline()) {
      var cis = myCheckins().slice(0, 8).reverse();
      var bw = cis.map(function (c) { var d = parseDay(c.week); return { x: d ? d.getTime() : 0, y: numberIn(c.bw), text: c.bw }; })
        .filter(function (p) { return p.x && p.y != null; });
      if (cis.length) {
        html += '<section class="card"><h3>Weekly pulse check</h3>' +
          '<table class="pulse"><tr><th></th>' + cis.map(function (c) {
            var d = parseDay(c.week); return "<th>" + esc(d ? shortDate(d) : c.week) + "</th>";
          }).join("") + "</tr>" +
          SCORES.map(function (sc) {
            return "<tr><td>" + esc(sc.name) + "</td>" + cis.map(function (c) {
              var v = +c[sc.id]; return '<td><span class="cell s' + (v || 0) + '">' + (v || "") + "</span></td>";
            }).join("") + "</tr>";
          }).join("") + "</table>" +
          '<p class="muted small">1 = bad, 2 = OK, 3 = good</p></section>';
      }
      if (bw.length >= 2) html += '<section class="card"><h3>Bodyweight</h3>' + lineChart(bw, unitIn(bw[bw.length - 1].text)) + "</section>";
    }
    $("progressPane").innerHTML = html;
  }

  // Simple line chart as SVG. pts: [{ x: time, y: number }]
  function lineChart(pts, unit) {
    var W = 320, H = 150, L = 42, R = 10, T = 12, B = 24;
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (y0 === y1) { y0 -= 1; y1 += 1; }
    var pad = (y1 - y0) * 0.15; y0 = Math.max(0, y0 - pad); y1 += pad;
    var px = function (x) { return L + (x1 === x0 ? (W - L - R) / 2 : (x - x0) / (x1 - x0) * (W - L - R)); };
    var py = function (y) { return T + (1 - (y - y0) / (y1 - y0)) * (H - T - B); };
    var fmt = function (n) { return String(Math.round(n * 10) / 10); };
    var line = pts.map(function (p) { return px(p.x).toFixed(1) + "," + py(p.y).toFixed(1); }).join(" ");
    return (unit ? '<div class="chart-unit">' + esc(unit) + "</div>" : "") +
      '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Chart">' +
      [y0, (y0 + y1) / 2, y1].map(function (v) {
        return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + py(v).toFixed(1) + '" y2="' + py(v).toFixed(1) + '" class="grid"/>' +
          '<text x="' + (L - 6) + '" y="' + (py(v) + 4).toFixed(1) + '" text-anchor="end">' + esc(fmt(v)) + "</text>";
      }).join("") +
      '<polyline points="' + line + '" class="line"/>' +
      pts.map(function (p) { return '<circle cx="' + px(p.x).toFixed(1) + '" cy="' + py(p.y).toFixed(1) + '" r="3.5" class="dotp"/>'; }).join("") +
      '<text x="' + L + '" y="' + (H - 6) + '">' + esc(shortDate(new Date(x0))) + "</text>" +
      (x1 !== x0 ? '<text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end">' + esc(shortDate(new Date(x1))) + "</text>" : "") +
    "</svg>";
  }

  function barChart(bars) {
    var W = 320, H = 130, T = 14, B = 22, gap = 8;
    var max = Math.max(3, Math.max.apply(null, bars.map(function (b) { return b.value; })));
    var bw = (W - gap * (bars.length - 1)) / bars.length;
    return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Sessions per week">' +
      bars.map(function (b, i) {
        var h = b.value / max * (H - T - B), x = i * (bw + gap), y = H - B - h;
        return (b.value ? '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="4" class="bar' + (i === bars.length - 1 ? " now" : "") + '"/>' +
            '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 4).toFixed(1) + '" text-anchor="middle">' + b.value + "</text>" :
            '<rect x="' + x.toFixed(1) + '" y="' + (H - B - 2) + '" width="' + bw.toFixed(1) + '" height="2" class="bar empty"/>') +
          '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" class="xl">' + esc(b.label) + "</text>";
      }).join("") +
    "</svg>";
  }

  // ---------- rendering ----------
  function render() {
    // Keep the cursor in a comment box if the screen redraws while someone is typing.
    var active = document.activeElement;
    var attr = active && active.getAttribute && (active.getAttribute("data-comment") != null ? "data-comment" :
      active.getAttribute("data-weight") != null ? "data-weight" :
      active.getAttribute("data-ci") != null ? "data-ci" :
      active.getAttribute("data-todo-new") != null ? "data-todo-new" : null);
    var typing = attr ? active.getAttribute(attr) : null;
    var caret = typing ? [active.selectionStart, active.selectionEnd] : null;
    renderAll();
    if (typing) {
      var again = document.querySelector("[" + attr + '="' + CSS.escape(typing) + '"]');
      if (again) { again.focus(); try { again.setSelectionRange(caret[0], caret[1]); } catch (e) { /* ignore */ } }
    }
  }

  function renderAll() {
    var data = state.data || {};
    var client = data.client || {};
    var blocks = getBlocks(data);
    var weeks = currentWeeks();

    $("helloName").textContent = client.name ? "Hi " + String(client.name).split(" ")[0] : "Your program";
    $("updatedAt").textContent = data.updated
      ? "Updated " + new Date(data.updated).toLocaleString("en-AU", { weekday: "short", hour: "numeric", minute: "2-digit" })
      : "";

    var sessions = $("sessionsCard");
    var sType = String(client.type || "").trim();
    var sText = String(client.sessions || "").trim();
    if (sType || sText) {
      sessions.innerHTML =
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>' +
        "<div><strong>Your sessions</strong>" +
        (sType ? '<span class="type-badge">' + esc(sType) + "</span>" : "") +
        (sText ? '<div class="sessions-text">' + esc(sText) + "</div>" : "") + "</div>";
      sessions.classList.remove("hidden");
    } else {
      sessions.classList.add("hidden");
    }

    renderViewTabs();
    renderReplyNote();
    renderBookCall(blocks);
    if (state.view === "checkin") renderCheckin();
    if (state.view === "progress") renderProgress(blocks);
    if (state.view === "todo") renderTodo();
    if (state.view === "site") renderSite();

    var note = $("coachNote");
    if (client.message) {
      note.innerHTML = "<strong>From " + esc(COACH) + "</strong>" + esc(client.message);
      note.classList.remove("hidden");
    } else {
      note.classList.add("hidden");
    }

    $("emptyState").classList.toggle("hidden", weeks.length > 0);

    var bTabs = $("blockTabs");
    bTabs.classList.toggle("hidden", blocks.length < 2);
    bTabs.innerHTML = '<span class="tabs-label">Block</span>' + blocks.map(function (b) {
      return '<button class="week-tab" role="tab" aria-selected="' + (b.name === state.block) + '" data-block="' +
        esc(b.name) + '">' + esc(b.name || "Program") +
        (parseDay(b.start) ? '<small>from ' + esc(shortDate(parseDay(b.start))) + "</small>" : "") + "</button>";
    }).join("");

    var tabs = $("weekTabs");
    tabs.classList.toggle("hidden", weeks.length < 2);
    tabs.innerHTML = '<span class="tabs-label">Week</span>' + weeks.map(function (w, wi) {
      var blk = currentBlock() || {};
      var ws = weekStart(blk, wi);
      var now = isThisWeek(blk, wi);
      return '<button class="week-tab' + (now ? " this-week" : "") + '" role="tab" aria-selected="' + (w.name === state.week) + '" data-week="' +
        esc(w.name) + '">' + esc(w.name) + (ws ? "<small>" + (now ? "This week" : esc(shortDate(ws))) + "</small>" : "") + "</button>";
    }).join("");

    var week = weeks.filter(function (w) { return w.name === state.week; })[0];
    var ticks = getTicks();
    var weights = getWeights();
    $("days").innerHTML = !week ? "" : week.days.map(function (day, di) {
      var done = 0;
      var dayKey = scope(week.name, day.name);
      var where = { block: state.block || "", week: week.name, session: day.name };
      state.info[dayKey] = where;
      var items = day.exercises.map(function (ex, i) {
        var k = tickKey(week.name, day.name, i);
        state.info[k] = { block: where.block, week: where.week, session: where.session,
          exercise: (ex.label ? ex.label + " " : "") + ex.name, name: ex.name, key: k.slice(state.code.length + 1) };
        var isDone = !!ticks[k];
        if (isDone) done++;
        return exerciseHtml(ex, k, isDone, weights);
      }).join("");
      var total = day.exercises.length;
      var open = state.openDays[dayKey] !== undefined ? state.openDays[dayKey] : (di === firstUnfinished(week, ticks));
      return '<article class="day' + (open ? " open" : "") + '" data-day="' + esc(dayKey) + '">' +
        '<button class="day-head" aria-expanded="' + open + '">' +
          '<div><div class="day-title">' + esc(day.name) + '</div>' +
          '<div class="day-meta">' + total + (isCoach() ? " client" : " exercise") + (total === 1 ? "" : "s") + "</div></div>" +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<span class="day-progress' + (done === total && total ? " complete" : "") + '">' +
              (done === total && total ? "Done ✓" : done + "/" + total) + "</span>" +
            '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' +
          "</div>" +
        "</button>" +
        '<div class="day-body">' + items +
          (done ? '<div class="day-foot"><button class="btn small ghost" data-clear="' + esc(dayKey) + '">Clear ticks</button></div>' : "") +
          (isCoach() ? "" : commentHtml(dayKey)) +
        "</div>" +
      "</article>";
    }).join("");
  }

  function commentHtml(dayKey) {
    var sent = commentsFor(dayKey).map(function (c) {
      var status = isPending(c.id) ? "Sending…" : "Sent ✓";
      return '<div class="sent-comment"><div>' + esc(c.text) + '</div><div class="small muted">' +
        esc(new Date(c.at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })) +
        " · " + status + "</div></div>";
    }).join("");
    return '<div class="day-comment">' +
      '<label class="comment-label" for="c-' + esc(dayKey) + '">Comments for ' + esc(COACH) + '</label>' + sent +
      '<textarea id="c-' + esc(dayKey) + '" data-comment="' + esc(dayKey) + '" rows="3" maxlength="2000" ' +
        'placeholder="How did it feel? PBs, pain or questions…">' + esc(state.drafts[dayKey] || "") + "</textarea>" +
      '<div class="comment-actions"><button class="btn small primary" data-send="' + esc(dayKey) + '">Send</button></div>' +
    "</div>";
  }

  function firstUnfinished(week, ticks) {
    for (var d = 0; d < week.days.length; d++) {
      var day = week.days[d];
      for (var i = 0; i < day.exercises.length; i++) {
        if (!ticks[tickKey(week.name, day.name, i)]) return d;
      }
    }
    return -1;
  }

  function exerciseHtml(ex, key, isDone, weights) {
    var stats = [
      ["Sets", ex.sets], ["Reps", ex.reps], ["Load", ex.load], ["Tempo", ex.tempo], ["Rest", ex.rest]
    ].filter(function (s) { return s[1] !== "" && s[1] != null; })
      .map(function (s) { return '<span class="stat"><b>' + s[0] + "</b>" + esc(s[1]) + "</span>"; }).join("");
    var video = safeUrl(ex.video);
    return '<div class="ex' + (isDone ? " done" : "") + '">' +
      '<button class="check" data-tick="' + esc(key) + '" aria-pressed="' + isDone + '" aria-label="Mark ' + esc(ex.name) + ' done">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0b1a14" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>' +
      "</button>" +
      '<div class="ex-main">' +
        '<div class="ex-name">' + (ex.label ? '<span class="ex-label">' + esc(ex.label) + "</span>" : "") + esc(ex.name) + "</div>" +
        (stats ? '<div class="ex-stats">' + stats + "</div>" : "") +
        (ex.notes ? '<div class="ex-notes">' + esc(ex.notes) + "</div>" : "") +
        (video ? '<a class="ex-video" href="' + esc(video) + '" target="_blank" rel="noopener">▶ Watch demo</a>' : "") +
        weightHtml(ex, key, weights) +
      "</div>" +
    "</div>";
  }

  function weightHtml(ex, key, weights) {
    var saved = weights[key];
    var value = state.weightDrafts[key] != null ? state.weightDrafts[key] : (saved ? saved.w : "");
    var prev = lastTime(key, ex.name, weights);
    var id = "w-" + key;
    if (isCoach()) {
      return '<div class="ex-log coach-notes">' +
        '<label for="' + esc(id) + '">Session notes</label>' +
        '<textarea id="' + esc(id) + '" data-weight="' + esc(key) + '" rows="3" maxlength="2000" ' +
          'placeholder="How did the session go?">' + esc(value) + "</textarea>" +
        (prev ? '<div class="ex-last">Last session' + (prev.wk ? " (" + esc(prev.wk) + ")" : "") + ": " + esc(prev.w) + "</div>" : "") +
      "</div>";
    }
    return '<div class="ex-log">' +
      '<label for="' + esc(id) + '">Weight used</label>' +
      '<input id="' + esc(id) + '" data-weight="' + esc(key) + '" type="text" maxlength="40" autocomplete="off" ' +
        'enterkeyhint="done" placeholder="e.g. 40 kg" value="' + esc(value) + '">' +
      (prev ? '<span class="ex-last">Last time: <b>' + esc(prev.w) + "</b>" + (prev.wk ? " · " + esc(prev.wk) : "") + "</span>" : "") +
    "</div>";
  }

  // ---------- events ----------
  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    signIn($("codeInput").value);
  });

  $("blockTabs").addEventListener("click", function (e) {
    var b = e.target.closest("[data-block]");
    if (!b) return;
    if (b.getAttribute("data-block") === state.block) return;
    state.block = b.getAttribute("data-block");
    state.manual = true;
    save(KEY_BLOCK, state.block);
    var blk = currentBlock();
    var thisWeek = blk ? blk.weeks.filter(function (w, i) { return isThisWeek(blk, i); })[0] : null;
    state.week = thisWeek ? thisWeek.name : pick(currentWeeks(), null, null);
    save(KEY_WEEK, state.week);
    render();
  });

  $("weekTabs").addEventListener("click", function (e) {
    var b = e.target.closest("[data-week]");
    if (!b) return;
    state.week = b.getAttribute("data-week");
    state.manual = true;
    save(KEY_WEEK, state.week);
    render();
  });

  $("viewTabs").addEventListener("click", function (e) {
    var b = e.target.closest("[data-view]");
    if (!b) return;
    state.view = b.getAttribute("data-view");
    render();
    window.scrollTo(0, 0);
  });

  $("checkinPane").addEventListener("click", function (e) {
    var sc = e.target.closest("[data-score]");
    if (sc) {
      state.ci[sc.getAttribute("data-score")] = +sc.getAttribute("data-val");
      render();
      return;
    }
    if (e.target.closest("[data-ci-send]")) sendCheckin();
  });
  $("checkinPane").addEventListener("input", function (e) {
    var f = e.target.getAttribute && e.target.getAttribute("data-ci");
    if (f && state.ci) state.ci[f] = e.target.value;
  });
  $("todoPane").addEventListener("submit", function (e) {
    e.preventDefault();
    addTodo(state.todoDraft);
    state.todoDraft = "";
    render();
  });
  $("todoPane").addEventListener("input", function (e) {
    if (e.target.getAttribute && e.target.getAttribute("data-todo-new") != null) state.todoDraft = e.target.value;
  });
  $("todoPane").addEventListener("click", function (e) {
    var tick = e.target.closest("[data-todo-tick]");
    if (tick) {
      var t = todoById(tick.getAttribute("data-todo-tick"));
      if (t) changeTodo({ key: t.id, text: t.text, done: !t.done });
      return;
    }
    var del = e.target.closest("[data-todo-del]");
    if (del) {
      var d = todoById(del.getAttribute("data-todo-del"));
      if (d && window.confirm("Delete \"" + d.text + "\"?")) changeTodo({ key: d.id, text: d.text, del: true });
      return;
    }
    if (e.target.closest("[data-todo-all]")) { state.todoAll = !state.todoAll; render(); }
  });

  $("progressPane").addEventListener("change", function (e) {
    if (e.target.getAttribute && e.target.getAttribute("data-lift") != null) { state.liftPick = e.target.value; render(); }
  });

  $("days").addEventListener("click", function (e) {
    var tick = e.target.closest("[data-tick]");
    if (tick) {
      var k = tick.getAttribute("data-tick");
      var on = !getTicks()[k];
      setTick(k, on);
      sendTick(k, on);
      keepOpen(tick);
      render();
      return;
    }
    var clear = e.target.closest("[data-clear]");
    if (clear) {
      var prefix = state.code + "|" + clear.getAttribute("data-clear") + "|";
      var t = getTicks();
      Object.keys(t).forEach(function (key) { if (key.indexOf(prefix) === 0) { delete t[key]; sendTick(key, false); } });
      save(KEY_TICKS, t);
      keepOpen(clear);
      render();
      return;
    }
    var send = e.target.closest("[data-send]");
    if (send) {
      var dk = send.getAttribute("data-send");
      var box = document.querySelector('[data-comment="' + CSS.escape(dk) + '"]');
      var text = box ? box.value.trim() : "";
      if (!text) { if (box) box.focus(); return; }
      var w = state.info[dk] || {};
      var id = queue({ type: "comment", block: w.block, week: w.week, session: w.session, text: text }) || newId();
      addComment(dk, { id: id, text: text, at: Date.now() });
      state.drafts[dk] = "";
      keepOpen(send);
      render();
      return;
    }
    var head = e.target.closest(".day-head");
    if (head) {
      var art = head.parentNode;
      var key = art.getAttribute("data-day");
      state.openDays[key] = !art.classList.contains("open");
      render();
    }
  });
  $("days").addEventListener("input", function (e) {
    var k = e.target.getAttribute && e.target.getAttribute("data-comment");
    if (k) state.drafts[k] = e.target.value;
    var wk = e.target.getAttribute && e.target.getAttribute("data-weight");
    if (wk) state.weightDrafts[wk] = e.target.value;
  });
  // A weight is saved when the client leaves the box or taps Done/Enter.
  $("days").addEventListener("change", function (e) {
    var k = e.target.getAttribute && e.target.getAttribute("data-weight");
    if (k) saveWeight(k, e.target.value);
  });
  $("days").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.getAttribute("data-weight") != null) e.target.blur();
  });

  function saveWeight(k, value) {
    var w = String(value || "").trim().slice(0, isCoach() ? 2000 : 40);
    delete state.weightDrafts[k];
    var old = getWeights()[k];
    if ((old ? old.w : "") === w) return;
    var i = state.info[k] || {};
    setWeight(k, w, i.name, i.week);
    if (i.key) queue({ type: isCoach() ? "note" : "weight", key: i.key, block: i.block, week: i.week, session: i.session, exercise: i.name, weight: w });
    var input = document.querySelector('[data-weight="' + CSS.escape(k) + '"]');
    if (input) keepOpen(input);
    // Wait a moment so that if they tapped straight into the next box, it keeps the cursor.
    setTimeout(render, 0);
  }

  function sendTick(k, on) {
    var i = state.info[k];
    if (i) queue({ type: "tick", key: i.key, block: i.block, week: i.week, session: i.session, exercise: i.exercise, done: on });
  }

  function keepOpen(el) {
    var art = el.closest(".day");
    if (art) state.openDays[art.getAttribute("data-day")] = true;
  }

  function closeMenu() { $("menu").classList.add("hidden"); $("menuBtn").setAttribute("aria-expanded", "false"); }
  $("menuBtn").addEventListener("click", function (e) {
    e.stopPropagation();
    var hidden = $("menu").classList.toggle("hidden");
    $("menuBtn").setAttribute("aria-expanded", String(!hidden));
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#menu")) closeMenu();
  });
  $("refreshBtn").addEventListener("click", function () { closeMenu(); refresh(false); });
  $("signOutBtn").addEventListener("click", function () { signOut(); });
  $("installMenuBtn").addEventListener("click", function () { closeMenu(); showInstall(true); });

  // Refresh when the app comes back to the foreground, so program edits show up.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && state.code && state.data) { refresh(true); flush(); }
  });

  // ---------- install to home screen ----------
  var deferredPrompt = null;
  var isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    maybeShowInstall();
  });
  window.addEventListener("appinstalled", function () { hideInstall(); });

  function maybeShowInstall() {
    if (isStandalone || load(KEY_INSTALL_DISMISSED, false)) return;
    if ($("programView").classList.contains("hidden")) return;
    if (deferredPrompt || isIOS) showInstall(false);
  }

  function showInstall(fromMenu) {
    if (isStandalone) {
      $("installText").textContent = "ScoutCo is already on your home screen.";
      $("installAccept").classList.add("hidden");
    } else if (deferredPrompt) {
      $("installText").innerHTML = "<strong>Add ScoutCo to your home screen</strong><br>Open your program in one tap, like an app.";
      $("installAccept").classList.remove("hidden");
    } else if (isIOS) {
      $("installText").innerHTML = "<strong>Add ScoutCo to your home screen</strong><br>In Safari, tap " +
        '<svg class="share-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/></svg>' +
        " <b>Share</b>, then <b>Add to Home Screen</b>.";
      $("installAccept").classList.add("hidden");
    } else if (fromMenu) {
      $("installText").innerHTML = "<strong>Add ScoutCo to your home screen</strong><br>Open your browser menu (⋮) and choose <b>Add to Home screen</b> or <b>Install app</b>.";
      $("installAccept").classList.add("hidden");
    } else {
      return;
    }
    $("installBanner").classList.remove("hidden");
  }
  function hideInstall() { $("installBanner").classList.add("hidden"); }

  $("installDismiss").addEventListener("click", function () { save(KEY_INSTALL_DISMISSED, true); hideInstall(); });
  $("installAccept").addEventListener("click", function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () { deferredPrompt = null; hideInstall(); });
  });

  // ---------- demo program ----------
  function isoOffset(days) {
    var d = addDays(todayDay(), days);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function demoData() {
    function ex(label, name, sets, reps, load, rest, notes, video) {
      return { label: label, name: name, sets: sets, reps: reps, load: load, tempo: "", rest: rest, notes: notes || "", video: video || "" };
    }
    return {
      client: { name: "Demo Athlete", type: "Online only", sessions: "Train on your own schedule, 3 sessions a week", message: "Welcome to ScoutCo! This is a sample program so you can see how the app works." },
      program: {
        name: "Demo",
        blocks: [
          { name: "Block 1 · Foundation", start: isoOffset(-9), weeks: [
          { name: "Week 1", days: [
            { name: "Session 1 · Lower strength", exercises: [
              ex("A1", "Back squat", "4", "6", "75%", "2-3 min", "Brace hard, sit between the hips."),
              ex("B1", "Romanian deadlift", "3", "8", "RPE 7", "90 s"),
              ex("B2", "Walking lunge", "3", "10 each", "2×16 kg", "90 s"),
              ex("C1", "Copenhagen plank", "3", "20 s each", "", "45 s")
            ]},
            { name: "Session 2 · Upper strength", exercises: [
              ex("A1", "Bench press", "4", "6", "75%", "2-3 min"),
              ex("A2", "Chin-up", "4", "6-8", "Bodyweight", "2 min"),
              ex("B1", "Half-kneeling landmine press", "3", "8 each", "", "60 s"),
              ex("B2", "Chest-supported row", "3", "10", "", "60 s")
            ]},
            { name: "Session 3 · Conditioning", exercises: [
              ex("A1", "Tempo runs", "8", "100 m", "70% effort", "Walk back", "Stay smooth and relaxed.")
            ]}
          ]},
          { name: "Week 2", days: [
            { name: "Session 1 · Lower strength", exercises: [
              ex("A1", "Back squat", "4", "5", "80%", "2-3 min"),
              ex("B1", "Romanian deadlift", "3", "8", "RPE 8", "90 s")
            ]}
          ]}
          ]},
          { name: "Block 2 · Strength", start: isoOffset(5), weeks: [
            { name: "Week 1", days: [
              { name: "Session 1 · Lower", exercises: [
                ex("A1", "Trap bar deadlift", "5", "3", "85%", "3 min"),
                ex("B1", "Bulgarian split squat", "3", "6 each", "2×20 kg", "90 s")
              ]},
              { name: "Session 2 · Upper", exercises: [
                ex("A1", "Weighted chin-up", "5", "3", "+10 kg", "3 min")
              ]}
            ]}
          ]}
        ]
      },
      updated: new Date().toISOString()
    };
  }

  // ---------- start ----------

  // Personal link support: index.html?code=SC-XXXXXX signs the client straight in.
  var params = new URLSearchParams(location.search);
  var linkCode = normaliseCode(params.get("code"));
  if (linkCode) {
    history.replaceState(null, "", location.pathname);
    save(KEY_CODE, linkCode);
  }

  state.code = load(KEY_CODE, null);
  if (state.code) {
    var cached = load(KEY_CACHE, null);
    if (cached && cached.code === state.code) {
      setData(cached.data, false);
      refresh(true);
    } else {
      refresh(false);
    }
  } else {
    show("loginView");
  }

  flush();

  // ---------- app updates ----------
  // A home-screen app can sit open for days, so check for a new version each time it comes
  // back to the front, and reload into it once nobody is typing.
  if ("serviceWorker" in navigator) {
    var hadController = !!navigator.serviceWorker.controller;
    var updateReady = false;
    var reloadIfIdle = function () {
      var el = document.activeElement;
      var typing = el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT");
      if (updateReady && !typing) location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!hadController) { hadController = true; return; } // first install, nothing to update
      updateReady = true;
      if (document.visibilityState === "hidden") return; // reload when they come back
      reloadIfIdle();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      reloadIfIdle();
      navigator.serviceWorker.getRegistration().then(function (r) { if (r) r.update(); }).catch(function () {});
    });
    document.addEventListener("focusout", function () { setTimeout(reloadIfIdle, 500); });
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(function () { /* app still works online */ });
    });
  }
})();
