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
  var KEY_SWAPS = "scoutco.swaps";
  var KEY_CHECKINS = "scoutco.checkins";
  var KEY_CI_POP = "scoutco.checkinPop"; // which check-in pop-ups this phone has shown: { "<code>|<week>|fri": true }
  var KEY_TODOS = "scoutco.todos";
  var KEY_PROFILE = "scoutco.profile";
  var KEY_COMMUNITY = "scoutco.community";
  var KEY_PUSH_ASKED = "scoutco.pushAsked";
  var KEY_VIDEOS_SEEN = "scoutco.videosSeen";
  var KEY_INSTALL_DISMISSED = "scoutco.installDismissed";
  var KEY_AGREE = "scoutco.agreeSigned";
  var KEY_RENEW = "scoutco.renewSeen";
  var KEY_MSG_REACT = "scoutco.msgReact";

  var COACH = String(CONFIG.coachName || "Kirst");

  var $ = function (id) { return document.getElementById(id); };
  function freshState() {
    return { code: null, data: null, block: null, week: null, openDays: {}, drafts: {}, weightDrafts: {}, info: {},
      view: "program", ci: null, liftPick: null, todoDraft: "", todoAll: false, prof: null, profMsg: "",
      commDraft: "", commPhoto: null, commReply: null, commReplyDraft: "", commMsg: "", commErr: "",
      upload: null, playing: null, ag: null, vidTo: "", vidLift: "", vidNote: "", vidReplyOpen: null, vidReplyDraft: "" };
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
    mergeSwaps(data && data.ticks, data && data.swaps);
    mergeCheckins(data && data.checkins);
    mergeTodos(data && data.todos);
    mergeProfile(data);
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
    try { initPush(); } catch (e) { /* the app works without notifications */ }
    render();
    show("programView");
    maybeShowInstall();
    setTimeout(checkinPop, 900);
  }

  // Friday (or Saturday): "Your weekly check-in is open". Sunday, if it's still not done: a reminder.
  // Each one shows once per week on this phone.
  function checkinPop() {
    if (!state.code || !checkinDue() || checkinWaiting() || document.querySelector(".ci-pop")) return;
    if (document.querySelector(".pb-pop")) { setTimeout(checkinPop, 3000); return; } // wait for another pop-up to close
    var sunday = new Date().getDay() === 0, seen = load(KEY_CI_POP, {});
    var key = state.code + "|" + thisWeekOf() + "|" + (sunday ? "sun" : "fri");
    if (seen[key]) return;
    seen[key] = true;
    save(KEY_CI_POP, seen);
    if (state.view === "checkin") return; // they're already on it
    var el = document.createElement("div");
    el.className = "pb-pop push-pop ci-pop";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Weekly check-in");
    el.innerHTML = '<div class="coach-pop-card push-pop-card"><div class="push-pop-bell" aria-hidden="true">' + (sunday ? "⏰" : "📋") + "</div>" +
      "<h2>" + (sunday ? "Don't forget your check-in" : "Your weekly check-in is open") + "</h2>" +
      '<p class="muted">' + esc(sunday ? "It closes tonight. It only takes a minute and " + COACH + " reads every one."
        : "Tell " + COACH + " how your week went. It takes about a minute and it's open until Sunday night.") + "</p>" +
      '<button class="btn primary" data-ci-go>Do it now</button><button class="btn ghost" data-ci-later>Later</button></div>';
    document.body.appendChild(el);
    el.addEventListener("click", function (e) {
      if (e.target.closest("[data-ci-go]")) { el.remove(); state.view = "checkin"; render(); window.scrollTo(0, 0); }
      else if (e.target === el || e.target.closest("[data-ci-later]")) el.remove();
    });
  }

  function signOut(message) {
    remove(KEY_CODE); remove(KEY_CACHE); remove(KEY_WEEK); remove(KEY_BLOCK); remove(KEY_OUTBOX); remove(KEY_TODOS); remove(KEY_PROFILE); remove(KEY_COMMUNITY); remove(KEY_VIDEOS_SEEN); remove(KEY_AGREE); remove(KEY_RENEW); remove(KEY_MSG_REACT);
    videoJustSent = []; videoDone = { hide: {}, reply: {} };
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
      return !((ev.type === "tick" || ev.type === "weight" || ev.type === "note" || ev.type === "checkin" || ev.type === "todo" || ev.type === "profile" || ev.type === "coachprofile" || ev.type === "videoreply" || ev.type === "agreement" || ev.type === "renewal" || ev.type === "msgreact") && x.type === ev.type && x.key === ev.key); // only the latest value matters
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
          var sentComm = box.filter(function (x) { return COMM_TYPES[x.type] && saved.indexOf(x.id) !== -1; });
          sentComm.forEach(function (x) { x.sentAt = Date.now(); commSent.push(x); });
          if (sentComm.length) setTimeout(fetchCommunity, 0);
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

  // ---------- home swaps ----------
  // Saved on the phone as { "<code>|<block>|<week>|<session>|<n>": { name: "Band lat pulldown", at: ms } }.
  // The exercise's home version comes from the Home swaps tab (ex.home); back squat, deadlift and bench (ex.locked) stay gym only.
  function getSwaps() { return load(KEY_SWAPS, {}); }
  function setSwap(key, home) {
    var all = getSwaps();
    if (home) all[key] = { name: home.name, at: Date.now() }; else delete all[key];
    save(KEY_SWAPS, all);
  }
  // The home version to show for this exercise, or null for the gym version.
  function activeSwap(ex, key, swaps) {
    return ex.home && ex.home.name && swaps[key] ? ex.home : null;
  }
  // The sheet remembers swaps on ticked exercises, so they follow the client to a new phone.
  function mergeSwaps(serverTicks, server) {
    if (!serverTicks || !state.code) return;
    server = server || {};
    var all = getSwaps(), changed = false, waiting = {};
    load(KEY_OUTBOX, []).forEach(function (x) { if (x.type === "tick") waiting[x.key] = true; });
    Object.keys(serverTicks).forEach(function (rest) {
      if (waiting[rest]) return; // not saved to the sheet yet: the phone is newer
      var k = state.code + "|" + rest;
      if (server[rest]) { if (!all[k] || all[k].name !== server[rest]) { all[k] = { name: server[rest], at: 0 }; changed = true; } }
      else if (all[k]) { delete all[k]; changed = true; }
    });
    if (changed) save(KEY_SWAPS, all);
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
  // The weekly check-in opens on Friday and closes at the end of Sunday (one per Monday-to-Sunday week).
  function checkinOpen() { var d = new Date().getDay(); return d === 5 || d === 6 || d === 0; }
  function checkinWaiting() { return load(KEY_OUTBOX, []).some(function (x) { return x.type === "checkin" && x.key === thisWeekOf(); }); }
  function checkinDue() { return isOnline() && !isCoach() && checkinOpen() && !checkinFor(thisWeekOf()); }

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
    if (isCoach()) v = [["program", "Schedule"], ["todo", "To-do"], ["clients", "Clients"], ["videos", "Videos"], ["community", "Lift Club Community"], ["profile", "Profile"]];
    else {
      v = [["program", "Program"]];
      if (isOnline()) v.push(["checkin", "Check-in"]);
      v.push(["progress", "Progress"]);
      v.push(["videos", "My videos"]);
      v.push(["community", "Lift Club Community"]);
      v.push(["profile", "Profile"]);
      if (agreement()) v.push(["agreement", "Agreement"]);
    }
    if (siteLinks().length) v.push(["site", "ScoutCo HQ"]);
    return v;
  }
  function renderViewTabs() {
    var views = viewList();
    if (!views.some(function (v) { return v[0] === state.view; })) state.view = "program";
    var due = checkinDue();
    var profDue = profileNeedsFilling();
    var commDot = state.view !== "community" && commUnread();
    var openTodos = isCoach() ? getTodos().filter(function (t) { return !t.done; }).length : 0;
    var vidDot = state.view !== "videos" && videosUnseen() > 0;
    var toReview = videosToReview();
    $("viewTabs").classList.toggle("hidden", views.length < 2);
    $("viewTabs").innerHTML = views.map(function (v) {
      return '<button class="view-tab" role="tab" data-view="' + v[0] + '" aria-selected="' + (v[0] === state.view) + '">' +
        esc(v[1]) + ((v[0] === "checkin" && due) || (v[0] === "profile" && profDue) || (v[0] === "community" && commDot) || (v[0] === "videos" && vidDot) || (v[0] === "agreement" && agreementDue()) ? '<span class="dot" aria-label="to do"></span>' : "") +
        (v[0] === "todo" && openTodos ? '<span class="count" aria-label="' + openTodos + ' to do">' + openTodos + "</span>" : "") +
        (v[0] === "videos" && toReview ? '<span class="count" aria-label="' + toReview + ' to check">' + toReview + "</span>" : "") + "</button>";
    }).join("");
    $("programPane").classList.toggle("hidden", state.view !== "program");
    $("checkinPane").classList.toggle("hidden", state.view !== "checkin");
    $("progressPane").classList.toggle("hidden", state.view !== "progress");
    $("todoPane").classList.toggle("hidden", state.view !== "todo");
    $("sitePane").classList.toggle("hidden", state.view !== "site");
    $("profilePane").classList.toggle("hidden", state.view !== "profile");
    $("clientsPane").classList.toggle("hidden", state.view !== "clients");
    $("communityPane").classList.toggle("hidden", state.view !== "community");
    $("videosPane").classList.toggle("hidden", state.view !== "videos");
    $("agreementPane").classList.toggle("hidden", state.view !== "agreement");
  }

  // Links to the ScoutCo website, set in config.js (websiteLinks).
  function siteLinks() {
    var list = (window.SCOUTCO_CONFIG || {}).websiteLinks || [];
    return list.filter(function (l) { return l && l.label && /^https?:\/\//.test(String(l.url || "")); });
  }
  function renderSite() {
    $("sitePane").innerHTML = coachCardHtml() + '<ul class="site-links">' + siteLinks().map(function (l) {
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
    var rPhoto = safePhoto(coachInfo().photo);
    el.innerHTML = (rPhoto ? '<button class="note-photo" data-coach-open aria-label="About ' + esc(COACH) + '"><img src="' + esc(rPhoto) + '" alt=""></button>' : "") +
      "<strong>Reply from " + esc(COACH) + "</strong>" + esc(r.reply) +
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
    var history = myCheckins().filter(function (c) { return c.week !== week; }).slice(0, 8);
    var earlier = history.length ? '<h3 class="section-title">Earlier check-ins</h3>' + history.map(historyHtml).join("") : "";

    // Already sent this week: show what they sent. It can only be sent once a week.
    if (saved) {
      var when = checkinWaiting() ? "Sending…" : "Sent ✓ " + new Date(saved.at || Date.now()).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
      $("checkinPane").innerHTML =
        '<section class="card ci">' +
          '<h2>Check-in done for this week 🙌</h2>' +
          '<p class="muted small">Thanks! ' + esc(COACH) + " reads every one. Your next check-in opens on Friday.</p>" +
          historyHtml(Object.assign({ week: week }, saved), when) +
        "</section>" + earlier;
      return;
    }

    // Monday to Thursday: nothing to fill in yet.
    if (!checkinOpen()) {
      $("checkinPane").innerHTML =
        '<section class="card ci ci-closed">' +
          '<div class="ci-closed-icon" aria-hidden="true">⏳</div>' +
          "<h2>Your check-in will appear here on Friday</h2>" +
          '<p class="muted small">Once a week, from Friday to Sunday, you\'ll tell ' + esc(COACH) + " how your week went. It takes about a minute.</p>" +
        "</section>" + earlier;
      return;
    }

    if (!state.ci || state.ci.week !== week) {
      state.ci = { week: week, error: "" };
    }
    var d = state.ci;
    var rows = SCORES.map(function (sc) {
      return '<div class="ci-row"><div class="ci-name">' + esc(sc.name) +
        (sc.hint ? '<small>' + esc(sc.hint) + "</small>" : "") + '</div><div class="ci-scale" role="radiogroup" aria-label="' + esc(sc.name) + '">' +
        [1, 2, 3].map(function (n) {
          return '<button type="button" class="ci-btn s' + n + '" role="radio" data-score="' + sc.id + '" data-val="' + n +
            '" aria-checked="' + (+d[sc.id] === n) + '"><b>' + n + "</b>" + SCORE_WORDS[n] + "</button>";
        }).join("") + "</div></div>";
    }).join("");
    var closes = new Date().getDay() === 0 ? "It closes tonight." : "It's open until Sunday night.";

    $("checkinPane").innerHTML =
      '<section class="card ci">' +
        '<h2>Weekly pulse check</h2>' +
        '<p class="muted small">This ' + esc(weekLabel(week)) + '. Tap 1 for bad, 2 for OK or 3 for good. ' + esc(COACH) + " reads every one. " + esc(closes) + "</p>" +
        rows +
        '<label class="ci-label" for="ci-bw">Bodyweight <span class="muted">(optional)</span></label>' +
        '<input id="ci-bw" class="ci-input" data-ci="bw" type="text" inputmode="decimal" maxlength="20" autocomplete="off" placeholder="e.g. 72.5 kg" value="' + esc(d.bw || "") + '">' +
        '<label class="ci-label" for="ci-note">Note for ' + esc(COACH) + "</label>" +
        '<textarea id="ci-note" class="ci-input" data-ci="note" rows="3" maxlength="2000" placeholder="Anything ' + esc(COACH) + ' should know this week?">' + esc(d.note || "") + "</textarea>" +
        (d.error ? '<p class="error">' + esc(d.error) + "</p>" : "") +
        '<div class="ci-actions"><span class="small muted">You can send it once a week, so check your answers first.</span>' +
          '<button class="btn primary" data-ci-send>Send check-in</button></div>' +
      "</section>" + earlier;
  }

  function historyHtml(c, status) {
    return '<div class="card ci-past"><div class="ci-past-head">' + esc(weekLabel(c.week).replace(/^w/, "W")) +
      (status ? ' <span class="small muted">' + esc(status) + "</span>" : "") + "</div>" +
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
    if (!checkinOpen() || d.week !== thisWeekOf() || checkinFor(d.week)) { state.ci = null; render(); return; } // once a week, Friday to Sunday
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

  // ---------- client profile ----------
  // Name and Type come from the Clients tab (Kirst sets those). The client fills in the rest.
  // Saved on the phone as { code, p: { photo, dob, squat, deadlift, bench, hobbies, goals, food, at }, pbs: [...] }.
  var LIFTS = [
    { id: "squat", name: "Back squat" },
    { id: "deadlift", name: "Deadlift" },
    { id: "bench", name: "Bench press" }
  ];
  var PROFILE_FIELDS = ["photo", "dob", "squat", "deadlift", "bench", "hobbies", "goals", "food"];
  // Kirst's own profile (her Coach row). Clients see it on their ScoutCo HQ tab.
  var COACH_FIELDS = ["photo", "about", "quals", "hobbies", "food"];
  function profFields() { return isCoach() ? COACH_FIELDS : PROFILE_FIELDS; }

  function profileStore() { var s = load(KEY_PROFILE, null); return s && s.code === state.code ? s : { code: state.code, p: {}, pbs: [] }; }
  function getProfile() { return profileStore().p || {}; }
  function getPbs() { return profileStore().pbs || []; }
  function saveProfileStore(p, pbs) { save(KEY_PROFILE, { code: state.code, p: p, pbs: pbs || getPbs() }); }
  function profileWaiting() { return load(KEY_OUTBOX, []).some(function (x) { return x.type === "profile" || x.type === "coachprofile" || x.type === "pb"; }); }
  function safePhoto(u) { u = String(u || ""); return /^data:image\/(jpeg|png|webp);base64,[a-z0-9+\/=]+$/i.test(u) ? u : ""; }
  function hasProfileData(p) { return profFields().some(function (f) { return String(p[f] || "").trim() !== ""; }); }
  // The Profile tab gets a dot until they've told Kirst the basics.
  function profileNeedsFilling() {
    var p = getProfile();
    if (isCoach()) return !p.photo || !String(p.about || "").trim();
    return !p.dob || !String(p.goals || "").trim() || !LIFTS.some(function (l) { return kgOf(p[l.id]); });
  }

  // The sheet's copy wins, unless the phone has changes it hasn't sent yet.
  function mergeProfile(data) {
    if (!data || !state.code || !("profile" in data)) return; // older script: keep what's on the phone
    var mine = profileStore();
    var pbs = Array.isArray(data.pbs) ? data.pbs : mine.pbs;
    if (profileWaiting()) { saveProfileStore(mine.p, mine.pbs.length >= pbs.length ? mine.pbs : pbs); return; }
    if (!data.profile) {
      // Nothing in the sheet yet but the phone has something (e.g. filled in before the script was updated): send it up.
      saveProfileStore(mine.p, pbs);
      if (hasProfileData(mine.p)) queueProfile(mine.p);
      return;
    }
    var p = {};
    profFields().forEach(function (f) { p[f] = String(data.profile[f] == null ? "" : data.profile[f]); });
    p.at = +data.profile.at || 0;
    var draft = state.prof, dirty = draft && profFields().some(function (f) { return String(draft[f] || "") !== String(mine.p[f] || ""); });
    saveProfileStore(p, pbs);
    if (!dirty) state.prof = null; // don't throw away something they're halfway through typing
  }

  function queueProfile(p) {
    var ev = { type: "profile", key: "profile" };
    if (isCoach()) ev.type = "coachprofile";
    profFields().forEach(function (f) { ev[f] = p[f] || ""; });
    queue(ev);
  }

  // "100 kg", "100", "80/90/100" or "100kg x 3" -> 100. Pounds are changed to kg.
  function kgOf(s) {
    var t = String(s == null ? "" : s).replace(/,/g, ".");
    var nums = (t.match(/\d+(?:\.\d+)?/g) || []).map(parseFloat).filter(function (n) { return n > 0 && n < 1000; });
    if (!nums.length) return 0;
    var n = Math.max.apply(null, nums);
    if (/\blbs?\b|\d\s*lbs?/i.test(t)) n = n * 0.4536;
    return Math.round(n * 2) / 2; // nearest half kilo
  }
  function kgText(n) { return n ? String(n).replace(/\.0$/, "") + " kg" : ""; }

  // Which of the three big lifts an exercise is (only the lift itself, not variations like RDLs or front squats).
  function liftOf(name) {
    var n = String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (/\b(box|pin|half|quarter|partial|band|banded|chains?|smith|safety|ssb|front|goblet|split|bulgarian|hack|zercher|overhead|landmine|db|dumbbell|kettlebell|kb|machine)\b/.test(n)) return null;
    if (/back squat|^(barbell |high[- ]bar |low[- ]bar |comp |competition |paused? )*squat$/.test(n)) return LIFTS[0];
    if (/deadlift/.test(n) && !/\b(romanian|rdl|stiff|single|trap|hex|snatch|suitcase|b-stance|kickstand|rack|block|jefferson)\b/.test(n)) return LIFTS[1];
    if (/bench/.test(n) && !/\b(incline|decline|close|floor|board|spoto|larsen|single|one-arm|1-arm|reverse|dips?|step|row|jump|hop|sit-?ups?|crunch)\b/.test(n)) return LIFTS[2];
    return null;
  }

  // Called when a client logs a weight. If it beats their 1RM on a big lift, update it and celebrate.
  function checkPb(info, weightText) {
    var lift = liftOf(info.name);
    if (!lift || !weightText) return;
    var kg = kgOf(weightText);
    var reps = parseInt(String(info.reps || "").trim(), 10);
    // Optional (config.js pbFromEstimate): count an estimated 1RM from a set of up to 10 reps.
    if (CONFIG.pbFromEstimate && /^\d+$/.test(String(info.reps || "").trim()) && reps > 1 && reps <= 10) {
      kg = Math.round(kg * (1 + reps / 30) * 2) / 2;
    }
    var p = getProfile(), cur = kgOf(p[lift.id]);
    if (!kg || !cur || kg <= cur) return; // no 1RM entered yet, or not heavier
    if (kg > cur * 1.3 && !window.confirm(kgText(kg) + " is a big jump from your " + lift.name.toLowerCase() + " 1RM of " + kgText(cur) + ". Is that right?")) return;
    p = Object.assign({}, p);
    p[lift.id] = String(kg);
    p.at = Date.now();
    var pb = { at: Date.now(), lift: lift.name, kg: kg, prev: cur };
    saveProfileStore(p, [pb].concat(getPbs()).slice(0, 20));
    if (state.prof) state.prof[lift.id] = String(kg);
    queue({ type: "pb", key: newId(), liftId: lift.id, lift: lift.name, kg: kg, prev: cur,
      exercise: info.name, weight: weightText, block: info.block, week: info.week, session: info.session });
    showPb(lift, kg, cur);
  }

  function showPb(lift, kg, prev) {
    var old = document.querySelector(".pb-pop");
    if (old) old.remove();
    var colours = ["#8b5cf6", "#a78bfa", "#34d399", "#fbbf24", "#f472b6", "#ffffff"];
    var bits = "";
    for (var i = 0; i < 40; i++) {
      bits += '<i style="left:' + (Math.random() * 100).toFixed(1) + "%;background:" + colours[i % colours.length] +
        ";animation-delay:" + (Math.random() * 0.6).toFixed(2) + "s;animation-duration:" + (1.8 + Math.random() * 1.4).toFixed(2) + "s;transform:rotate(" + Math.round(Math.random() * 360) + 'deg)"></i>';
    }
    var el = document.createElement("div");
    el.className = "pb-pop";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "New PB");
    el.innerHTML = '<div class="confetti" aria-hidden="true">' + bits + "</div>" +
      '<div class="pb-card">' +
        '<div class="pb-emoji" aria-hidden="true">🏆</div>' +
        '<div class="pb-kicker">New PB!</div>' +
        '<div class="pb-lift">' + esc(lift.name) + "</div>" +
        '<div class="pb-kg">' + esc(kgText(kg)) + "</div>" +
        '<p class="pb-text">That\'s ' + esc(kgText(Math.round((kg - prev) * 2) / 2)) + " more than your old best of " + esc(kgText(prev)) +
          ". Your 1RM on your profile is updated, and " + esc(COACH) + " will see it too.</p>" +
        '<button class="btn primary" data-pb-close>Let\'s go! 💪</button>' +
      "</div>";
    document.body.appendChild(el);
    try { if (navigator.vibrate) navigator.vibrate([80, 50, 120]); } catch (e) { /* not on every phone */ }
    var close = function () { el.remove(); };
    el.addEventListener("click", function (e) { if (e.target === el || e.target.closest("[data-pb-close]")) close(); });
    setTimeout(function () { var b = el.querySelector("[data-pb-close]"); if (b) b.focus(); }, 50);
  }

  // Shrinks a photo to a small square so it fits in one cell of the sheet.
  function shrinkPhoto(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var side = Math.min(img.naturalWidth, img.naturalHeight);
        if (!side) { reject(new Error("bad image")); return; }
        var sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
        var tries = [[320, 0.82], [320, 0.7], [280, 0.62], [240, 0.55], [200, 0.5]];
        for (var i = 0; i < tries.length; i++) {
          var c = document.createElement("canvas");
          c.width = c.height = tries[i][0];
          var ctx = c.getContext("2d");
          ctx.fillStyle = "#1d1a24";
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, sx, sy, side, side, 0, 0, c.width, c.height);
          var out = c.toDataURL("image/jpeg", tries[i][1]);
          if (out.length <= 45000 || i === tries.length - 1) { resolve(out.length <= 45000 ? out : ""); return; }
        }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("bad image")); };
      img.src = url;
    });
  }

  function setPhoto(photo) {
    var p = Object.assign({}, getProfile(), { photo: photo, at: Date.now() });
    saveProfileStore(p);
    if (state.prof) state.prof.photo = photo;
    queueProfile(p);
    render();
  }

  function initials(name) {
    return String(name || "").trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join("") || "?";
  }

  function renderProfile() {
    if (isCoach()) { renderCoachProfile(); return; }
    var client = (state.data && state.data.client) || {};
    var saved = getProfile();
    if (!state.prof) state.prof = Object.assign({}, saved);
    var d = state.prof;
    var photo = safePhoto(d.photo);
    var pending = load(KEY_OUTBOX, []).some(function (x) { return x.type === "profile" || x.type === "coachprofile"; });
    var dirty = profFields().some(function (f) { return f !== "photo" && String(d[f] || "") !== String(saved[f] || ""); });
    var status = state.profMsg || (dirty ? "" : pending && canSend() ? "Saving…" : saved.at ? "Saved ✓" : "");
    var field = function (id, label, html) {
      return '<label class="ci-label" for="pf-' + id + '">' + label + "</label>" + html;
    };
    var input = function (id, attrs, placeholder) {
      return '<input id="pf-' + id + '" class="ci-input" data-prof="' + id + '" ' + attrs + ' placeholder="' + esc(placeholder) + '" value="' + esc(d[id] || "") + '">';
    };
    var area = function (id, placeholder) {
      return '<textarea id="pf-' + id + '" class="ci-input" data-prof="' + id + '" rows="3" maxlength="1000" placeholder="' + esc(placeholder) + '">' + esc(d[id] || "") + "</textarea>";
    };
    var lifts = LIFTS.map(function (l) {
      return '<div class="rm"><label for="pf-' + l.id + '">' + esc(l.name) + "</label>" +
        '<div class="rm-box"><input id="pf-' + l.id + '" data-prof="' + l.id + '" type="text" inputmode="decimal" maxlength="10" autocomplete="off" placeholder="–" value="' +
          esc(String(d[l.id] || "").replace(/\s*kg$/i, "")) + '"><span>kg</span></div></div>';
    }).join("");
    var pbs = getPbs().slice(0, 8);

    $("profilePane").innerHTML =
      '<section class="card profile-head">' +
        '<label class="avatar' + (photo ? "" : " empty") + '" for="pf-photo" aria-label="' + (photo ? "Change" : "Add") + ' your photo">' +
          (photo ? '<img src="' + esc(photo) + '" alt="">' : "<span>" + esc(initials(client.name)) + "</span>") +
          '<em aria-hidden="true">📷</em>' +
        "</label>" +
        '<input id="pf-photo" class="sr-only" type="file" accept="image/*" data-prof-photo>' +
        '<div class="profile-who"><h2>' + esc(client.name || "Your profile") + "</h2>" +
          (client.type ? '<span class="type-badge">' + esc(client.type) + "</span>" : "") +
          '<div class="small muted">' + (photo ? '<button class="link-btn" data-prof-photo-del>Remove photo</button>' : "Tap the circle to add a photo") + "</div>" +
        "</div>" +
      "</section>" +
      '<section class="card">' +
        "<h3>Your 1RMs</h3>" +
        '<p class="muted small">The most you can lift for one rep. When you log a heavier weight on one of these lifts, it updates by itself and you get a PB pop-up 🎉</p>' +
        '<div class="rms">' + lifts + "</div>" +
      "</section>" +
      '<section class="card">' +
        "<h3>About you</h3>" +
        '<p class="muted small">Helps ' + esc(COACH) + " get to know you and plan your training.</p>" +
        field("dob", "Date of birth", input("dob", 'type="date" max="' + isoDay(new Date()) + '"', "")) +
        field("goals", "Health and fitness goals", area("goals", "e.g. Deadlift 100 kg, run 5 km without stopping, feel strong for netball")) +
        field("hobbies", "Hobbies and interests", area("hobbies", "What do you love doing outside the gym?")) +
        field("food", "Favourite food", input("food", 'type="text" maxlength="200" autocomplete="off"', "Go on, tell us")) +
        '<div class="ci-actions"><span class="small muted">' + esc(status) + "</span>" +
          '<button class="btn primary" data-prof-save>Save profile</button></div>' +
      "</section>" +
      (pbs.length ? '<h3 class="section-title">Your PBs</h3><section class="card"><ul class="pb-list">' + pbs.map(function (b) {
        return "<li><span>🏆 <b>" + esc(b.lift) + " " + esc(kgText(+b.kg)) + "</b>" + (+b.prev ? ' <small class="muted">up from ' + esc(kgText(+b.prev)) + "</small>" : "") + "</span>" +
          '<small class="muted">' + (b.at ? esc(new Date(+b.at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })) : "") + "</small></li>";
      }).join("") + "</ul></section>" : "");
  }

  function saveProfile() {
    var d = state.prof || {};
    var p = Object.assign({}, getProfile());
    if (isCoach()) {
      ["about", "quals", "hobbies", "food"].forEach(function (f) { p[f] = String(d[f] || "").trim().slice(0, 2000); });
      p.at = Date.now();
      saveProfileStore(p);
      queueProfile(p);
      state.prof = null;
      state.profMsg = "";
      render();
      return;
    }
    ["dob", "hobbies", "goals", "food"].forEach(function (f) { p[f] = String(d[f] || "").trim().slice(0, 1000); });
    LIFTS.forEach(function (l) { var kg = kgOf(d[l.id]); p[l.id] = kg ? String(kg) : ""; });
    if (p.dob && !/^\d{4}-\d{2}-\d{2}$/.test(p.dob)) p.dob = "";
    p.at = Date.now();
    saveProfileStore(p);
    queueProfile(p);
    state.prof = null;
    state.profMsg = "";
    render();
  }

  // ---------- Kirst's profile, as clients see it ----------
  // On Kirst's own phone this is what she's typed (even before it reaches the sheet).
  function coachInfo() {
    if (isCoach()) return getProfile();
    return (state.data && state.data.coach) || {};
  }
  function coachCardHtml() {
    var c = coachInfo(), photo = safePhoto(c.photo);
    var rows = [["about", ""], ["quals", "Qualifications and experience"], ["hobbies", "Hobbies and interests"], ["food", "Favourite food"]]
      .filter(function (r) { return String(c[r[0]] || "").trim(); });
    if (!photo && !rows.length) return "";
    return '<section class="card coach-card">' +
      '<div class="coach-card-head">' + (photo ? '<img class="coach-card-photo" src="' + esc(photo) + '" alt="' + esc(COACH) + '">' : "") +
        '<div><div class="small muted">Your coach</div><h2>' + esc(COACH) + "</h2></div></div>" +
      rows.map(function (r) {
        return (r[1] ? "<h4>" + esc(r[1]) + "</h4>" : "") + '<p class="coach-card-text">' + esc(c[r[0]]) + "</p>";
      }).join("") +
      (isCoach() ? '<p class="muted small">This is how clients see you on their ScoutCo HQ tab.</p>' : "") +
    "</section>";
  }

  // Tapping Kirst's photo anywhere in a client's app opens her profile.
  function showCoach() {
    var card = coachCardHtml();
    if (!card) return;
    var old = document.querySelector(".coach-pop");
    if (old) old.remove();
    var el = document.createElement("div");
    el.className = "pb-pop coach-pop";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "About " + COACH);
    el.innerHTML = '<div class="coach-pop-card">' + card +
      '<button class="btn primary" data-coach-close>Close</button></div>';
    document.body.appendChild(el);
    var close = function () { el.remove(); document.removeEventListener("keydown", onKey); };
    var onKey = function (e) { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    el.addEventListener("click", function (e) { if (e.target === el || e.target.closest("[data-coach-close]")) close(); });
    setTimeout(function () { var b = el.querySelector("[data-coach-close]"); if (b) b.focus(); }, 50);
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("[data-coach-open]")) showCoach();
  });

  function renderCoachProfile() {
    var saved = getProfile();
    if (!state.prof) state.prof = Object.assign({}, saved);
    var d = state.prof, photo = safePhoto(d.photo);
    var pending = load(KEY_OUTBOX, []).some(function (x) { return x.type === "coachprofile"; });
    var dirty = COACH_FIELDS.some(function (f) { return f !== "photo" && String(d[f] || "") !== String(saved[f] || ""); });
    var status = state.profMsg || (dirty ? "" : pending && canSend() ? "Saving…" : saved.at ? "Saved ✓" : "");
    var area = function (id, label, placeholder, rows) {
      return '<label class="ci-label" for="pf-' + id + '">' + label + "</label>" +
        '<textarea id="pf-' + id + '" class="ci-input" data-prof="' + id + '" rows="' + rows + '" maxlength="2000" placeholder="' + esc(placeholder) + '">' + esc(d[id] || "") + "</textarea>";
    };
    $("profilePane").innerHTML =
      '<section class="card profile-head">' +
        '<label class="avatar' + (photo ? "" : " empty") + '" for="pf-photo" aria-label="' + (photo ? "Change" : "Add") + ' your photo">' +
          (photo ? '<img src="' + esc(photo) + '" alt="">' : "<span>" + esc(initials(COACH)) + "</span>") +
          '<em aria-hidden="true">📷</em>' +
        "</label>" +
        '<input id="pf-photo" class="sr-only" type="file" accept="image/*" data-prof-photo>' +
        '<div class="profile-who"><h2>' + esc(COACH) + '</h2><span class="type-badge">Coach</span>' +
          '<div class="small muted">' + (photo ? '<button class="link-btn" data-prof-photo-del>Remove photo</button>' : "Tap the circle to add a photo") + "</div>" +
        "</div>" +
      "</section>" +
      '<section class="card">' +
        "<h3>About you</h3>" +
        '<p class="muted small">Clients see this on their ScoutCo HQ tab, and your photo shows on your notes to them.</p>' +
        area("about", "About me", "A few lines about you and how you coach", 5) +
        area("quals", "Qualifications and experience", "e.g. Cert IV Fitness, remedial massage, 10 years coaching", 3) +
        area("hobbies", "Hobbies and interests", "What you love doing outside the gym", 3) +
        '<label class="ci-label" for="pf-food">Favourite food</label>' +
        '<input id="pf-food" class="ci-input" data-prof="food" type="text" maxlength="200" autocomplete="off" value="' + esc(d.food || "") + '">' +
        '<div class="ci-actions"><span class="small muted">' + esc(status) + "</span>" +
          '<button class="btn primary" data-prof-save>Save profile</button></div>' +
      "</section>" +
      (coachCardHtml() ? '<h3 class="section-title">Preview</h3>' + coachCardHtml() : "");
  }

  // ---------- Kirst's Clients tab: every client's profile ----------
  function ageFrom(dob) {
    var d = parseDay(dob); if (!d) return null;
    var t = todayDay(), a = t.getFullYear() - d.getFullYear();
    if (t < new Date(t.getFullYear(), d.getMonth(), d.getDate())) a--;
    return a;
  }
  // Days until their next birthday (0 = today), or null.
  function daysToBirthday(dob) {
    var d = parseDay(dob); if (!d) return null;
    var t = todayDay(), next = new Date(t.getFullYear(), d.getMonth(), d.getDate());
    if (next < t) next = new Date(t.getFullYear() + 1, d.getMonth(), d.getDate());
    return Math.round((next - t) / 864e5);
  }
  function renderClients() {
    var list = (state.data && state.data.clients) || null;
    if (!list) {
      $("clientsPane").innerHTML = '<p class="empty">Client profiles show here once the updated script is in your sheet.</p>';
      return;
    }
    if (!list.length) {
      $("clientsPane").innerHTML = '<p class="empty">No active clients yet.</p>';
      return;
    }
    var filled = list.filter(function (c) { return c.at; }).length;
    var withMsg = list.filter(function (c) { return c.message; }), reacted = withMsg.filter(function (c) { return c.reaction; }).length;
    $("clientsPane").innerHTML = '<p class="muted small clients-sum">' + filled + " of " + list.length + " clients have filled in their profile." +
      (withMsg.length ? "<br>" + reacted + " of " + withMsg.length + " have reacted to your message (so they've seen it)." : "") + "</p>" +
      list.map(function (c) {
        var photo = safePhoto(c.photo), age = ageFrom(c.dob), bday = daysToBirthday(c.dob);
        var dob = parseDay(c.dob);
        var facts = [];
        if (age != null) facts.push(age + " years old");
        if (dob) facts.push("Birthday " + dob.toLocaleDateString("en-AU", { day: "numeric", month: "long" }));
        var rms = LIFTS.map(function (l) {
          return "<div><b>" + (kgOf(c[l.id]) ? esc(kgText(kgOf(c[l.id]))) : "–") + "</b><span>" + esc(l.name) + "</span></div>";
        }).join("");
        var text = [["goals", "Goals"], ["hobbies", "Hobbies and interests"], ["food", "Favourite food"]].filter(function (r) { return String(c[r[0]] || "").trim(); })
          .map(function (r) { return "<h4>" + esc(r[1]) + '</h4><p class="coach-card-text">' + esc(c[r[0]]) + "</p>"; }).join("");
        var pbs = (c.pbs || []).slice(0, 3);
        return '<details class="card client-card">' +
          "<summary>" +
            '<span class="mini-avatar">' + (photo ? '<img src="' + esc(photo) + '" alt="">' : esc(initials(c.name))) + "</span>" +
            '<span class="client-who"><b>' + esc(c.name) + "</b>" +
              '<small class="muted">' + esc([c.type, age != null ? age + " yrs" : ""].filter(Boolean).join(" · ")) + "</small></span>" +
            (bday != null && bday <= 7 ? '<span class="bday" title="Birthday soon">🎂 ' + (bday === 0 ? "Today" : bday === 1 ? "Tomorrow" : "in " + bday + " days") + "</span>" : "") +
            (!c.at ? '<span class="pill">Not filled in</span>' : "") +
            (c.reaction ? '<span class="msg-seen" title="Reacted to your message">' + esc(c.reaction.emoji) + "</span>" : "") +
          "</summary>" +
          '<div class="client-body">' +
            (facts.length ? '<p class="muted small">' + esc(facts.join(" · ")) + "</p>" : "") +
            '<div class="stat-row">' + rms + "</div>" +
            text +
            (pbs.length ? "<h4>Latest PBs</h4><ul class=\"pb-list\">" + pbs.map(function (b) {
              return "<li><span>🏆 " + esc(b.lift) + " " + esc(kgText(+b.kg)) + "</span><small class=\"muted\">" +
                (b.at ? esc(new Date(+b.at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })) : "") + "</small></li>";
            }).join("") + "</ul>" : "") +
            (!c.at ? '<p class="muted small">They haven\'t filled in their profile yet.</p>' : "") +
            (c.message ? "<h4>Your message</h4><p class=\"coach-card-text\">" + esc(c.message) + "</p>" +
              '<p class="muted small">' + (c.reaction ? "Reacted " + esc(c.reaction.emoji) + (c.reaction.at ? " on " + esc(c.reaction.at) : "") : "No reaction yet") + "</p>" : "") +
          "</div>" +
        "</details>";
      }).join("");
  }

  // ---------- Lift Club Community ----------
  // Posts load on their own (not with the program) and are kept on the phone for offline.
  // New posts, reactions and deletes go through the outbox, and show straight away.
  var COMM_TYPES = { post: 1, react: 1, unpost: 1 };
  var COMM_REACTIONS = ["💪", "🔥", "👏", "❤️"];
  var commSent = []; // sent and saved, but not in a fresh copy of the feed yet
  var commLoading = false;
  function commStore() { var s = load(KEY_COMMUNITY, null); return s && s.code === state.code ? s : { code: state.code, feed: null, seen: 0 }; }
  function saveCommStore(s) { save(KEY_COMMUNITY, s); }
  function fetchCommunity() {
    if (commLoading || !state.code) return;
    if (state.code === "DEMO" || !CONFIG.apiUrl) {
      var d = commStore(); d.feed = demoCommunity(); saveCommStore(d);
      if (state.view === "community") render();
      return;
    }
    commLoading = true;
    var started = Date.now();
    var url = CONFIG.apiUrl + (CONFIG.apiUrl.indexOf("?") === -1 ? "?" : "&") +
      "code=" + encodeURIComponent(state.code) + "&community=1&t=" + started;
    fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("bad"); return r.json(); })
      .then(function (json) {
        if (!json || json.error || !Array.isArray(json.posts)) throw new Error("bad");
        var s = commStore(); s.feed = json; saveCommStore(s);
        commSent = commSent.filter(function (x) { return x.sentAt >= started; });
        state.commErr = "";
      })
      .catch(function () { state.commErr = commStore().feed ? "" : "Couldn't load the Lift Club right now. Pull down or try again soon."; })
      .then(function () { commLoading = false; if (state.view === "community") render(); });
  }
  function commFeed() {
    var server = commStore().feed;
    var me = server ? server.me : "me";
    var people = Object.assign({}, server ? server.people : {});
    if (!people[me]) people[me] = { name: isCoach() ? COACH : String(((state.data || {}).client || {}).name || "You").split(" ")[0], photo: "", coach: isCoach() };
    // Your own photo straight from your profile, so a new one shows straight away.
    var myPhoto = safePhoto(getProfile().photo);
    if (myPhoto) people[me] = Object.assign({}, people[me], { photo: myPhoto });
    var posts = (server ? server.posts : []).map(function (p) {
      return Object.assign({}, p, { counts: Object.assign({}, p.counts), mine: (p.mine || []).slice() });
    });
    var byId = {};
    posts.forEach(function (p) { byId[p.id] = p; });
    var gone = {};
    var waiting = load(KEY_OUTBOX, []).filter(function (x) { return COMM_TYPES[x.type]; });
    commSent.concat(waiting).forEach(function (ev) {
      if (ev.type === "post" && !byId[ev.id]) {
        var p = { id: ev.id, by: me, at: ev.at, text: ev.text, photo: ev.photo || "", parent: ev.parent || "", counts: {}, mine: [], pending: isPending(ev.id) };
        posts.push(p); byId[p.id] = p;
      } else if (ev.type === "react" && byId[ev.post]) {
        var q = byId[ev.post], has = q.mine.indexOf(ev.emoji) !== -1;
        if (ev.on && !has) { q.mine.push(ev.emoji); q.counts[ev.emoji] = (q.counts[ev.emoji] || 0) + 1; }
        if (!ev.on && has) { q.mine.splice(q.mine.indexOf(ev.emoji), 1); q.counts[ev.emoji] = Math.max(0, (q.counts[ev.emoji] || 1) - 1); }
      } else if (ev.type === "unpost") gone[ev.post] = true;
    });
    posts = posts.filter(function (p) { return !gone[p.id] && !gone[p.parent]; });
    var tops = posts.filter(function (p) { return !p.parent; }).sort(function (a, b) { return b.at - a.at; });
    var replies = {};
    posts.forEach(function (p) { if (p.parent) (replies[p.parent] = replies[p.parent] || []).push(p); });
    Object.keys(replies).forEach(function (k) { replies[k].sort(function (a, b) { return a.at - b.at; }); });
    return { me: me, people: people, tops: tops, replies: replies, loaded: !!server };
  }
  function commNewest() {
    var latest = 0;
    var data = (state.data && state.data.community) || {};
    if (+data.latest) latest = +data.latest;
    var f = commStore().feed;
    if (f) f.posts.forEach(function (p) { if (p.by !== f.me && p.at > latest) latest = p.at; });
    return latest;
  }
  function commUnread() { return commNewest() > (commStore().seen || 0); }
  function markCommSeen() {
    var s = commStore(), n = commNewest();
    if (n > (s.seen || 0)) { s.seen = n; saveCommStore(s); }
  }
  function timeAgo(ms) {
    if (!ms) return "";
    var mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    if (mins < 60 * 24) return Math.round(mins / 60) + "h ago";
    var d = new Date(ms), y = addDays(todayDay(), -1);
    if (d.toDateString() === y.toDateString()) return "yesterday";
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  }
  function commAvatar(person) {
    var photo = safePhoto(person.photo);
    var inner = photo ? '<img src="' + esc(photo) + '" alt="">' : esc(initials(person.name));
    // Clients can tap Kirst's photo to see her profile.
    if (person.coach && !isCoach() && coachCardHtml()) return '<button class="mini-avatar comm-avatar" data-coach-open aria-label="About ' + esc(person.name) + '">' + inner + "</button>";
    return '<span class="mini-avatar comm-avatar">' + inner + "</span>";
  }
  function commByline(p, f) {
    var who = f.people[p.by] || { name: "ScoutCo member" };
    return '<div class="comm-head">' + commAvatar(who) +
      '<div class="comm-who"><b>' + esc(who.name) + "</b>" + (who.coach ? '<span class="type-badge comm-coach">Coach</span>' : "") +
      '<small class="muted">' + (p.pending ? "Sending…" : esc(timeAgo(p.at))) + "</small></div></div>";
  }
  function commDelBtn(p, f) {
    if (p.by === f.me) return '<button class="comm-link" data-comm-del="' + esc(p.id) + '">Delete</button>';
    if (isCoach()) return '<button class="comm-link" data-comm-hide="' + esc(p.id) + '">Hide</button>';
    return "";
  }
  function renderCommunity() {
    var f = commFeed();
    var html = '<section class="card comm-compose">' +
      "<h2>Lift Club Community</h2>" +
      '<p class="muted small">Share a win, ask a question or cheer someone on. Everyone training with ScoutCo can see what you post.</p>' +
      '<textarea data-comm-new rows="3" maxlength="2000" placeholder="Share something with the Lift Club…">' + esc(state.commDraft) + "</textarea>" +
      (state.commMsg ? '<p class="error small">' + esc(state.commMsg) + "</p>" : "") +
      commPhotoComposeHtml() +
      '<div class="comm-compose-row"><button class="btn small ghost" data-comm-photo-add>📷 ' + (state.commPhoto ? "Change photo" : "Add photo") + "</button>" +
        '<span class="comm-spacer"></span><button class="btn primary" data-comm-post>Post</button></div>' +
    "</section>" + pushCardHtml();
    if (!f.loaded && !f.tops.length) {
      html += state.commErr ? '<p class="empty">' + esc(state.commErr) + "</p>" : '<div class="spinner" aria-label="Loading"></div>';
    } else if (!f.tops.length) {
      html += '<p class="empty">No posts yet. Be the first to say hi!</p>';
    }
    html += f.tops.map(function (p) {
      var reps = f.replies[p.id] || [];
      var open = state.commReply === p.id;
      return '<article class="card comm-post' + (p.pending ? " pending" : "") + '">' +
        commByline(p, f) +
        (p.text ? '<p class="comm-text">' + esc(p.text) + "</p>" : "") +
        commPhotoHtml(p.photo) +
        '<div class="comm-actions">' + COMM_REACTIONS.map(function (e) {
          var n = p.counts[e] || 0, on = p.mine.indexOf(e) !== -1;
          return '<button class="comm-react' + (on ? " on" : "") + '" data-comm-react="' + esc(p.id) + '" data-emoji="' + esc(e) + '" aria-pressed="' + on + '">' +
            e + (n ? "<span>" + n + "</span>" : "") + "</button>";
        }).join("") +
          '<span class="comm-spacer"></span>' +
          '<button class="comm-link" data-comm-reply="' + esc(p.id) + '">Reply</button>' + commDelBtn(p, f) +
        "</div>" +
        (reps.length || open ? '<div class="comm-replies">' + reps.map(function (r) {
          return '<div class="comm-reply' + (r.pending ? " pending" : "") + '">' + commByline(r, f) +
            '<p class="comm-text">' + esc(r.text) + "</p>" +
            (commDelBtn(r, f) ? '<div class="comm-actions">' + commDelBtn(r, f) + "</div>" : "") + "</div>";
        }).join("") +
          (open ? '<div class="comm-reply-box"><textarea data-comm-reply-text="' + esc(p.id) + '" rows="2" maxlength="2000" placeholder="Write a reply…">' +
            esc(state.commReplyDraft) + '</textarea><button class="btn primary small" data-comm-send-reply="' + esc(p.id) + '">Reply</button></div>' : "") +
        "</div>" : "") +
      "</article>";
    }).join("");
    $("communityPane").innerHTML = html;
    markCommSeen();
  }
  // ---------- Lift Club photos ----------
  // A photo uploads (shrunk) as soon as it's picked, so the post itself stays small and can wait in the outbox.
  var commPhotoLocal = {}; // Drive file id -> the shrunk photo on this phone, shown until Google has it ready
  function commPhotoSrc(id, size) {
    id = safeFileId(id);
    return commPhotoLocal[id] || (id ? "https://drive.google.com/thumbnail?id=" + id + "&sz=w" + (size || 1200) : "");
  }
  function commPhotoHtml(id) {
    if (!safeFileId(id)) return "";
    return '<button class="comm-photo" data-comm-photo-view="' + esc(id) + '" aria-label="See the full photo">' +
      '<img src="' + esc(commPhotoSrc(id)) + '" alt="" loading="lazy" onerror="if(!this.dataset.b){this.dataset.b=1;this.src=\'https://lh3.googleusercontent.com/d/' + esc(id) + '=w1200\'}"></button>';
  }
  function commPhotoComposeHtml() {
    var ph = state.commPhoto;
    if (!ph) return "";
    return '<div class="comm-photo-draft"><img src="' + esc(ph.preview) + '" alt="Your photo">' +
      '<button class="comm-photo-x" data-comm-photo-del aria-label="Remove photo">×</button>' +
      (ph.busy ? '<span class="comm-photo-state">Uploading…</span>' : ph.err ? '<span class="comm-photo-state err">' + esc(ph.err) + "</span>" : "") + "</div>";
  }
  function shrinkForPost(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth, h = img.naturalHeight, scale = Math.min(1, 1600 / Math.max(w, h));
        if (!w || !h) { reject(new Error("bad image")); return; }
        var c = document.createElement("canvas");
        c.width = Math.round(w * scale); c.height = Math.round(h * scale);
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#1d1a24"; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("bad image")); };
      img.src = url;
    });
  }
  function pickCommPhoto() {
    if (!canSend()) { state.commMsg = "Photos work once you open the app with your own code."; render(); return; }
    var input = document.createElement("input");
    input.type = "file"; input.accept = "image/*"; input.style.display = "none";
    input.addEventListener("change", function () {
      var f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      var mine = { busy: true, preview: "", file: "", err: "" };
      state.commPhoto = mine; state.commMsg = "";
      shrinkForPost(f).then(function (dataUrl) {
        mine.preview = dataUrl; render();
        return videoPost({ op: "photo", mime: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1) }).then(function (res) {
          if (!res || !res.ok || !safeFileId(res.file)) throw new Error((res && res.error) || "bad");
          mine.file = res.file; commPhotoLocal[res.file] = dataUrl;
        });
      }).catch(function (err) {
        mine.err = err && err.message === "bad image" ? "That photo couldn't be opened. Try another one." : "Couldn't upload it. Check your signal and try again.";
      }).then(function () { mine.busy = false; if (state.commPhoto === mine) render(); });
      render();
    });
    document.body.appendChild(input);
    input.click();
  }
  function showPhoto(id) {
    var el = document.createElement("div");
    el.className = "photo-pop";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Photo");
    el.innerHTML = '<img src="' + esc(commPhotoSrc(id, 2000)) + '" alt=""><button class="photo-pop-x" aria-label="Close">×</button>';
    el.addEventListener("click", function () { el.remove(); });
    document.body.appendChild(el);
  }

  function commSend(ev) {
    if (!canSend()) { state.commMsg = "Posting works once you open the app with your own code."; render(); return false; }
    ev.at = Date.now();
    queue(ev);
    return true;
  }


  // ---------- videos ----------
  // Kirst sends clients videos from their sessions; clients send her form videos of the big three lifts.
  // Videos are too big for the outbox, so they upload straight away in pieces (the app has to stay open).
  // Replies and removals are small, so they go through the outbox like everything else.
  var VIDEO_LIFTS = ["Back squat", "Deadlift", "Bench press"];
  var VIDEO_MAX_MB = 500;
  var TRIM_TIP = "✂️ Trim your video to just the set before you send it. Shorter videos send faster and save space.";
  var videoJustSent = []; // uploaded, but not in a fresh copy of the program yet
  var videoDone = { hide: {}, reply: {} }; // removed or replied to on this phone (kept until the sheet shows it too)
  function videoSeenStore() { var s = load(KEY_VIDEOS_SEEN, null); return s && s.code === state.code ? s : { code: state.code, seen: {} }; }
  function safeFileId(id) { id = String(id || ""); return /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : ""; }
  function videoList() {
    var server = (state.data && state.data.videos) || [];
    var have = {};
    server.forEach(function (v) { have[v.id] = 1; });
    var list = videoJustSent.filter(function (v) { return !have[v.id]; }).concat(server);
    var hidden = Object.assign({}, videoDone.hide), replies = {};
    Object.keys(videoDone.reply).forEach(function (id) {
      var srv = server.filter(function (v) { return v.id === id; })[0];
      if (srv && srv.reply === videoDone.reply[id]) delete videoDone.reply[id]; else replies[id] = videoDone.reply[id];
    });
    load(KEY_OUTBOX, []).forEach(function (x) {
      if (x.type === "videohide") hidden[x.video] = 1;
      if (x.type === "videoreply") replies[x.video] = x.text;
    });
    return list.filter(function (v) { return !hidden[v.id] && safeFileId(v.file); }).map(function (v) {
      return replies[v.id] != null ? Object.assign({}, v, { reply: replies[v.id], replyPending: load(KEY_OUTBOX, []).some(function (x) { return x.type === "videoreply" && x.video === v.id; }) }) : v;
    }).sort(function (a, b) { return b.at - a.at; });
  }
  // A client sees a dot for a new video from Kirst, or a new reply from her.
  function videoMark(v) { return v.kind === "coach" ? "1" : v.reply ? "r" + v.reply.length : ""; }
  function videosUnseen() {
    if (isCoach()) return 0;
    var seen = videoSeenStore().seen;
    return videoList().filter(function (v) { var m = videoMark(v); return m && seen[v.id] !== m; }).length;
  }
  function markVideosSeen() {
    if (isCoach()) return;
    var s = videoSeenStore(), changed = false;
    videoList().forEach(function (v) { var m = videoMark(v); if (m && s.seen[v.id] !== m) { s.seen[v.id] = m; changed = true; } });
    if (changed) save(KEY_VIDEOS_SEEN, s);
  }
  // Kirst's coach app: form videos she hasn't replied to yet.
  function videosToReview() { return isCoach() ? videoList().filter(function (v) { return v.kind === "form" && !v.reply; }).length : 0; }

  function mb(bytes) { return bytes >= 1048576 ? Math.round(bytes / 1048576) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB"; }
  function videoPost(video) {
    return fetch(CONFIG.apiUrl, { method: "POST", body: JSON.stringify({ code: state.code, video: video }) })
      .then(function (r) { if (!r.ok) throw Object.assign(new Error("bad"), { retry: true }); return r.json(); },
        function () { throw Object.assign(new Error("offline"), { retry: true }); });
  }
  function readBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result || ""); resolve(s.slice(s.indexOf(",") + 1)); };
      r.onerror = function () { reject(new Error("Couldn't read the video on this phone.")); };
      r.readAsDataURL(blob);
    });
  }
  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  function uploadBar() {
    var u = state.upload, el = $("uploadBar");
    if (!el) {
      el = document.createElement("div");
      el.id = "uploadBar";
      el.className = "upload-bar";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.addEventListener("click", function (e) { if (e.target.closest("[data-upload-close]")) { state.upload = null; uploadBar(); } });
      document.body.appendChild(el);
    }
    if (!u) { el.classList.add("hidden"); return; }
    el.classList.remove("hidden");
    el.classList.toggle("failed", !!u.error);
    el.innerHTML = '<div class="upload-row"><strong>' + esc(u.error ? "Video not sent" : u.done ? "Sent ✓" : "Sending video… " + u.pct + "%") + "</strong>" +
      (u.busy ? "" : '<button class="comm-link" data-upload-close>Close</button>') + "</div>" +
      (u.busy ? '<div class="upload-track"><i style="width:' + u.pct + '%"></i></div>' : "") +
      '<div class="muted small">' + esc(u.error || u.msg || "") + "</div>";
  }

  // meta: { to (client id, coach only), toName, lift, note }
  function uploadVideo(file, meta) {
    if (state.upload && state.upload.busy) { window.alert("One video is already sending. Wait for it to finish first."); return; }
    if (!canSend()) { window.alert("Videos can be sent once you open the app with your own code."); return; }
    if (!file || !file.size) return;
    if (file.size > VIDEO_MAX_MB * 1048576) {
      window.alert("That video is " + mb(file.size) + ", which is too big (the limit is " + VIDEO_MAX_MB + " MB). Trim it on your phone first and try again.");
      return;
    }
    var size = file.size, mime = /^video\//.test(file.type) ? file.type : "video/mp4";
    state.upload = { busy: true, pct: 0, msg: mb(size) + ". Keep the app open and your screen on until it's done." };
    uploadBar();
    var lock = null;
    try { if (navigator.wakeLock) navigator.wakeLock.request("screen").then(function (l) { lock = l; }, function () {}); } catch (e) { /* not on every phone */ }
    var upload, chunk, direct = "", directWorked = false;
    function progress(next) {
      state.upload.pct = Math.min(99, Math.round(next / size * 100));
      uploadBar();
    }
    // Fast way: the phone sends each piece straight to Google Drive.
    // If the phone's browser won't allow that, it falls back to sending through the sheet (slower).
    function sendDirect(offset) {
      var end = Math.min(size, offset + chunk);
      return fetch(direct, { method: "PUT", headers: { "Content-Range": "bytes " + offset + "-" + (end - 1) + "/" + size }, body: file.slice(offset, end) })
        .then(function (r) {
          if (r.status === 308) return { ok: true, next: end };
          if (r.status === 200 || r.status === 201) return videoPost({ op: "status", upload: upload });
          if (r.status === 404 || r.status === 410) return { error: "That upload timed out. Please try again." };
          return { error: "Google Drive had a hiccup.", retry: true };
        }, function () {
          // Nothing sent yet: this phone can't send straight to Drive, so go through the sheet instead.
          if (offset === 0 && !directWorked) { direct = ""; return videoPost({ op: "status", upload: upload }); }
          return { error: "Connection dropped.", retry: true };
        })
        .then(function (res) { if (res && res.ok && !res.done && direct) directWorked = true; return res; });
    }
    function sendFrom(offset, tries) {
      var step = direct ? sendDirect(offset) : readBase64(file.slice(offset, Math.min(size, offset + chunk)))
        .then(function (data) { return videoPost({ op: "chunk", upload: upload, start: offset, data: data }); });
      return step
        .then(function (res) {
          if (res && res.done) return res.video;
          if (res && res.ok) { progress(res.next); return sendFrom(res.next, 0); }
          throw Object.assign(new Error((res && res.error) || "Something went wrong."), { retry: !!(res && res.retry) });
        })
        .catch(function (err) {
          if (!err.retry || tries >= 5) throw err;
          state.upload.msg = "Connection dropped. Trying again…"; uploadBar();
          return wait(2000 * Math.pow(2, tries)).then(function () {
            return videoPost({ op: "status", upload: upload });
          }).then(function (res) {
            if (res && res.done) return res.video;
            if (res && res.ok) { state.upload.msg = "Back on track. Keep the app open."; progress(res.next); return sendFrom(res.next, tries + 1); }
            throw new Error((res && res.error) || "Something went wrong.");
          }, function () { return sendFrom(offset, tries + 1); });
        });
    }
    videoPost({ op: "start", name: file.name || "", size: size, mime: mime, to: meta.to || "", lift: meta.lift || "", note: meta.note || "" })
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || "Something went wrong.");
        upload = res.upload; chunk = res.chunk || 8 * 1048576;
        direct = /^https:\/\/www\.googleapis\.com\/upload\//.test(String(res.url || "")) ? res.url : "";
        return sendFrom(0, 0);
      })
      .then(function (video) {
        if (video && !video.client) video.client = meta.toName || "";
        if (video) videoJustSent.push(video);
        state.upload = { done: true, pct: 100, msg: isCoach() ? (meta.toName ? meta.toName.split(" ")[0] + " can watch it on their My videos tab now." : "Sent.") :
          COACH + " will take a look and reply here." };
        state.vidNote = ""; state.vidLift = state.vidLift || "";
        if (state.data) render();
        uploadBar();
        setTimeout(function () { if (state.upload && state.upload.done) { state.upload = null; uploadBar(); } }, 6000);
      })
      .catch(function (err) {
        state.upload = { error: (err && err.retry ? "Couldn't reach the sheet. Check your signal and try again." : (err && err.message) || "Something went wrong. Please try again.") };
        uploadBar();
      })
      .then(function () { try { if (lock) lock.release(); } catch (e) { /* ignore */ } });
  }
  window.addEventListener("beforeunload", function (e) {
    if (state.upload && state.upload.busy) { e.preventDefault(); e.returnValue = ""; }
  });
  // Opens the phone's video picker (library or camera), then calls back with the file.
  function pickVideo(then) {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.style.display = "none";
    input.addEventListener("change", function () { var f = input.files && input.files[0]; input.remove(); if (f) then(f); });
    document.body.appendChild(input);
    input.click();
  }

  function videoPlayerHtml(v) {
    var id = safeFileId(v.file);
    if (state.playing === v.id) {
      return '<div class="vid-frame" data-vid-frame="' + esc(v.id) + '"><iframe src="https://drive.google.com/file/d/' + esc(id) + '/preview" allow="autoplay; fullscreen" allowfullscreen title="Video"></iframe></div>' +
        '<p class="muted small vid-help">Just sent? Google can take a few minutes to get a video ready to play. ' +
        '<a href="https://drive.google.com/file/d/' + esc(id) + '/view" target="_blank" rel="noopener">Open in Google Drive</a></p>';
    }
    return '<button class="vid-thumb" data-vid-play="' + esc(v.id) + '" aria-label="Play video">' +
      '<img src="https://drive.google.com/thumbnail?id=' + esc(id) + '&amp;sz=w640" alt="" loading="lazy" onerror="this.remove()">' +
      '<span class="vid-play" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span></button>';
  }
  function videoDate(ms) { return ms ? new Date(ms).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }) : ""; }
  function videoCardHtml(v) {
    var coach = isCoach();
    var title = v.kind === "form" ? (coach ? "Form check" : "Your form check") + (v.lift ? " · " + v.lift : "")
      : (coach ? "Sent by you" : "From " + COACH) + (v.lift ? " · " + v.lift : "");
    var reply = "";
    if (v.kind === "form") {
      if (coach && state.vidReplyOpen === v.id) {
        reply = '<div class="comm-reply-box"><textarea data-vid-reply-text="' + esc(v.id) + '" rows="3" maxlength="2000" placeholder="What did you see? Cues for next time…">' +
          esc(state.vidReplyDraft) + '</textarea><button class="btn primary small" data-vid-send-reply="' + esc(v.id) + '">Send reply</button></div>';
      } else if (v.reply) {
        var cPhoto = coach ? "" : safePhoto(coachInfo().photo);
        reply = '<div class="vid-reply">' + (cPhoto ? '<span class="mini-avatar"><img src="' + esc(cPhoto) + '" alt=""></span>' : "") +
          "<div><strong>" + (coach ? "Your reply" : esc(COACH) + "'s reply") + (v.replyPending && canSend() ? ' <small class="muted">Sending…</small>' : "") + "</strong>" +
          '<p class="comm-text">' + esc(v.reply) + "</p></div></div>";
      } else if (!coach) {
        reply = '<p class="muted small vid-wait">' + esc(COACH) + " hasn't replied yet. You'll get a notification when she does.</p>";
      }
    }
    var actions = [];
    if (coach && v.kind === "form") actions.push('<button class="comm-link" data-vid-reply="' + esc(v.id) + '">' + (v.reply ? "Edit reply" : "Reply") + "</button>");
    if (coach || v.kind === "form") actions.push('<button class="comm-link" data-vid-del="' + esc(v.id) + '">Remove</button>');
    return '<article class="card vid-card' + (coach && v.kind === "form" && !v.reply ? " to-review" : "") + '">' +
      '<div class="vid-head"><div><b>' + esc(coach ? v.client || "Client" : title) + "</b>" +
        '<small class="muted">' + esc(coach ? title + " · " + videoDate(v.at) : videoDate(v.at)) + "</small></div>" +
        (coach && v.kind === "form" && !v.reply ? '<span class="pill">To check</span>' : "") + "</div>" +
      videoPlayerHtml(v) +
      (v.note ? '<p class="comm-text vid-note">' + esc(v.note) + "</p>" : "") +
      reply +
      (actions.length ? '<div class="comm-actions"><span class="comm-spacer"></span>' + actions.join("") + "</div>" : "") +
    "</article>";
  }

  function renderVideos() {
    var list = videoList(), html = "";
    if (isCoach()) {
      var clients = ((state.data && state.data.clients) || []).filter(function (c) { return c.vid; });
      if (state.vidTo && !clients.some(function (c) { return c.vid === state.vidTo; })) state.vidTo = "";
      html += '<section class="card vid-send"><h2>Send a client a video</h2>' +
        '<p class="muted small">Pick who it\'s for, then choose a video from your phone. Only that client can see it, on their My videos tab.</p>' +
        (clients.length ? '<label class="ci-label" for="vid-to">Client</label>' +
          '<select id="vid-to" class="lift-pick vid-select" data-vid-to><option value="">Choose a client…</option>' + clients.map(function (c) {
            return '<option value="' + esc(c.vid) + '"' + (c.vid === state.vidTo ? " selected" : "") + ">" + esc(c.name) + "</option>";
          }).join("") + "</select>" +
          '<label class="ci-label" for="vid-lift">What is it? <span class="muted">(optional)</span></label>' +
          '<input id="vid-lift" class="ci-input" data-vid-lift="1" type="text" maxlength="60" placeholder="e.g. Back squat, top set" value="' + esc(state.vidLift || "") + '">' +
          '<label class="ci-label" for="vid-note">Note for them <span class="muted">(optional)</span></label>' +
          '<textarea id="vid-note" class="ci-input" data-vid-note="1" rows="2" maxlength="1000" placeholder="e.g. Look how much better your depth is!">' + esc(state.vidNote || "") + "</textarea>" +
          '<div class="comm-compose-row"><button class="btn primary" data-vid-pick>🎥 Choose video and send</button></div>'
          : '<p class="empty">Your clients show here once the updated script is in your sheet.</p>') +
        "</section>";
      var shown = state.vidTo ? list.filter(function (v) { return v.who === state.vidTo; }) : list;
      var review = shown.filter(function (v) { return v.kind === "form" && !v.reply; });
      var rest = shown.filter(function (v) { return !(v.kind === "form" && !v.reply); });
      if (review.length) html += '<h3 class="vid-section">Form checks to look at (' + review.length + ")</h3>" + review.map(videoCardHtml).join("");
      html += '<h3 class="vid-section">' + (state.vidTo ? "Videos for this client" : "All videos") + "</h3>" +
        (rest.length ? rest.map(videoCardHtml).join("") : '<p class="empty">' + (review.length ? "Nothing else yet." : "No videos yet.") + "</p>");
    } else {
      html += '<section class="card vid-send"><h2>My videos</h2>' +
        '<p class="muted small">Videos ' + esc(COACH) + " takes in your sessions show up here. You can also send her a form video of your back squat, deadlift or bench press and she'll reply with what she sees. Only you and " + esc(COACH) + " can see these.</p>" +
        '<label class="ci-label" for="vid-lift">Send ' + esc(COACH) + ' a form video</label>' +
        '<select id="vid-lift" class="lift-pick vid-select" data-vid-form-lift><option value="">Which lift?</option>' + VIDEO_LIFTS.map(function (l) {
          return '<option' + (l === state.vidLift ? " selected" : "") + ">" + esc(l) + "</option>";
        }).join("") + "</select>" +
        '<label class="ci-label" for="vid-note">Note for ' + esc(COACH) + ' <span class="muted">(optional)</span></label>' +
        '<textarea id="vid-note" class="ci-input" data-vid-note="1" rows="2" maxlength="1000" placeholder="e.g. 60 kg, felt my hips shoot up">' + esc(state.vidNote || "") + "</textarea>" +
        '<p class="vid-tip">' + esc(TRIM_TIP) + "</p>" +
        '<div class="comm-compose-row"><button class="btn primary" data-vid-pick>🎥 Choose video and send</button></div>' +
        "</section>";
      html += list.length ? list.map(videoCardHtml).join("") : '<p class="empty">No videos yet.</p>';
    }
    // Keep a playing video playing when the screen redraws.
    var playing = state.playing ? document.querySelector('#videosPane [data-vid-frame="' + CSS.escape(state.playing) + '"]') : null;
    $("videosPane").innerHTML = html;
    if (playing) {
      var fresh = document.querySelector('#videosPane [data-vid-frame="' + CSS.escape(state.playing) + '"]');
      if (fresh) fresh.replaceWith(playing);
    }
    markVideosSeen();
  }
  // From the 🎥 button on back squat, deadlift and bench press: send straight from the session.
  function formVideoFromExercise(key) {
    var info = state.info[key] || {};
    var lift = liftOf(info.name);
    if (!lift) return;
    pickVideo(function (file) {
      var note = window.prompt("Anything " + COACH + " should know? (weight, reps, how it felt). Leave blank to skip.", "");
      if (note === null) return;
      var logged = getWeights()[key];
      var where = [info.week, info.session, logged && logged.w].filter(Boolean).join(", ");
      uploadVideo(file, { lift: lift.name, note: where + (note.trim() ? (where ? ": " : "") + note.trim() : "") });
    });
  }

  // ---------- push notifications (OneSignal) ----------
  // Only switched on once Kirst puts her OneSignal App ID on the Settings tab of the sheet.
  // OneSignal's worker lives in push/onesignal/ so it doesn't get in the way of the app's own sw.js.
  var push = { started: false, ready: false, supported: false, on: false, busy: false, failed: false, os: null };
  function pushAppId() { return String(((state.data || {}).settings || {}).pushAppId || "").trim(); }
  function initPush() {
    var appId = pushAppId(), me = ((state.data || {}).community || {}).me;
    if (!appId || !me || push.started || !canSend()) return;
    push.started = true;
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    var s = document.createElement("script");
    s.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    s.defer = true;
    s.onerror = function () { push.failed = true; push.err = "Couldn't load OneSignal."; render(); };
    document.head.appendChild(s);
    var base = location.pathname.replace(/[^\/]*$/, ""); // e.g. "/scoutco-app/"
    window.OneSignalDeferred.push(function (OneSignal) {
      return OneSignal.init({
        appId: appId,
        serviceWorkerPath: base.slice(1) + "push/onesignal/OneSignalSDKWorker.js",
        serviceWorkerParam: { scope: base + "push/onesignal/" }
      }).then(function () {
        return OneSignal.login(me); // the same id the sheet sends notifications to (never their code)
      }).then(function () {
        push.os = OneSignal;
        push.supported = OneSignal.Notifications.isPushSupported();
        push.on = !!OneSignal.User.PushSubscription.optedIn;
        push.ready = true;
        OneSignal.User.PushSubscription.addEventListener("change", function (e) {
          push.on = !!(e && e.current && e.current.optedIn);
          render();
        });
        render();
        setTimeout(askPush, 1200);
      }).catch(function (err) {
        push.failed = true;
        push.err = String((err && (err.message || err)) || "").slice(0, 200);
        render();
      });
    });
  }
  function togglePush() {
    var OS = push.os;
    if (!OS || push.busy) return;
    push.busy = true; render();
    var p = push.on ? OS.User.PushSubscription.optOut() :
      Promise.resolve(OS.Notifications.permission ? null : OS.Notifications.requestPermission())
        .then(function () { return OS.User.PushSubscription.optIn(); });
    Promise.resolve(p).catch(function () { /* they said no */ }).then(function () {
      push.on = !!OS.User.PushSubscription.optedIn;
      push.busy = false; render();
    });
  }
  // Asks once, the first time notifications can be turned on: "Turn on" or "Not now".
  // The 🔔 card on the Lift Club and Profile tabs is always there to change it later.
  function askPush() {
    var asked = load(KEY_PUSH_ASKED, []);
    if (!push.ready || !push.supported || push.on || asked.indexOf(state.code) !== -1) return;
    if (window.Notification && Notification.permission === "denied") return;
    if (document.querySelector(".pb-pop")) { setTimeout(askPush, 3000); return; } // wait for another pop-up to close
    asked.push(state.code);
    save(KEY_PUSH_ASKED, asked);
    var el = document.createElement("div");
    el.className = "pb-pop push-pop";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Lift Club notifications");
    el.innerHTML = '<div class="coach-pop-card push-pop-card"><div class="push-pop-bell" aria-hidden="true">🔔</div>' +
      "<h2>" + (isOnline() ? "Get notified about your check-in and the Lift Club?" : "Get notified when someone posts in the Lift Club?") + "</h2>" +
      '<p class="muted">' + (isOnline() ? "You'll get a reminder when your weekly check-in opens on Friday, plus new Lift Club posts and replies to yours."
        : "You'll get a notification for new posts and replies to yours.") + " You can turn it off any time on your Profile tab.</p>" +
      '<button class="btn primary" data-push-yes>Turn on</button><button class="btn ghost" data-push-no>Not now</button></div>';
    document.body.appendChild(el);
    el.addEventListener("click", function (e) {
      if (e.target.closest("[data-push-yes]")) { el.remove(); if (!push.on) togglePush(); }
      else if (e.target === el || e.target.closest("[data-push-no]")) el.remove();
    });
  }
  function pushCardHtml() {
    if (!pushAppId() || !canSend()) return "";
    var body, btn = "";
    if (isIOS && !isStandalone) {
      body = "To get a notification when someone posts, add this app to your home screen first (tap the Share button, then Add to Home Screen). Then open it from there and turn notifications on here.";
    } else if (push.failed) {
      body = "Notifications aren't available on this phone right now." + (push.err ? " (" + push.err + ")" : "");
      btn = '<button class="btn small ghost" data-push-retry>Try again</button>';
    } else if (!push.ready) {
      return "";
    } else if (!push.supported) {
      body = "This browser can't show notifications. Try opening the app from your home screen.";
    } else if (push.on) {
      body = "Notifications are on. You'll hear about new posts in the Lift Club and replies to your posts" + (isOnline() ? ", plus your weekly check-in reminders." : ".");
      btn = '<button class="btn small ghost" data-push-toggle>' + (push.busy ? "…" : "Turn off") + "</button>";
    } else if (window.Notification && Notification.permission === "denied") {
      body = "Notifications are blocked for this app. Turn them on in your phone's settings, then come back here.";
    } else {
      body = "Get a notification when someone posts in the Lift Club or replies to you" + (isOnline() ? ", and a reminder when your weekly check-in opens." : ".");
      btn = '<button class="btn small primary" data-push-toggle>' + (push.busy ? "…" : "Turn on notifications") + "</button>";
    }
    return '<section class="card push-card"><div><strong>🔔 Notifications</strong><p class="muted small">' + esc(body) + "</p></div>" + btn + "</section>";
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("[data-push-toggle]")) togglePush();
    if (e.target.closest && e.target.closest("[data-push-retry]")) location.reload();
  });

  // A small card on the Program tab until they've filled in their profile.
  function renderProfileNudge() {
    var el = $("profileNudge");
    var showIt = state.data && profileNeedsFilling() && !hasProfileData(getProfile());
    el.classList.toggle("hidden", !showIt);
    if (!showIt) return;
    if (isCoach()) {
      el.innerHTML = "<div><strong>Set up your coach profile</strong><div>Add a photo and a bit about you. Clients see it on their ScoutCo HQ tab.</div></div>" +
        '<button class="btn primary" data-goto-profile>Set up my profile</button>';
      return;
    }
    el.innerHTML = "<div><strong>Tell " + esc(COACH) + " about you</strong>" +
      "<div>Add a photo, your 1RMs, goals and favourite food. Takes 2 minutes.</div></div>" +
      '<button class="btn primary" data-goto-profile>Fill in my profile</button>';
  }

  // ---------- client agreement ----------
  // Kirst adds a row on the Agreements tab and ticks "Send to app". The client reads it here,
  // with their own details filled in, and signs by typing their name. They only sign once.
  var POLICIES_URL = "https://www.scoutco.com.au/policies";
  function agreement() { return !isCoach() && state.data && state.data.agreement && state.data.agreement.id ? state.data.agreement : null; }
  function localSigned() {
    var a = agreement(), s = load(KEY_AGREE, null);
    return a && s && s.code === state.code && s.id === a.id ? s : null;
  }
  function agreementSigned() { var a = agreement(); return !!(a && (a.signed || localSigned())); }
  function agreementDue() { return !!agreement() && !agreementSigned(); }
  function agOnline(a) { return /online/i.test(String(a.type || "")); }

  function agreementTerms(a) {
    var online = agOnline(a);
    var renewal = [
      "You sign up for one 12-week block at a time.",
      "Your membership renews automatically for another 12-week block at the end of each block, unless you or " + COACH + " ends it.",
      "You only sign this agreement once. It carries over to every new block, so you don't need to sign again.",
      "About 3 weeks before each block ends, " + COACH + " will send you a renewal notice with your next block's start date, " +
        (online ? "" : "session time, ") + "price and payment details. Anything new in it applies from the next block. Price changes always come with at least 4 weeks' notice.",
      "If you don't want to renew, tell " + COACH + " at least 2 weeks before your block ends."
    ];
    var payment = [
      "The price is for the whole 12-week service" + (online ? "" : ", not per session") + ". Paying weekly or fortnightly is just a convenience.",
      "Upfront: you'll get an invoice for the full block at the start, paid by bank transfer.",
      "Weekly or fortnightly: an equal share of the block price is charged automatically through Acuity (payments processed by Stripe).",
      online ? "Payments are due for the whole block whether or not you complete every session or check-in."
        : "You pay for every session in the block whether you attend or not. Missed sessions aren't refunded or credited.",
      online ? "No refunds for change of mind once a block has started. Refunds are only given when " + COACH + " can't deliver the service, or as Australian Consumer Law requires."
        : "No refunds for change of mind once a block has started. Refunds are only given when " + COACH + " cancels and can't reschedule, or as Australian Consumer Law requires.",
      "If a payment doesn't go through, " + (online ? "coaching" : "sessions") + " may be paused until your account is up to date.",
      "Prices only change from your next block, with at least 4 weeks' notice. ScoutCo isn't registered for GST, so no GST is charged."
    ];
    var terms = online ? [
      ["What you get", [
        "A 12-week block of online strength and conditioning coaching.",
        "A training program written for you, delivered through the ScoutCo app.",
        "A weekly check-in in the app, with a reply from " + COACH + ".",
        "Form-check feedback on videos you send through the app.",
        "A check-in call with " + COACH + " near the end of each 4-week phase, booked through the link in the app."]],
      ["Your 12-week block and renewal", renewal],
      ["Training on your own and check-in calls", [
        "You train in your own time, so warm up, use safe equipment and a clear space, and only lift weights you can control. If you're unsure about a lift, send a form video before going heavier.",
        "To change a booked check-in call, use the link in your booking email, with as much notice as you can.",
        "If " + COACH + " cancels a call, it will be rescheduled."]],
      ["Payment", payment],
      ["Health and safety", [
        "You'll complete the ScoutCo intake form honestly before you start, and tell " + COACH + " about any change in your health, injuries, medications or pregnancy.",
        "If you have health issues that affect training, it's your responsibility to seek medical advice.",
        "Stop and tell " + COACH + " about pain, dizziness or anything that doesn't feel right.",
        "Strength training carries some risk of soreness, strains or, rarely, more serious injury. Because you train without " + COACH + " there, you agree to follow the program as written and train within your limits."]]
    ] : [
      ["What you get", [
        "A 12-week block of strength and conditioning coaching, with one face-to-face session at your set time each " + (/fortnight/i.test(a.type || "") ? "fortnight" : "week") + ".",
        "A training program written for you, delivered through the ScoutCo app.",
        "Support from " + COACH + " between sessions through the app."]],
      ["Your 12-week block and renewal", renewal],
      ["Your session time", [
        "Your set day and time is held just for you for the whole block. There are no other regular session times.",
        "If you can't make a session, let " + COACH + " know as early as you can. A make-up session may be offered if there's space, but it isn't guaranteed.",
        "If " + COACH + " cancels, your session will be rescheduled, or refunded pro-rata if a new time can't be found."]],
      ["Payment", payment],
      ["Health and safety", [
        "You'll complete the ScoutCo intake form honestly before your first session, and tell " + COACH + " about any change in your health, injuries, medications or pregnancy.",
        "If you have health issues that affect training, it's your responsibility to seek medical advice.",
        "Tell " + COACH + " straight away about pain, dizziness or anything that doesn't feel right.",
        "Strength training carries some risk of soreness, strains or, rarely, more serious injury. " + COACH + " will coach you to train safely, and you agree to train within your limits."]]
    ];
    terms.push(["Ending the agreement", [
      "Either of us can end the agreement by giving at least 2 weeks' notice before the end of the current block.",
      COACH + " may end the agreement if the policies are repeatedly not followed, or if continuing isn't safe. You'll be given notice and refunded any unused " + (online ? "part of the block" : "sessions") + " pro-rata."]]);
    terms.push(["ScoutCo policies", [
      "This agreement includes the ScoutCo policies at scoutco.com.au/policies: Cancellations, Payments and refunds, Privacy, Health and safety, Lift Club guidelines, and Terms of service.",
      "Policy changes are announced at least 14 days ahead on ScoutCo's social media and in the app.",
      "Nothing in this agreement limits your rights under the Australian Consumer Law. This agreement is governed by Queensland law."]]);
    return terms;
  }
  var AG_PARENT = [
    "I have read the client's ScoutCo agreement and the ScoutCo policies at scoutco.com.au/policies, and I agree to them on the client's behalf.",
    "I have completed, or helped complete, the ScoutCo intake form honestly, and I'll tell " + COACH + " about any change in the client's health.",
    "I am responsible for payment for each 12-week block, and for giving 2 weeks' notice if we don't want to renew.",
    "I am responsible for getting the client to and from face-to-face sessions on time, and for their supervision before and after.",
    COACH + " may contact me about the client's training, health or safety.",
    "Everyone on the ScoutCo app, including clients under 18, has access to Lift Club. I agree to my child using Lift Club and following the Lift Club community guidelines.",
    "Kirsty McCall holds a current Queensland blue card (Working with Children Check)."
  ];
  function agPartyLine(name) {
    return "Between ScoutCo (Scout Coaching & Therapy), run by Kirsty McCall (\"" + COACH + "\"), ABN 67 991 210 286, Logan QLD, Kirsty@scoutco.com.au, and " + (name || "the client") + ".";
  }
  function agDetails(a) {
    var rows = [["Agreement", a.type], ["Start date", a.start]];
    if (!agOnline(a)) rows.push(["Session day and time", a.time]);
    rows.push(["Price per 12-week block", a.price], ["How you'll pay", a.payment]);
    return rows.filter(function (r) { return String(r[1] || "").trim(); });
  }
  function agMediaChoices(a) {
    return a.under18 ? ["Yes, my child may be featured (first name only, never their full name or school)", "No thanks"]
      : ["Yes, I'm happy to be featured in ScoutCo media", "No thanks"];
  }
  // The exact words the client agreed to, saved on the Agreements tab as their copy.
  function agreementText(a, d) {
    var client = (state.data && state.data.client) || {};
    var out = ["ScoutCo " + (agOnline(a) ? "online" : "face-to-face") + " coaching agreement", agPartyLine(client.name), ""];
    agDetails(a).forEach(function (r) { out.push(r[0] + ": " + r[1]); });
    agreementTerms(a).forEach(function (t, i) {
      out.push("", (i + 1) + ". " + t[0]);
      t[1].forEach(function (p) { out.push("- " + p); });
    });
    out.push("", "Photos and videos for ScoutCo media: " + (d.media || ""));
    if (a.under18) {
      out.push("", "Parent or guardian consent");
      AG_PARENT.forEach(function (p) { out.push("- " + p); });
      out.push("Parent or guardian: " + d.parentName + " (" + d.relationship + "), " + d.parentContact + (d.emergency ? ". Emergency contact: " + d.emergency : ""));
    }
    out.push("", "Signed by typing their name: " + d.name + (a.under18 ? " and " + d.parentName + " (parent or guardian)" : ""));
    return out.join("\n");
  }

  function renderAgreement() {
    var a = agreement();
    if (!a) { $("agreementPane").innerHTML = ""; return; }
    var client = (state.data && state.data.client) || {};
    var mine = localSigned();
    var signed = agreementSigned();
    var pending = load(KEY_OUTBOX, []).some(function (x) { return x.type === "agreement"; });
    var details = '<dl class="ag-details">' + agDetails(a).map(function (r) {
      return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>";
    }).join("") + "</dl>";
    var terms = agreementTerms(a).map(function (t, i) {
      return "<h4>" + (i + 1) + ". " + esc(t[0]) + '</h4><ul class="ag-terms">' + t[1].map(function (p) {
        return "<li>" + esc(p).replace("scoutco.com.au/policies", '<a href="' + POLICIES_URL + '" target="_blank" rel="noopener">scoutco.com.au/policies</a>') + "</li>";
      }).join("") + "</ul>";
    }).join("");
    var head = "<h2>Your ScoutCo agreement</h2>" +
      '<p class="muted small">' + esc(agPartyLine(client.name)) + "</p>" + details;

    if (signed) {
      var by = (mine && mine.name) || a.signedBy || "";
      var on = (mine && mine.at) || a.signedOn || 0;
      var media = (mine && mine.media) || a.media || "";
      $("agreementPane").innerHTML =
        '<section class="card ag-signed"><div class="ag-tick" aria-hidden="true">✓</div><div><strong>Signed' +
          (by ? " by " + esc(by) : "") + "</strong>" +
          '<div class="small muted">' + (on ? esc(new Date(+on).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })) : "") +
          (pending && canSend() ? " · Sending to " + esc(COACH) + "…" : "") + "</div></div></section>" +
        '<section class="card">' + head +
          '<details class="ag-more"><summary>Read the full agreement</summary>' + terms + "</details>" +
          (media ? '<p class="small"><b>Photos and videos:</b> ' + esc(media) + "</p>" : "") +
          (renewal() ? '<div class="book-call ag-renew">' + renewalHtml(renewal(), false) + "</div>" : "") +
          '<p class="muted small">You don\'t need to sign again when your block renews. To change your photo choice or anything else, just tell ' + esc(COACH) + ".</p>" +
        "</section>";
      return;
    }

    if (!state.ag || state.ag.id !== a.id) state.ag = { id: a.id };
    var d = state.ag;
    var radio = function (val) {
      return '<label class="ag-choice"><input type="radio" name="ag-media" data-ag-media value="' + esc(val) + '"' + (d.media === val ? " checked" : "") + "> <span>" + esc(val) + "</span></label>";
    };
    var input = function (id, label, placeholder, opt) {
      return '<label class="ci-label" for="ag-' + id + '">' + esc(label) + (opt ? ' <span class="muted">(optional)</span>' : "") + "</label>" +
        '<input id="ag-' + id + '" class="ci-input" data-ag="' + id + '" type="text" maxlength="200" autocomplete="off" placeholder="' + esc(placeholder) + '" value="' + esc(d[id] || "") + '">';
    };
    $("agreementPane").innerHTML =
      '<section class="card">' + head +
        '<p class="small">Please read it all. If anything is unclear, ask ' + esc(COACH) + " before you sign.</p>" +
        terms +
      "</section>" +
      '<section class="card">' +
        "<h3>Photos and videos for ScoutCo media</h3>" +
        '<p class="muted small">ScoutCo would love to share your wins. With your OK, photos or videos of ' + (a.under18 ? "your child" : "you") +
          " training may be used on ScoutCo's website and social media. You can change your mind any time by telling " + esc(COACH) + ".</p>" +
        agMediaChoices(a).map(radio).join("") +
      "</section>" +
      (a.under18 ?
        '<section class="card"><h3>Parent or guardian consent</h3>' +
          '<p class="muted small">The client is under 18, so a parent or legal guardian fills in this part. As the parent or guardian, I agree that:</p>' +
          '<ul class="ag-terms">' + AG_PARENT.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>" +
          input("parentName", "Parent or guardian full name (your signature)", "Type your full name") +
          input("relationship", "Relationship to client", "e.g. Mum") +
          input("parentContact", "Parent or guardian phone and email", "") +
          input("emergency", "Emergency contact name and phone, if different", "", true) +
          '<label class="ag-check"><input type="checkbox" data-ag-check="parentAgree"' + (d.parentAgree ? " checked" : "") +
            "> <span>I agree, as the client's parent or guardian. Typing my name above is my signature.</span></label>" +
        "</section>" : "") +
      '<section class="card"><h3>Sign</h3>' +
        '<label class="ag-check"><input type="checkbox" data-ag-check="agree"' + (d.agree ? " checked" : "") +
          "> <span>I have read and agree to my ScoutCo agreement and the ScoutCo policies.</span></label>" +
        input("name", "Type your full name as your signature", "Your full name") +
        (d.error ? '<p class="error">' + esc(d.error) + "</p>" : "") +
        '<div class="ci-actions"><span class="small muted">Date: ' + esc(new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })) + "</span>" +
          '<button class="btn primary" data-ag-sign>Sign agreement</button></div>' +
      "</section>";
  }

  function signAgreement() {
    var a = agreement(), d = state.ag;
    if (!a || !d) return;
    ["name", "parentName", "relationship", "parentContact", "emergency"].forEach(function (f) { d[f] = String(d[f] || "").trim().slice(0, 200); });
    var miss = [];
    if (!d.media) miss.push("choose yes or no for photos and videos");
    if (a.under18) {
      if (!d.parentName) miss.push("add the parent or guardian's name");
      if (!d.relationship) miss.push("add their relationship to you");
      if (!d.parentContact) miss.push("add their phone and email");
      if (!d.parentAgree) miss.push("tick the parent or guardian box");
    }
    if (!d.agree) miss.push("tick the box to agree");
    if (d.name.length < 2) miss.push("type your full name");
    if (miss.length) {
      d.error = "Please " + miss.join(", ") + ".";
      render();
      return;
    }
    d.error = "";
    queue({ type: "agreement", key: a.id, media: d.media, name: d.name, parentName: a.under18 ? d.parentName : "",
      relationship: a.under18 ? d.relationship : "", parentContact: a.under18 ? d.parentContact : "",
      emergency: a.under18 ? d.emergency : "", text: agreementText(a, d) });
    save(KEY_AGREE, { code: state.code, id: a.id, name: d.name, media: d.media, at: Date.now() });
    state.ag = null;
    render();
    window.scrollTo(0, 0);
  }

  // A card on the Program tab until they've signed.
  function renderAgreeNudge() {
    var el = $("agreeNudge"), due = agreementDue();
    el.classList.toggle("hidden", !due);
    if (!due) return;
    el.innerHTML = "<div><strong>Your agreement is ready to sign</strong>" +
      "<div>Read your ScoutCo agreement and sign it in the app. It takes about 5 minutes, and you only do it once.</div></div>" +
      '<button class="btn primary" data-goto-agreement>Read and sign</button>';
  }

  // ---------- renewal notice ----------
  // Before a client's next block, Kirst ticks a row on the Renewals tab and it shows here. Nothing to sign.
  function renewal() { return !isCoach() && state.data && state.data.renewal && state.data.renewal.id ? state.data.renewal : null; }
  function renewalSeen() {
    var r = renewal(), s = load(KEY_RENEW, null);
    return !!(r && (r.seen || (s && s.code === state.code && s.id === r.id)));
  }
  function renewalHtml(r, withButton) {
    var rows = [["Session day and time", r.time], ["Price for the 12-week block", r.price], ["Payment", r.payment]]
      .filter(function (x) { return String(x[1] || "").trim(); });
    return "<div><strong>Your next block starts " + esc(r.start) + "</strong>" +
      (rows.length ? '<dl class="ag-details">' + rows.map(function (x) { return "<dt>" + esc(x[0]) + "</dt><dd>" + esc(x[1]) + "</dd>"; }).join("") + "</dl>" : "") +
      "<div>Everything else stays the same as your ScoutCo agreement. There's nothing you need to do to keep going. " +
      "If you'd like to change anything, let " + esc(COACH) + " know by " + esc(r.replyBy) + ".</div></div>" +
      (withButton ? '<button class="btn primary" data-renew-ok>Got it</button>' : "");
  }
  function renderRenewNote() {
    var el = $("renewNote"), r = renewal(), showIt = !!r && !renewalSeen();
    el.classList.toggle("hidden", !showIt);
    if (showIt) el.innerHTML = renewalHtml(r, true);
  }
  function renewalOk() {
    var r = renewal();
    if (!r) return;
    queue({ type: "renewal", key: r.id });
    save(KEY_RENEW, { code: state.code, id: r.id, at: Date.now() });
    render();
  }

  // ---------- coach message reactions ----------
  // Clients tap one to show Kirst they've seen her message. It saves to the Clients tab,
  // and clears by itself when she writes a new message.
  var MSG_REACTIONS = ["👍", "❤️", "💪", "🔥", "🙌"];
  function msgReactions() {
    var r = state.data && state.data.client && state.data.client.reactions;
    return r && r.length ? r : MSG_REACTIONS;
  }
  // Their pick for the message showing now: what they tapped on this phone, else what the sheet has.
  function myMsgReaction() {
    var c = (state.data && state.data.client) || {}, msg = String(c.message || "").trim();
    var s = load(KEY_MSG_REACT, null);
    if (s && s.code === state.code && s.msg === msg) return s.emoji || "";
    return (c.reaction && c.reaction.emoji) || "";
  }
  function msgReactHtml() {
    var mine = myMsgReaction();
    return '<div class="msg-react" role="group" aria-label="React to this message">' +
      msgReactions().map(function (e) {
        var on = e === mine;
        return '<button class="comm-react' + (on ? " on" : "") + '" data-msg-react="' + esc(e) + '" aria-pressed="' + on + '">' + esc(e) + "</button>";
      }).join("") +
      '<span class="msg-react-hint">' + (mine ? "Seen ✓" : "Tap to let " + esc(COACH) + " know you've seen it") + "</span></div>";
  }
  function reactToMessage(emoji) {
    var msg = String((state.data && state.data.client && state.data.client.message) || "").trim();
    if (!msg) return;
    var next = myMsgReaction() === emoji ? "" : emoji; // tap your pick again to take it off
    save(KEY_MSG_REACT, { code: state.code, msg: msg, emoji: next });
    queue({ type: "msgreact", key: "msg", emoji: next, msg: msg });
    render();
  }

  // ---------- rendering ----------
  function render() {
    // Keep the cursor in a comment box if the screen redraws while someone is typing.
    var active = document.activeElement;
    var attr = active && active.getAttribute && (active.getAttribute("data-comment") != null ? "data-comment" :
      active.getAttribute("data-weight") != null ? "data-weight" :
      active.getAttribute("data-ci") != null ? "data-ci" :
      active.getAttribute("data-prof") != null ? "data-prof" :
      active.getAttribute("data-ag") != null ? "data-ag" :
      active.getAttribute("data-todo-new") != null ? "data-todo-new" :
      active.getAttribute("data-comm-new") != null ? "data-comm-new" :
      active.getAttribute("data-comm-reply-text") != null ? "data-comm-reply-text" :
      active.getAttribute("data-vid-reply-text") != null ? "data-vid-reply-text" :
      active.getAttribute("data-vid-note") != null ? "data-vid-note" :
      active.getAttribute("data-vid-lift") != null ? "data-vid-lift" : null);
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
    var myPhoto = safePhoto(getProfile().photo);
    $("helloPhoto").innerHTML = myPhoto ? '<img src="' + esc(myPhoto) + '" alt="">' : "";
    $("helloPhoto").classList.toggle("hidden", !myPhoto);
    // Clients: Kirst's photo at the top. Tap it to see her profile.
    var showChip = !isCoach() && !!coachCardHtml();
    var chipPhoto = showChip ? safePhoto(coachInfo().photo) : "";
    $("coachChip").innerHTML = showChip ? (chipPhoto ? '<img src="' + esc(chipPhoto) + '" alt="">' : "<span>" + esc(initials(COACH)) + "</span>") +
      "<small>" + esc(COACH) + "</small>" : "";
    $("coachChip").classList.toggle("hidden", !showChip);
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
    if (state.view === "profile") { renderProfile(); $("profilePane").insertAdjacentHTML("beforeend", pushCardHtml()); }
    if (state.view === "clients") renderClients();
    if (state.view === "community") renderCommunity();
    if (state.view === "videos") renderVideos();
    if (state.view === "agreement") renderAgreement();
    renderProfileNudge();
    renderAgreeNudge();
    renderRenewNote();

    var note = $("coachNote");
    if (client.message) {
      var cPhoto = isCoach() ? "" : safePhoto(coachInfo().photo);
      note.innerHTML = (cPhoto ? '<button class="note-photo" data-coach-open aria-label="About ' + esc(COACH) + '"><img src="' + esc(cPhoto) + '" alt=""></button>' : "") + "<strong>From " + esc(COACH) + "</strong>" + esc(client.message) +
        (isCoach() ? "" : msgReactHtml());
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
    var swaps = isCoach() ? {} : getSwaps();
    $("days").innerHTML = !week ? "" : week.days.map(function (day, di) {
      var done = 0;
      var dayKey = scope(week.name, day.name);
      var where = { block: state.block || "", week: week.name, session: day.name };
      state.info[dayKey] = where;
      var swappable = 0, swapped = 0;
      day.exercises.forEach(function (ex, i) {
        if (isCoach() || !ex.home || !ex.home.name) return;
        swappable++;
        if (swaps[tickKey(week.name, day.name, i)]) swapped++;
      });
      var items = day.exercises.map(function (ex, i) {
        var k = tickKey(week.name, day.name, i);
        var sw = isCoach() ? null : activeSwap(ex, k, swaps);
        state.info[k] = { block: where.block, week: where.week, session: where.session,
          exercise: (ex.label ? ex.label + " " : "") + ex.name, name: sw ? sw.name : ex.name, swap: sw ? sw.name : "",
          home: isCoach() ? null : ex.home, reps: ex.reps, key: k.slice(state.code.length + 1) };
        var isDone = !!ticks[k];
        if (isDone) done++;
        return exerciseHtml(ex, k, isDone, weights, sw, swapped > 0);
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
        '<div class="day-body">' +
          (swappable ? swapAllHtml(dayKey, swapped === swappable) : "") + items +
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

  // "Training at home today?" at the top of a session: swaps every exercise that has a home version.
  function swapAllHtml(dayKey, allSwapped) {
    return '<div class="swap-all">' +
      (allSwapped
        ? '<span>Home version of this session</span><button class="btn small ghost" data-swapall="' + esc(dayKey) + '">Back to gym</button>'
        : '<span>Can\'t get to the gym today?</span><button class="btn small" data-swapall="' + esc(dayKey) + '">⇄ Swap all for home</button>') +
    "</div>";
  }

  // sw: the home version being shown instead (or null). homeDay: something in this session is swapped.
  function exerciseHtml(ex, key, isDone, weights, sw, homeDay) {
    var name = sw ? sw.name : ex.name;
    var stats = [
      ["Sets", ex.sets], ["Reps", ex.reps], ["Load", sw ? "" : ex.load], ["Tempo", ex.tempo], ["Rest", ex.rest]
    ].filter(function (s) { return s[1] !== "" && s[1] != null; })
      .map(function (s) { return '<span class="stat"><b>' + s[0] + "</b>" + esc(s[1]) + "</span>"; }).join("");
    var video = safeUrl(sw ? sw.video : ex.video);
    var notes = sw ? sw.how : ex.notes;
    var swapLine = "";
    if (sw) {
      swapLine = '<div class="ex-swap on"><span class="swap-tag">Home swap</span><span class="muted">instead of ' + esc(ex.name) + "</span>" +
        '<button class="link-btn" data-swap="' + esc(key) + '">Back to gym version</button></div>';
    } else if (ex.home && ex.home.name && !isCoach()) {
      swapLine = '<div class="ex-swap"><button class="swap-btn" data-swap="' + esc(key) + '">⇄ Swap for home</button></div>';
    } else if (ex.locked && homeDay) {
      swapLine = '<div class="ex-swap"><span class="muted small">🔒 Gym only, this one can\'t be swapped</span></div>';
    }
    // The main lifts are taught in person, not from videos.
    var book = safeUrl(CONFIG.techniqueBookingUrl);
    if (!sw && !isCoach() && liftOf(ex.name)) {
      swapLine += '<div class="ex-formvid"><button class="swap-btn" data-formvid="' + esc(key) + '">🎥 Send ' + esc(COACH) + " a form video</button>" +
        '<p class="vid-tip">' + esc(TRIM_TIP) + "</p></div>";
    }
    if (ex.locked && !sw && !isCoach()) {
      swapLine += '<div class="ex-technique">Not confident on your form? ' +
        (book ? '<a href="' + esc(book) + '" target="_blank" rel="noopener">Book a session with ' + esc(COACH) + "</a>" : "Book a session with " + esc(COACH)) +
        " to learn the technique.</div>";
    }
    return '<div class="ex' + (isDone ? " done" : "") + (sw ? " swapped" : "") + '">' +
      '<button class="check" data-tick="' + esc(key) + '" aria-pressed="' + isDone + '" aria-label="Mark ' + esc(name) + ' done">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0b1a14" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>' +
      "</button>" +
      '<div class="ex-main">' +
        '<div class="ex-name">' + (ex.label ? '<span class="ex-label">' + esc(ex.label) + "</span>" : "") + esc(name) + "</div>" +
        (stats ? '<div class="ex-stats">' + stats + "</div>" : "") +
        (notes ? '<div class="ex-notes">' + esc(notes) + "</div>" : "") +
        (video ? '<a class="ex-video" href="' + esc(video) + '" target="_blank" rel="noopener">' +
          (/youtube\.com\/results/.test(video) ? "▶ Demo videos on YouTube" : "▶ Watch demo") + "</a>" : "") +
        swapLine +
        weightHtml(ex, key, weights, name) +
      "</div>" +
    "</div>";
  }

  // name: the exercise as shown (the home swap if swapped), so "Last time" matches what they're doing.
  function weightHtml(ex, key, weights, name) {
    var saved = weights[key];
    var value = state.weightDrafts[key] != null ? state.weightDrafts[key] : (saved ? saved.w : "");
    var prev = lastTime(key, name || ex.name, weights);
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
    if (state.view === "community") fetchCommunity();
    render();
    window.scrollTo(0, 0);
  });

  $("videosPane").addEventListener("input", function (e) {
    var t = e.target;
    if (!t.getAttribute) return;
    if (t.getAttribute("data-vid-note") != null) state.vidNote = t.value;
    if (t.getAttribute("data-vid-lift") != null) state.vidLift = t.value;
    if (t.getAttribute("data-vid-reply-text") != null) state.vidReplyDraft = t.value;
  });
  $("videosPane").addEventListener("change", function (e) {
    var t = e.target;
    if (!t.getAttribute) return;
    if (t.getAttribute("data-vid-to") != null) { state.vidTo = t.value; render(); }
    if (t.getAttribute("data-vid-form-lift") != null) state.vidLift = t.value;
  });
  $("videosPane").addEventListener("click", function (e) {
    var b;
    if ((b = e.target.closest("[data-vid-play]"))) { state.playing = b.getAttribute("data-vid-play"); render(); return; }
    if (e.target.closest("[data-vid-pick]")) {
      if (isCoach()) {
        var c = ((state.data && state.data.clients) || []).filter(function (x) { return x.vid && x.vid === state.vidTo; })[0];
        if (!c) { window.alert("Pick the client it's for first."); return; }
        pickVideo(function (file) { uploadVideo(file, { to: c.vid, toName: c.name, lift: state.vidLift.trim(), note: state.vidNote.trim() }); });
      } else {
        if (VIDEO_LIFTS.indexOf(state.vidLift) === -1) { window.alert("Pick which lift it is first."); return; }
        pickVideo(function (file) { uploadVideo(file, { lift: state.vidLift, note: state.vidNote.trim() }); });
      }
      return;
    }
    if ((b = e.target.closest("[data-vid-reply]"))) {
      var rid = b.getAttribute("data-vid-reply");
      var rv = videoList().filter(function (v) { return v.id === rid; })[0];
      state.vidReplyOpen = state.vidReplyOpen === rid ? null : rid;
      state.vidReplyDraft = rv ? rv.reply || "" : "";
      render();
      var box = document.querySelector('[data-vid-reply-text="' + CSS.escape(rid) + '"]');
      if (box) box.focus();
      return;
    }
    if ((b = e.target.closest("[data-vid-send-reply]"))) {
      var to = b.getAttribute("data-vid-send-reply"), text = state.vidReplyDraft.trim();
      if (!text) return;
      if (!canSend()) { window.alert("Replies work once you open the app with your own code."); return; }
      queue({ type: "videoreply", key: to, video: to, text: text });
      videoDone.reply[to] = text;
      state.vidReplyOpen = null; state.vidReplyDraft = "";
      render();
      return;
    }
    if ((b = e.target.closest("[data-vid-del]"))) {
      if (!window.confirm(isCoach() ? "Remove this video? It comes out of the app and goes to the bin in your Google Drive." : "Remove this video? " + COACH + " won't see it any more.")) return;
      var vid = b.getAttribute("data-vid-del");
      if (!canSend()) return;
      queue({ type: "videohide", video: vid });
      videoDone.hide[vid] = 1;
      videoJustSent = videoJustSent.filter(function (v) { return v.id !== vid; });
      if (state.playing === vid) state.playing = null;
      render();
    }
  });

  $("communityPane").addEventListener("input", function (e) {
    var t = e.target;
    if (!t.getAttribute) return;
    if (t.getAttribute("data-comm-new") != null) { state.commDraft = t.value; state.commMsg = ""; }
    if (t.getAttribute("data-comm-reply-text") != null) state.commReplyDraft = t.value;
  });
  $("communityPane").addEventListener("click", function (e) {
    var b;
    if (e.target.closest("[data-comm-post]")) {
      var text = state.commDraft.trim();
      var ph = state.commPhoto;
      if (ph && ph.busy) { state.commMsg = "Wait for your photo to finish uploading."; render(); return; }
      if (ph && !ph.file) { state.commMsg = "Your photo didn't upload. Remove it or try again."; render(); return; }
      if (!text && !ph) { state.commMsg = "Type something or add a photo first."; render(); return; }
      var ev = { type: "post", text: text.slice(0, 2000) };
      if (ph) ev.photo = ph.file;
      if (commSend(ev)) { state.commDraft = ""; state.commMsg = ""; state.commPhoto = null; render(); }
      return;
    }
    if (e.target.closest("[data-comm-photo-add]")) { pickCommPhoto(); return; }
    if (e.target.closest("[data-comm-photo-del]")) { state.commPhoto = null; state.commMsg = ""; render(); return; }
    if ((b = e.target.closest("[data-comm-photo-view]"))) { showPhoto(b.getAttribute("data-comm-photo-view")); return; }
    if ((b = e.target.closest("[data-comm-react]"))) {
      var id = b.getAttribute("data-comm-react"), emoji = b.getAttribute("data-emoji");
      var p = commFeed().tops.filter(function (x) { return x.id === id; })[0];
      if (p) { commSend({ type: "react", post: id, emoji: emoji, on: p.mine.indexOf(emoji) === -1 }); render(); }
      return;
    }
    if ((b = e.target.closest("[data-comm-reply]"))) {
      var rid = b.getAttribute("data-comm-reply");
      if (state.commReply !== rid) { state.commReply = rid; state.commReplyDraft = ""; }
      else state.commReply = null;
      render();
      var box = document.querySelector('[data-comm-reply-text="' + CSS.escape(rid) + '"]');
      if (box) box.focus();
      return;
    }
    if ((b = e.target.closest("[data-comm-send-reply]"))) {
      var to = b.getAttribute("data-comm-send-reply"), reply = state.commReplyDraft.trim();
      if (!reply) return;
      if (commSend({ type: "post", text: reply.slice(0, 2000), parent: to })) { state.commReply = null; state.commReplyDraft = ""; render(); }
      return;
    }
    if ((b = e.target.closest("[data-comm-del]"))) {
      if (window.confirm("Delete your post?")) { commSend({ type: "unpost", post: b.getAttribute("data-comm-del") }); render(); }
      return;
    }
    if ((b = e.target.closest("[data-comm-hide]"))) {
      if (window.confirm("Hide this post from everyone? You can bring it back by unticking Hide on the Lift Club Community tab of your sheet.")) {
        commSend({ type: "unpost", post: b.getAttribute("data-comm-hide") }); render();
      }
    }
  });
  // New posts show up while the Lift Club is open.
  setInterval(function () {
    if (state.view === "community" && document.visibilityState === "visible" && state.code) fetchCommunity();
  }, 60000);

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

  $("profilePane").addEventListener("input", function (e) {
    var f = e.target.getAttribute && e.target.getAttribute("data-prof");
    if (f && state.prof) { state.prof[f] = e.target.value; state.profMsg = ""; }
  });
  $("profilePane").addEventListener("change", function (e) {
    if (!e.target.hasAttribute || !e.target.hasAttribute("data-prof-photo")) return;
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    shrinkPhoto(file).then(function (photo) {
      if (!photo) throw new Error("too big");
      setPhoto(photo);
    }).catch(function () {
      state.profMsg = "Couldn't use that photo. Try a different one.";
      render();
    });
  });
  $("profilePane").addEventListener("click", function (e) {
    if (e.target.closest("[data-prof-save]")) { saveProfile(); return; }
    if (e.target.closest("[data-prof-photo-del]") && window.confirm("Remove your photo?")) setPhoto("");
  });
  $("coachNote").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-msg-react]");
    if (b) reactToMessage(b.getAttribute("data-msg-react"));
  });
  $("renewNote").addEventListener("click", function (e) {
    if (e.target.closest("[data-renew-ok]")) renewalOk();
  });
  $("agreeNudge").addEventListener("click", function (e) {
    if (!e.target.closest("[data-goto-agreement]")) return;
    state.view = "agreement";
    render();
    window.scrollTo(0, 0);
  });
  $("agreementPane").addEventListener("input", function (e) {
    var f = e.target.getAttribute && e.target.getAttribute("data-ag");
    if (f && state.ag) state.ag[f] = e.target.value;
  });
  $("agreementPane").addEventListener("change", function (e) {
    var t = e.target;
    if (!state.ag || !t.getAttribute) return;
    if (t.getAttribute("data-ag-media") != null) state.ag.media = t.value;
    var c = t.getAttribute("data-ag-check");
    if (c) state.ag[c] = t.checked;
  });
  $("agreementPane").addEventListener("click", function (e) {
    if (e.target.closest("[data-ag-sign]")) signAgreement();
  });
  $("profileNudge").addEventListener("click", function (e) {
    if (!e.target.closest("[data-goto-profile]")) return;
    state.view = "profile";
    render();
    window.scrollTo(0, 0);
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
    var formVid = e.target.closest("[data-formvid]");
    if (formVid) { formVideoFromExercise(formVid.getAttribute("data-formvid")); return; }
    var swapBtn = e.target.closest("[data-swap]");
    if (swapBtn) {
      var sk = swapBtn.getAttribute("data-swap");
      var si = state.info[sk] || {};
      setSwap(sk, getSwaps()[sk] ? null : si.home);
      keepOpen(swapBtn);
      render();
      if (getTicks()[sk]) sendTick(sk, true); // already ticked: tell the sheet what they did instead
      return;
    }
    var swapAll = e.target.closest("[data-swapall]");
    if (swapAll) {
      var sp = state.code + "|" + swapAll.getAttribute("data-swapall") + "|";
      var keys = Object.keys(state.info).filter(function (key) {
        return key.indexOf(sp) === 0 && /^\d+$/.test(key.slice(sp.length)) && state.info[key].home && state.info[key].home.name;
      });
      var cur = getSwaps();
      var allOn = keys.every(function (key) { return cur[key]; });
      keys.forEach(function (key) { setSwap(key, allOn ? null : state.info[key].home); });
      keepOpen(swapAll);
      render();
      var tk = getTicks();
      keys.forEach(function (key) { if (tk[key]) sendTick(key, true); });
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
    if (!isCoach() && !i.swap) checkPb(i, w);
    var input = document.querySelector('[data-weight="' + CSS.escape(k) + '"]');
    if (input) keepOpen(input);
    // Wait a moment so that if they tapped straight into the next box, it keeps the cursor.
    setTimeout(render, 0);
  }

  function sendTick(k, on) {
    var i = state.info[k];
    if (i) queue({ type: "tick", key: i.key, block: i.block, week: i.week, session: i.session, exercise: i.exercise, done: on, swap: i.swap || "" });
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
  $("refreshBtn").addEventListener("click", function () { closeMenu(); refresh(false); if (state.view === "community") fetchCommunity(); });
  $("signOutBtn").addEventListener("click", function () { signOut(); });
  $("installMenuBtn").addEventListener("click", function () { closeMenu(); showInstall(true); });

  // Refresh when the app comes back to the foreground, so program edits show up.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && state.code && state.data) { refresh(true); flush(); if (state.view === "community") fetchCommunity(); }
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
  function demoCommunity() {
    var h = 3600000, now = Date.now();
    return {
      me: "demo-me",
      people: {
        "demo-kirst": { name: COACH, photo: "", coach: true },
        "demo-ali": { name: "Ali V.", photo: "", coach: false },
        "demo-marty": { name: "Marty S.", photo: "", coach: false }
      },
      posts: [
        { id: "d1", by: "demo-kirst", at: now - 26 * h, text: "Welcome to the Lift Club! Share your wins, ask questions and cheer each other on. 💜", parent: "", counts: { "❤️": 3, "💪": 2 }, mine: [] },
        { id: "d2", by: "demo-ali", at: now - 3 * h, text: "New deadlift PB today, 120 kg! Couldn't have done it without this crew.", parent: "", counts: { "🔥": 4, "👏": 2 }, mine: ["🔥"] },
        { id: "d3", by: "demo-marty", at: now - 2 * h, text: "Absolute weapon! Well done Ali", parent: "d2", counts: {}, mine: [] },
        { id: "d4", by: "demo-kirst", at: now - 90 * 60000, text: "So proud of you. That lockout was clean!", parent: "d2", counts: {}, mine: [] }
      ]
    };
  }

  function demoData() {
    function ex(label, name, sets, reps, load, rest, notes, video) {
      var x = { label: label, name: name, sets: sets, reps: reps, load: load, tempo: "", rest: rest, notes: notes || "", video: video || "" };
      // Home swaps, as the sheet would send them.
      var homes = {
        "romanian deadlift": ["DB or backpack RDL", "Push the hips back, flat back, slow on the way down."],
        "chin-up": ["Band lat pulldown", "Anchor a band high (top of a door) and pull your elbows down to your ribs."],
        "half-kneeling landmine press": ["Half-kneeling single-arm DB press", "Press up and slightly forward, ribs down."],
        "chest-supported row": ["DB or band bent-over row", "Hinge forward with a flat back and pull to your belly button."]
      };
      var h = homes[name.toLowerCase()];
      if (/back squat|deadlift|bench press/i.test(name) && !h) x.locked = true;
      else if (h && h[0]) x.home = { name: h[0], how: h[1] };
      return x;
    }
    return {
      renewal: { id: "demo-r", start: "25 January 2027", replyBy: "10 January 2027", time: "", price: "$540", payment: "Fortnightly via Acuity", seen: false },
      agreement: { id: "demo", type: "Online", start: "2 November 2026", time: "", price: "$540", payment: "Fortnightly via Acuity", under18: false, signed: false },
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
  if (linkCode) save(KEY_CODE, linkCode);
  // Tapping a Lift Club notification opens the app on that tab.
  if (params.get("view") === "community" || params.get("view") === "videos" || params.get("view") === "checkin") state.view = params.get("view");
  if (linkCode || params.get("view")) history.replaceState(null, "", location.pathname);

  state.code = load(KEY_CODE, null);
  if (state.code) {
    var cached = load(KEY_CACHE, null);
    if (cached && cached.code === state.code) {
      setData(cached.data, false);
      refresh(true);
    } else {
      refresh(false);
    }
    if (state.view === "community") fetchCommunity();
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
