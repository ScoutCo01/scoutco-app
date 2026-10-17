/**
 * ScoutCo program server.
 *
 * Lives inside your Google Sheet (Extensions → Apps Script). The sheet itself
 * stays private: this script only ever sends a client the program that matches
 * their personal code.
 *
 * Sheet tabs it uses:
 *   Clients:  Code | Name | Program | Active | Message
 *   Programs: Program | Week | Day | Order | Exercise | Sets | Reps | Load | Tempo | Rest | Notes | Video
 */

var CLIENTS_TAB = "Clients";
var PROGRAMS_TAB = "Programs";

var CLIENT_HEADERS = ["Code", "Name", "Program", "Active", "Message"];
var PROGRAM_HEADERS = ["Program", "Week", "Day", "Order", "Exercise", "Sets", "Reps", "Load", "Tempo", "Rest", "Notes", "Video"];

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

  var programName = String(client.Program || client.Name || "").trim();
  var rows = readTab_(ss, PROGRAMS_TAB).filter(function (r) {
    return String(r.Program).trim().toLowerCase() === programName.toLowerCase() && String(r.Exercise).trim() !== "";
  });

  return json_({
    client: { name: String(client.Name || ""), message: String(client.Message || "") },
    program: { name: programName, weeks: group_(rows) },
    updated: new Date().toISOString()
  });
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
function normalise_(s) { return String(s || "").trim().toUpperCase(); }
function text_(v) { return v == null ? "" : String(v).trim(); }
function isOff_(v) { var s = String(v || "").trim().toLowerCase(); return s === "no" || s === "n" || s === "false" || s === "off"; }

/* ------------------------------------------------------------------ */
/* Sheet helpers: a ScoutCo menu in the sheet, plus one-time setup.     */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("ScoutCo")
    .addItem("Set up tabs (first time only)", "setupSheets")
    .addItem("Add a new client", "addClient")
    .addToUi();
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
      ["Example Client", "Week 1", "Day 1 · Lower", "A1", "Back squat", "4", "6", "75%", "3-1-1", "2-3 min", "Brace hard.", ""],
      ["Example Client", "Week 1", "Day 1 · Lower", "B1", "Romanian deadlift", "3", "8", "RPE 7", "", "90 s", "", ""],
      ["Example Client", "Week 1", "Day 2 · Upper", "A1", "Bench press", "4", "6", "75%", "", "2-3 min", "", ""],
      ["Example Client", "Week 1", "Day 2 · Upper", "A2", "Chin-up", "4", "6-8", "Bodyweight", "", "2 min", "", ""]
    ].forEach(function (r) { programs.appendRow(r); });
    styleHeader_(programs, PROGRAM_HEADERS.length);
    programs.setColumnWidth(11, 300);
  }

  var first = ss.getSheets()[0];
  if (first.getName() !== CLIENTS_TAB && first.getName() !== PROGRAMS_TAB && first.getLastRow() === 0) {
    ss.deleteSheet(first);
  }
  SpreadsheetApp.getUi().alert("Done! Your Clients and Programs tabs are ready.");
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
