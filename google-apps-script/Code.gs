/**
 * ScoutCo program server.
 *
 * Lives inside your Google Sheet (Extensions → Apps Script). The sheet itself
 * stays private: this script only ever sends a client the program that matches
 * their personal code.
 *
 * Sheet tabs it uses:
 *   Clients:  Code | Name | Program | Active | Message | (Link) | Type | Sessions
 *   Blocks:   Program | Block | Start date   (optional: lets the app open on the current week)
 *   Progress: filled in by the app when clients tick exercises
 *   Feedback: filled in by the app when clients send session comments (you also get an email)
 *   Weeks left: built by the script each time the sheet opens (how long each client's program lasts)
 *   Programs: Program | Block | Week | Day | Order | Exercise | Sets | Reps | Load | Tempo | Rest | Notes | Video
 */

var CLIENTS_TAB = "Clients";
var PROGRAMS_TAB = "Programs";
var BLOCKS_TAB = "Blocks";
var WEEKS_LEFT_TAB = "Weeks left";
var PROGRESS_TAB = "Progress";
var FEEDBACK_TAB = "Feedback";
var PROGRESS_HEADERS = ["Updated", "Client", "Block", "Week", "Session", "Exercise", "Done", "Key"];
var FEEDBACK_HEADERS = ["Received", "Client", "Block", "Week", "Session", "Comment", "ID"];
var BLOCK_HEADERS = ["Program", "Block", "Start date"];

var CLIENT_HEADERS = ["Code", "Name", "Program", "Active", "Message"];
var PROGRAM_HEADERS = ["Program", "Block", "Week", "Day", "Order", "Exercise", "Sets", "Reps", "Load", "Tempo", "Rest", "Notes", "Video"];

/** Called by the app: ?code=SC-XXXXXX */
function doGet(e) {
  var code = normalise_((e && e.parameter && e.parameter.code) || "");
  if (!code) return json_({ error: "Please enter your code." });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var clients = readTab_(ss, CLIENTS_TAB);
  var client = null;
  for (var i = 0; i < clients.length; i++) {
    if (normalise_(clients[i].Code) === code) { client = clients[i]; break; }
  }
  if (!client || isOff_(client.Active)) {
    return json_({ error: "That code wasn't recognised. Check it with your coach." });
  }

  try { recordOpen_(ss, code); } catch (err) { /* the program still loads */ }

  var programName = String(client.Program || client.Name || "").trim();
  var rows = readTab_(ss, PROGRAMS_TAB).filter(function (r) {
    return String(r.Program).trim().toLowerCase() === programName.toLowerCase() && String(r.Exercise).trim() !== "";
  });

  return json_({
    client: { name: String(client.Name || ""), message: String(client.Message || ""), type: String(client.Type || ""), sessions: String(client.Sessions || "") },
    program: { name: programName, blocks: addStartDates_(ss, programName, groupBlocks_(rows)) },
    updated: new Date().toISOString()
  });
}

/** Puts the time a client opened the app in a "Last opened" column on the Clients tab. */
function recordOpen_(ss, code) {
  var sheet = ss.getSheetByName(CLIENTS_TAB);
  var values = sheet.getDataRange().getDisplayValues();
  var h = values[0].map(function (x) { return String(x).trim().toLowerCase(); });
  var cCode = h.indexOf("code"), cLast = h.indexOf("last opened");
  if (cCode < 0) return;
  if (cLast < 0) {
    cLast = h.length; // first column after everything already in use
    sheet.getRange(1, cLast + 1).setValue("Last opened").setFontWeight("bold").setBackground("#ede9fe");
    sheet.getRange(2, cLast + 1, sheet.getMaxRows() - 1, 1).setNumberFormat("dd/mm/yyyy h:mm am/pm");
  }
  for (var i = 1; i < values.length; i++) {
    if (normalise_(values[i][cCode]) === code) { sheet.getRange(i + 1, cLast + 1).setValue(new Date()); return; }
  }
}

/** Called by the app to save ticks and session comments: POST {code, events: [...]} */
function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: "Bad request" }); }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var client = findClient_(ss, normalise_(body.code));
  if (!client) return json_({ error: "That code wasn't recognised." });

  var events = (body.events || []).slice(0, 200);
  var done = [], comments = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var progress = tab_(ss, PROGRESS_TAB, PROGRESS_HEADERS);
    var feedback = tab_(ss, FEEDBACK_TAB, FEEDBACK_HEADERS);
    var progKeys = progress.getRange(1, 8, Math.max(progress.getLastRow(), 1), 1).getValues().map(function (r) { return String(r[0]); });
    var fbIds = feedback.getRange(1, 7, Math.max(feedback.getLastRow(), 1), 1).getValues().map(function (r) { return String(r[0]); });
    var name = String(client.Name || client.Code);
    events.forEach(function (ev) {
      if (!ev || !ev.id) return;
      if (ev.type === "tick") {
        var key = normalise_(client.Code) + "|" + clip_(ev.key, 300);
        var row = [new Date(), cell_(name), cell_(ev.block), cell_(ev.week), cell_(ev.session), cell_(ev.exercise), ev.done ? "✓" : "", key];
        var at = progKeys.indexOf(key);
        if (at > 0) {
          progress.getRange(at + 1, 1, 1, row.length).setValues([row]);
        } else {
          progress.appendRow(row);
          progKeys.push(key);
        }
      } else if (ev.type === "comment") {
        var text = clip_(ev.text, 2000).trim();
        if (text && fbIds.indexOf(String(ev.id)) === -1) {
          feedback.appendRow([new Date(), cell_(name), cell_(ev.block), cell_(ev.week), cell_(ev.session), cell_(text), String(ev.id)]);
          fbIds.push(String(ev.id));
          comments.push(ev);
        }
      }
      done.push(ev.id);
    });
  } finally {
    lock.releaseLock();
  }

  if (comments.length) notify_(ss, client, comments);
  return json_({ ok: true, saved: done });
}

/** Emails you when a client sends a comment. */
function notify_(ss, client, comments) {
  try {
    var to = Session.getEffectiveUser().getEmail();
    if (!to) return;
    var lines = comments.map(function (c) {
      return [c.block, c.week, c.session].filter(String).join(" · ") + "\n" + clip_(c.text, 2000);
    });
    MailApp.sendEmail(to, "ScoutCo: comment from " + (client.Name || "a client"),
      lines.join("\n\n") + "\n\nAll comments are on the Feedback tab:\n" + ss.getUrl());
  } catch (err) { /* email is a bonus; the comment is already saved */ }
}

function findClient_(ss, code) {
  if (!code) return null;
  var clients = readTab_(ss, CLIENTS_TAB);
  for (var i = 0; i < clients.length; i++) {
    if (normalise_(clients[i].Code) === code) return isOff_(clients[i].Active) ? null : clients[i];
  }
  return null;
}

/** Gets a tab, creating it with headings if it doesn't exist yet. */
function tab_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    styleHeader_(sheet, headers.length);
    sheet.getRange("A2:A").setNumberFormat("dd/mm/yyyy");
  }
  return sheet;
}

function clip_(s, n) { return String(s == null ? "" : s).slice(0, n); }
/** Stops client text being treated as a formula. */
function cell_(s) { s = clip_(s, 2000); return /^[=+\-@]/.test(s) ? "'" + s : s; }

/** Adds each block's start date (yyyy-mm-dd) from the Blocks tab, if there is one. */
function addStartDates_(ss, programName, blocks) {
  var sheet = ss.getSheetByName(BLOCKS_TAB);
  if (!sheet) return blocks;
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return blocks;
  var h = values[0].map(function (x) { return String(x).trim().toLowerCase(); });
  var cP = h.indexOf("program"), cB = h.indexOf("block"), cS = h.indexOf("start date");
  if (cP < 0 || cB < 0 || cS < 0) return blocks;
  var tz = ss.getSpreadsheetTimeZone();
  var starts = {};
  values.slice(1).forEach(function (r) {
    if (String(r[cP]).trim().toLowerCase() !== programName.toLowerCase()) return;
    var d = toDate_(r[cS]);
    if (d) {
      starts[String(r[cB]).trim().toLowerCase()] = Utilities.formatDate(d, tz, "yyyy-MM-dd");
    }
  });
  blocks.forEach(function (b) {
    var s = starts[String(b.name).toLowerCase()];
    if (s) b.start = s;
  });
  return blocks;
}

/** Groups rows into blocks (Block column; blank = one block), each holding weeks. */
function groupBlocks_(rows) {
  var blocks = [], index = {};
  rows.forEach(function (r) {
    var b = String(r.Block || "").trim();
    if (!(b in index)) { index[b] = blocks.length; blocks.push({ name: b, rows: [] }); }
    blocks[index[b]].rows.push(r);
  });
  return blocks.map(function (b) { return { name: b.name, weeks: group_(b.rows) }; });
}

/** Groups sheet rows into weeks → days → exercises, keeping the sheet's order. */
function group_(rows) {
  var weeks = [], weekIndex = {};
  rows.forEach(function (r, n) {
    var wName = String(r.Week || "Program").trim();
    var dName = String(r.Day || "Session").trim();
    if (!(wName in weekIndex)) { weekIndex[wName] = weeks.length; weeks.push({ name: wName, days: [], _d: {} }); }
    var w = weeks[weekIndex[wName]];
    if (!(dName in w._d)) { w._d[dName] = w.days.length; w.days.push({ name: dName, exercises: [] }); }
    w.days[w._d[dName]].exercises.push({
      _sort: n,
      label: text_(r.Order),
      name: text_(r.Exercise),
      sets: text_(r.Sets),
      reps: text_(r.Reps),
      load: text_(r.Load),
      tempo: text_(r.Tempo),
      rest: text_(r.Rest),
      notes: text_(r.Notes),
      video: text_(r.Video)
    });
  });
  weeks.forEach(function (w) {
    delete w._d;
    w.days.forEach(function (d) {
      d.exercises.sort(function (a, b) {
        var c = String(a.label).localeCompare(String(b.label), undefined, { numeric: true });
        return c !== 0 ? c : a._sort - b._sort;
      });
      d.exercises.forEach(function (x) { delete x._sort; });
    });
  });
  return weeks;
}

function readTab_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  var values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (h) { return String(h).trim(); });
  return values.slice(1).map(function (row) {
    var o = {};
    headers.forEach(function (h, i) { if (h) o[h] = row[i]; });
    return o;
  }).filter(function (o) {
    return Object.keys(o).some(function (k) { return String(o[k]).trim() !== ""; });
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
/** Reads a start date whether the cell holds a real date, a date number, or text like 19/10/2026 or 2026-10-19. */
function toDate_(v) {
  if (Object.prototype.toString.call(v) === "[object Date]") return isNaN(v) ? null : v;
  if (typeof v === "number" && v > 30000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000) + new Date().getTimezoneOffset() * 60000);
  var t = String(v || "").trim(), m;
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return new Date(+m[1], +m[2] - 1, +m[3]);
  if ((m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/))) return new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1]);
  if ((m = t.match(/^(?:[a-z]+,?\s+)?(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/i))) {
    var mon = "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(m[2].toLowerCase()) / 3;
    if (mon >= 0 && mon % 1 === 0) return new Date(+m[3], mon, +m[1]);
  }
  return null;
}
function normalise_(s) { return String(s || "").trim().toUpperCase(); }
function text_(v) { return v == null ? "" : String(v).trim(); }
function isOff_(v) { var s = String(v || "").trim().toLowerCase(); return s === "no" || s === "n" || s === "false" || s === "off"; }

/* ------------------------------------------------------------------ */
/* Sheet helpers: a ScoutCo menu in the sheet, plus one-time setup.     */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("ScoutCo")
    .addItem("Set up tabs", "setupSheets")
    .addItem("Add a new client", "addClient")
    .addItem("Update weeks left", "updateWeeksLeft")
    .addToUi();
  try { formatDates_(); } catch (err) { /* not essential */ }
  try { updateWeeksLeft(true); } catch (err) { /* the menu item still works */ }
}

/** Shows the dates on Progress and Feedback as dd/mm/yyyy (new rows pick this up too). */
function formatDates_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  [PROGRESS_TAB, FEEDBACK_TAB].forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (sheet) sheet.getRange("A2:A").setNumberFormat("dd/mm/yyyy");
  });
}

/* ------------------------------------------------------------------ */
/* Weeks left: when each client's written program runs out.            */
/* ------------------------------------------------------------------ */

/**
 * Rebuilds the "Weeks left" tab: one row per active client showing their
 * current block and week, how many written weeks they have left (counting
 * this week), and the date their last written week finishes.
 * Works it out from the Blocks tab start dates, so nothing needs ticking.
 */
function updateWeeksLeft(quiet) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var DAY = 24 * 60 * 60 * 1000;
  var dayNo = function (d) { return Math.round(Date.parse(Utilities.formatDate(d, tz, "yyyy-MM-dd") + "T00:00:00Z") / DAY); };
  var fromDayNo = function (n) { var d = new Date(n * DAY); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
  var today = dayNo(new Date());

  // Weeks written per program and block, in the order they appear on the Programs tab.
  var programs = {};
  readTab_(ss, PROGRAMS_TAB).forEach(function (r) {
    if (String(r.Exercise).trim() === "") return;
    var p = String(r.Program).trim().toLowerCase();
    var b = String(r.Block || "").trim();
    var prog = programs[p] || (programs[p] = { order: [], weeks: {} });
    if (!(b in prog.weeks)) { prog.order.push(b); prog.weeks[b] = {}; }
    prog.weeks[b][String(r.Week || "Program").trim()] = true;
  });

  // Start dates from the Blocks tab. Also remembers rows whose date couldn't be read.
  var starts = {}, badDates = {}, blockNames = {};
  var bSheet = ss.getSheetByName(BLOCKS_TAB);
  var bVals = bSheet ? bSheet.getDataRange().getValues() : [];
  var hasBlockHeaders = false;
  if (bVals.length) {
    var h = bVals[0].map(function (x) { return String(x).trim().toLowerCase(); });
    var cP = h.indexOf("program"), cB = h.indexOf("block"), cS = h.indexOf("start date");
    hasBlockHeaders = cP >= 0 && cB >= 0 && cS >= 0;
    if (hasBlockHeaders) {
      bVals.slice(1).forEach(function (r) {
        var p = String(r[cP]).trim().toLowerCase(), b = String(r[cB]).trim().toLowerCase();
        if (!p) return;
        (blockNames[p] = blockNames[p] || []).push(String(r[cB]).trim());
        var d = toDate_(r[cS]);
        if (d) starts[p + "|" + b] = dayNo(d);
        else if (String(r[cS]).trim() !== "") badDates[p + "|" + b] = String(r[cS]).trim();
      });
    }
  }

  var rows = [];
  readTab_(ss, CLIENTS_TAB).forEach(function (c) {
    if (isOff_(c.Active) || String(c.Code).trim() === "") return;
    var name = String(c.Name || "").trim();
    var opened = String(c["Last opened"] || "").trim() || "Not yet";
    var progName = String(c.Program || c.Name || "").trim();
    var key = progName.toLowerCase();
    var prog = programs[key];
    if (!prog) { rows.push({ left: -2, cells: [name, "", "", "", "", "No exercises on the Programs tab for \"" + progName + "\" yet", opened] }); return; }

    // Lay the blocks out on the calendar. A block with no start date follows on from the one
    // before it (or, if it comes first, finishes the day before the next dated block starts).
    var list = prog.order.map(function (b) {
      return { name: b, weeks: Object.keys(prog.weeks[b]).length, start: starts[key + "|" + b.toLowerCase()] };
    });
    var undated = list.filter(function (b) { return b.start == null; }).map(function (b) { return b.name || "(no block name)"; });
    for (var i = 1; i < list.length; i++) {
      if (list[i].start == null && list[i - 1].start != null) list[i].start = list[i - 1].start + list[i - 1].weeks * 7;
    }
    for (var j = list.length - 2; j >= 0; j--) {
      if (list[j].start == null && list[j + 1].start != null) list[j].start = list[j + 1].start - list[j].weeks * 7;
    }
    var blocks = list.filter(function (b) { return b.start != null; });
    blocks.forEach(function (b) { b.end = b.start + b.weeks * 7; });

    if (!blocks.length) {
      var why;
      var bad = prog.order.filter(function (b) { return badDates[key + "|" + b.toLowerCase()]; });
      if (!hasBlockHeaders) why = "The Blocks tab needs the headings Program, Block, Start date in row 1";
      else if (bad.length) why = "The start date for " + bad[0] + " (\"" + badDates[key + "|" + bad[0].toLowerCase()] + "\") isn't being read as a date. Retype it like 19/10/2026";
      else if (blockNames[key]) why = "Block names don't match. Programs tab has: " + prog.order.join(", ") + ". Blocks tab has: " + blockNames[key].join(", ");
      else why = "No rows on the Blocks tab with \"" + progName + "\" in the Program column (it must match the Programs tab exactly)";
      rows.push({ left: -2, cells: [name, "", "", "", "", why, opened] });
      return;
    }

    var lastEnd = Math.max.apply(null, blocks.map(function (b) { return b.end; }));
    var current = null;
    blocks.forEach(function (b) { if (today >= b.start && today < b.end) current = b; });
    var firstStart = Math.min.apply(null, blocks.map(function (b) { return b.start; }));

    var nowText = "", weekText = "";
    if (current) {
      nowText = current.name || "Program";
      weekText = "Week " + (Math.floor((today - current.start) / 7) + 1) + " of " + current.weeks;
    } else if (today < firstStart) {
      nowText = "Starts " + Utilities.formatDate(fromDayNo(firstStart), tz, "d MMM");
    } else if (today >= lastEnd) {
      nowText = "Finished";
    } else {
      nowText = "Between blocks";
    }

    var left = Math.max(0, Math.ceil((lastEnd - Math.max(today, firstStart)) / 7));
    var status = left === 0 ? "Program has run out" : left <= 2 ? "Write next block now" : "";
    var notes = [status];
    if (undated.length) notes.push("No start date for " + undated.join(", ") + " (worked out from the blocks around it)");
    rows.push({ left: left, cells: [name, nowText, weekText, left, fromDayNo(lastEnd - 1), notes.filter(String).join(". "), opened] });
  });

  rows.sort(function (a, b) { return a.left - b.left; });
  // Put "no program yet" rows last.
  rows = rows.filter(function (r) { return r.left >= 0; }).concat(rows.filter(function (r) { return r.left < 0; }));

  var sheet = ss.getSheetByName(WEEKS_LEFT_TAB) || ss.insertSheet(WEEKS_LEFT_TAB);
  sheet.clear();
  var headers = ["Client", "Now on", "Week", "Weeks left", "Last week ends", "Heads up", "Last opened app"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  styleHeader_(sheet, headers.length);
  if (rows.length) {
    var range = sheet.getRange(2, 1, rows.length, headers.length);
    range.setValues(rows.map(function (r) { return r.cells; }));
    sheet.getRange(2, 5, rows.length, 1).setNumberFormat("ddd d mmm yyyy");
    sheet.getRange(2, 4, rows.length, 1).setHorizontalAlignment("center");
    rows.forEach(function (r, i) {
      var colour = r.left < 0 ? "#f3f4f6" : r.left === 0 ? "#fecaca" : r.left <= 2 ? "#fde68a" : null;
      if (colour) sheet.getRange(i + 2, 1, 1, headers.length).setBackground(colour);
    });
  }
  sheet.getRange(rows.length + 3, 1).setValue("Updated " + Utilities.formatDate(new Date(), tz, "EEE d MMM, h:mm a") +
    ". Counts from the Blocks tab start dates and the weeks on the Programs tab. Weeks left includes this week.")
    .setFontColor("#6b7280").setFontStyle("italic");
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 130);
  sheet.setColumnWidth(5, 150);
  sheet.setColumnWidth(6, 320);
  sheet.setColumnWidth(7, 160);
  if (!quiet) { ss.setActiveSheet(sheet); }
}

/** Creates the Clients and Programs tabs with headings and an example. */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var clients = ss.getSheetByName(CLIENTS_TAB) || ss.insertSheet(CLIENTS_TAB);
  if (clients.getLastRow() === 0) {
    clients.appendRow(CLIENT_HEADERS);
    clients.appendRow([newCode_([]), "Example Client", "Example Client", "Yes", "Welcome to ScoutCo! Any questions, just message me."]);
    styleHeader_(clients, CLIENT_HEADERS.length);
    clients.setColumnWidth(5, 380);
  }

  var programs = ss.getSheetByName(PROGRAMS_TAB) || ss.insertSheet(PROGRAMS_TAB);
  if (programs.getLastRow() === 0) {
    programs.appendRow(PROGRAM_HEADERS);
    [
      ["Example Client", "Block 1", "Week 1", "Day 1 · Lower", "A1", "Back squat", "4", "6", "75%", "3-1-1", "2-3 min", "Brace hard.", ""],
      ["Example Client", "Block 1", "Week 1", "Day 1 · Lower", "B1", "Romanian deadlift", "3", "8", "RPE 7", "", "90 s", "", ""],
      ["Example Client", "Block 1", "Week 1", "Day 2 · Upper", "A1", "Bench press", "4", "6", "75%", "", "2-3 min", "", ""],
      ["Example Client", "Block 1", "Week 1", "Day 2 · Upper", "A2", "Chin-up", "4", "6-8", "Bodyweight", "", "2 min", "", ""]
    ].forEach(function (r) { programs.appendRow(r); });
    styleHeader_(programs, PROGRAM_HEADERS.length);
    programs.setColumnWidth(12, 300);
  }

  var blocksTab = ss.getSheetByName(BLOCKS_TAB) || ss.insertSheet(BLOCKS_TAB);
  if (blocksTab.getLastRow() === 0) {
    blocksTab.appendRow(BLOCK_HEADERS);
    blocksTab.appendRow(["Example Client", "Block 1", new Date()]);
    styleHeader_(blocksTab, BLOCK_HEADERS.length);
    blocksTab.getRange("C2:C").setNumberFormat("dd/mm/yyyy");
  }

  tab_(ss, PROGRESS_TAB, PROGRESS_HEADERS).setColumnWidth(6, 220);
  tab_(ss, FEEDBACK_TAB, FEEDBACK_HEADERS).setColumnWidth(6, 420);

  var first = ss.getSheets()[0];
  if (first.getName() !== CLIENTS_TAB && first.getName() !== PROGRAMS_TAB && first.getLastRow() === 0) {
    ss.deleteSheet(first);
  }
  SpreadsheetApp.getUi().alert("Done! Your tabs are ready.");
}

/** Asks for a name, then adds a client row with a fresh private code. */
function addClient() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt("Add a new client", "Client's full name:", ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var name = res.getResponseText().trim();
  if (!name) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CLIENTS_TAB);
  if (!sheet) { ui.alert("Run ScoutCo → Set up tabs first."); return; }
  var existing = readTab_(ss, CLIENTS_TAB).map(function (c) { return normalise_(c.Code); });
  var code = newCode_(existing);
  // Put the client in the first empty row (not appendRow, which a link formula pushes to the bottom).
  var last = Math.max(sheet.getLastRow(), 2);
  var colA = sheet.getRange(2, 1, last - 1, 1).getDisplayValues();
  var row = 2;
  while (row - 2 < colA.length && String(colA[row - 2][0]).trim() !== "") row++;
  sheet.getRange(row, 1, 1, 5).setValues([[code, name, name, "Yes", ""]]);
  ui.alert(name + "'s code is:\n\n" + code + "\n\nAdd their exercises on the Programs tab with \"" + name + "\" in the Program column.");
}

/** Random code like SC-7Q4K9X (no look-alike letters such as O/0 or I/1). */
function newCode_(existing) {
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var code;
  do {
    code = "SC-";
    for (var i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  } while (existing.indexOf(code) !== -1);
  return code;
}

function styleHeader_(sheet, n) {
  sheet.getRange(1, 1, 1, n).setFontWeight("bold").setBackground("#ede9fe");
  sheet.setFrozenRows(1);
}
