(function () {
  "use strict";

  var CONFIG = window.SCOUTCO_CONFIG || {};
  var KEY_CODE = "scoutco.code";
  var KEY_CACHE = "scoutco.program";
  var KEY_WEEK = "scoutco.week";
  var KEY_BLOCK = "scoutco.block";
  var KEY_TICKS = "scoutco.ticks";
  var KEY_INSTALL_DISMISSED = "scoutco.installDismissed";

  var $ = function (id) { return document.getElementById(id); };
  var state = { code: null, data: null, block: null, week: null, openDays: {} };

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
    remove(KEY_CODE); remove(KEY_CACHE); remove(KEY_WEEK); remove(KEY_BLOCK);
    state = { code: null, data: null, block: null, week: null, openDays: {} };
    $("codeInput").value = "";
    $("loginError").textContent = message || "";
    $("loginError").classList.toggle("hidden", !message);
    show("loginView");
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
    if (on) t[key] = 1; else delete t[key];
    save(KEY_TICKS, t);
  }

  // ---------- rendering ----------
  function render() {
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

    var note = $("coachNote");
    if (client.message) {
      note.innerHTML = "<strong>From your coach</strong>" + esc(client.message);
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
    $("days").innerHTML = !week ? "" : week.days.map(function (day, di) {
      var done = 0;
      var items = day.exercises.map(function (ex, i) {
        var k = tickKey(week.name, day.name, i);
        var isDone = !!ticks[k];
        if (isDone) done++;
        return exerciseHtml(ex, k, isDone);
      }).join("");
      var total = day.exercises.length;
      var dayKey = scope(week.name, day.name);
      var open = state.openDays[dayKey] !== undefined ? state.openDays[dayKey] : (di === firstUnfinished(week, ticks));
      return '<article class="day' + (open ? " open" : "") + '" data-day="' + esc(dayKey) + '">' +
        '<button class="day-head" aria-expanded="' + open + '">' +
          '<div><div class="day-title">' + esc(day.name) + '</div>' +
          '<div class="day-meta">' + total + " exercise" + (total === 1 ? "" : "s") + "</div></div>" +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<span class="day-progress' + (done === total && total ? " complete" : "") + '">' +
              (done === total && total ? "Done ✓" : done + "/" + total) + "</span>" +
            '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' +
          "</div>" +
        "</button>" +
        '<div class="day-body">' + items +
          (done ? '<div class="day-foot"><button class="btn small ghost" data-clear="' + esc(dayKey) + '">Clear ticks</button></div>' : "") +
        "</div>" +
      "</article>";
    }).join("");
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

  function exerciseHtml(ex, key, isDone) {
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
      "</div>" +
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

  $("days").addEventListener("click", function (e) {
    var tick = e.target.closest("[data-tick]");
    if (tick) {
      var k = tick.getAttribute("data-tick");
      setTick(k, !getTicks()[k]);
      keepOpen(tick);
      render();
      return;
    }
    var clear = e.target.closest("[data-clear]");
    if (clear) {
      var prefix = state.code + "|" + clear.getAttribute("data-clear") + "|";
      var t = getTicks();
      Object.keys(t).forEach(function (key) { if (key.indexOf(prefix) === 0) delete t[key]; });
      save(KEY_TICKS, t);
      keepOpen(clear);
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
    if (document.visibilityState === "visible" && state.code && state.data) refresh(true);
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
      client: { name: "Demo Athlete", type: "Weekly", sessions: "Mondays at 7:15 pm", message: "Welcome to ScoutCo! This is a sample program so you can see how the app works." },
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

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* app still works online */ });
    });
  }
})();
