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
 *   Progress: filled in by the app when clients tick exercises (Home swap column: what they did instead at home)
 *   Feedback: filled in by the app when clients send session comments (you also get an email)
 *   Weights:  filled in by the app when clients type the weight they used on an exercise
 *   Session notes: filled in by the app when you (Clients Type "Coach") write notes after each client
 *   Check-ins: online clients' weekly pulse check. Type your reply in "Reply from Kirst" and it shows in their app
 *   To-do:    your own to-do list (Task | Done | Added | Done on | ID). Type tasks here or add them in the app
 *   Home swaps: Exercise | Home swap | How to do it | Video. What clients can do at home instead (ScoutCo → Set up home swaps)
 *   Profiles: one row per client. Name and Type come from Clients; the client fills in photo, 1RMs, DOB, goals and so on in the app
 *   Coach profile: your own photo and bio (filled in from the Profile tab of your coach app). Clients see it in their app
 *   Lift Club Community: posts, replies and reactions from every client and coach. Tick Hide to take one down
 *   Videos:   videos you send clients from their sessions, and form videos clients send you (files live in the "ScoutCo videos" folder in your Drive)
 *   PBs:      a row each time a client beats their 1RM on back squat, deadlift or bench press (they get a pop-up in the app)
 *   Settings: Setting | Value (e.g. "Check-in call booking link" for the Book a check-in call button)
 *   Weeks left: built by the script each time the sheet opens (how long each client's program lasts)
 *
 * Monday summary email: ScoutCo menu → "Turn on Monday email" (see sendWeeklySummary below).
 *   Programs: Program | Block | Week | Day | Order | Exercise | Sets | Reps | Load | Tempo | Rest | Notes | Video
 */

var CLIENTS_TAB = "Clients";
var PROGRAMS_TAB = "Programs";
var BLOCKS_TAB = "Blocks";
var WEEKS_LEFT_TAB = "Weeks left";
var PROGRESS_TAB = "Progress";
var FEEDBACK_TAB = "Feedback";
var WEIGHTS_TAB = "Weights";
var WEIGHT_HEADERS = ["Updated", "Client", "Block", "Week", "Session", "Exercise", "Weight", "Key"];
var NOTES_TAB = "Session notes";
var NOTE_HEADERS = ["Updated", "Coach", "Block", "Week", "Day", "Client", "Notes", "Key"];
var PROGRESS_HEADERS = ["Updated", "Client", "Block", "Week", "Session", "Exercise", "Done", "Key"];
var FEEDBACK_HEADERS = ["Received", "Client", "Block", "Week", "Session", "Comment", "ID"];
var BLOCK_HEADERS = ["Program", "Block", "Start date"];
var CHECKINS_TAB = "Check-ins";
var CHECKIN_HEADERS = ["Updated", "Week of", "Client", "Sleep", "Nutrition", "Energy", "Soreness", "Head noise", "Bodyweight", "Note for Kirst", "Reply from Kirst", "Key"];
var CHECKIN_SCORES = [["sleep", "Sleep"], ["nutrition", "Nutrition"], ["energy", "Energy"], ["soreness", "Soreness"], ["head", "Head noise"]];
var TODO_TAB = "To-do";
var TODO_HEADERS = ["Task", "Done", "Added", "Done on", "ID"];
var SETTINGS_TAB = "Settings";
var BOOKING_SETTING = "Check-in call booking link";
var BOOKING_DEFAULT = "https://scoutcobooking.as.me/?appointmentType=99612561"; // Online Coaching: Call

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
    return json_({ error: "That code wasn't recognised. Check it with Kirst." });
  }

  // The Lift Club Community tab loads on its own, so the program stays quick to open.
  if (e.parameter.community) return json_(communityFeed_(ss, code));

  try { recordOpen_(ss, code); } catch (err) { /* the program still loads */ }

  var programName = String(client.Program || client.Name || "").trim();
  var rows = readTab_(ss, PROGRAMS_TAB).filter(function (r) {
    return String(r.Program).trim().toLowerCase() === programName.toLowerCase() && String(r.Exercise).trim() !== "";
  });

  var blocks = addStartDates_(ss, programName, groupBlocks_(rows));
  if (!isCoach_(client.Type)) {
    try { addHomeSwaps_(ss, blocks); } catch (err) { /* the program still loads, just without swaps */ }
    try { addDemoLinks_(blocks); } catch (err) { /* not essential */ }
  }

  return json_({
    client: { name: String(client.Name || ""), message: String(client.Message || ""), type: String(client.Type || ""), sessions: String(client.Sessions || "") },
    program: { name: programName, blocks: blocks },
    weights: weightsFor_(ss, code),
    ticks: ticksFor_(ss, code),
    swaps: swapsFor_(ss, code),
    checkins: isOnline_(client.Type) ? checkinsFor_(ss, code) : [],
    todos: isCoach_(client.Type) ? todosFor_(ss) : undefined,
    profile: safely_(function () { return isCoach_(client.Type) ? coachProfile_(ss) : profileFor_(ss, code); }, null),
    pbs: isCoach_(client.Type) ? undefined : safely_(function () { return pbsFor_(ss, code); }, []),
    coach: isCoach_(client.Type) ? undefined : safely_(function () { return coachProfile_(ss); }, null),
    clients: isCoach_(client.Type) ? safely_(function () { return clientProfiles_(ss); }, []) : undefined,
    settings: { bookingUrl: setting_(ss, BOOKING_SETTING), pushAppId: setting_(ss, PUSH_APP_SETTING) },
    videos: safely_(function () { return videosFor_(ss, code, isCoach_(client.Type)); }, []),
    community: { latest: safely_(function () { return communityLatest_(ss, code); }, 0), me: safely_(function () { return personId_(code, communitySalt_()); }, "") },
    updated: new Date().toISOString()
  });
}

/**
 * Everything this client has logged on the Weights tab, so the app can show "last time"
 * on any phone: { "<block>|<week>|<session>|<n>": { w, ex, wk, at } }.
 */
function weightsFor_(ss, code) {
  var out = {};
  var prefix = code + "|";
  // The coach's session notes come back the same way, so they show on any phone too.
  [WEIGHTS_TAB, NOTES_TAB].forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) return;
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues().forEach(function (r) {
      var key = String(r[7]);
      if (key.indexOf(prefix) !== 0) return;
      var at = r[0] instanceof Date ? r[0].getTime() : 0;
      out[key.slice(prefix.length)] = { w: text_(r[6]).replace(/^'/, ""), ex: text_(r[5]), wk: text_(r[3]), at: at };
    });
  });
  return out;
}

/** Every exercise this client has ticked, with when: { "<block>|<week>|<session>|<n>": ms }. */
function ticksFor_(ss, code) {
  var out = {}, prefix = code + "|";
  rowsOf_(ss, PROGRESS_TAB, 8).forEach(function (r) {
    var key = String(r[7]);
    if (key.indexOf(prefix) !== 0 || r[6] !== "✓") return;
    out[key.slice(prefix.length)] = r[0] instanceof Date ? r[0].getTime() : 1;
  });
  return out;
}

/** Ticked exercises this client swapped for home: { "<block>|<week>|<session>|<n>": "<home swap>" }. */
function swapsFor_(ss, code) {
  var out = {}, prefix = code + "|";
  var sheet = ss.getSheetByName(PROGRESS_TAB);
  if (!sheet || sheet.getLastRow() < 2) return out;
  var col = swapCol_(sheet, false);
  if (!col) return out;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, col).getValues().forEach(function (r) {
    var key = String(r[7]), swap = text_(r[col - 1]);
    if (key.indexOf(prefix) === 0 && r[6] === "✓" && swap) out[key.slice(prefix.length)] = swap;
  });
  return out;
}

/** This client's weekly check-ins (newest first), including your replies. */
function checkinsFor_(ss, code) {
  var tz = ss.getSpreadsheetTimeZone(), prefix = code + "|", out = [];
  rowsOf_(ss, CHECKINS_TAB, CHECKIN_HEADERS.length).forEach(function (r) {
    var key = String(r[11]);
    if (key.indexOf(prefix) !== 0) return;
    var c = { week: key.slice(prefix.length), bw: text_(r[8]).replace(/^'/, ""), note: text_(r[9]), reply: text_(r[10]),
      at: r[0] instanceof Date ? r[0].getTime() : 0 };
    CHECKIN_SCORES.forEach(function (s, i) { c[s[0]] = score_(r[3 + i]); });
    out.push(c);
  });
  out.sort(function (a, b) { return a.week < b.week ? 1 : -1; });
  return out.slice(0, 26);
}

/* ------------------------------------------------------------------ */
/* To-do list (only for the Clients row with Type "Coach").            */
/* ------------------------------------------------------------------ */

function isCoach_(type) { return /\bcoach\b/i.test(String(type || "")); }

/** The To-do tab, created with a tick box column the first time it's needed. */
function todoTab_(ss) {
  var sheet = ss.getSheetByName(TODO_TAB);
  if (sheet) return sheet;
  sheet = ss.insertSheet(TODO_TAB);
  sheet.appendRow(TODO_HEADERS);
  styleHeader_(sheet, TODO_HEADERS.length);
  sheet.getRange("B2:B").setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  sheet.getRange("C2:D").setNumberFormat("dd/mm/yyyy");
  sheet.setColumnWidth(1, 380);
  sheet.setColumnWidth(5, 120);
  return sheet;
}

/**
 * Where each To-do column is (0-based), found by its heading so it still works if you
 * add or move columns. Any heading that's missing is added on the right.
 */
function todoCols_(sheet) {
  var width = Math.max(sheet.getLastColumn(), 1);
  var h = sheet.getRange(1, 1, 1, width).getDisplayValues()[0].map(function (x) { return String(x).trim().toLowerCase(); });
  var cols = {};
  [["task", "Task"], ["done", "Done"], ["added", "Added"], ["doneOn", "Done on"], ["id", "ID"]].forEach(function (c) {
    var at = h.indexOf(c[1].toLowerCase());
    if (at < 0) {
      at = h.length;
      h.push(c[1].toLowerCase());
      sheet.getRange(1, at + 1).setValue(c[1]).setFontWeight("bold").setBackground("#ede9fe");
    }
    cols[c[0]] = at;
  });
  cols.width = h.length;
  return cols;
}

function isTicked_(v) { return v === true || /^(true|yes|y|x|✓|✔|done)$/i.test(String(v == null ? "" : v).trim()); }
function newTodoId_() { return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/**
 * Every task on the To-do tab, in the order they are on the tab. Tasks you typed straight
 * into the sheet get an ID here, so the app can tick them off.
 */
function todosFor_(ss) {
  var sheet = ss.getSheetByName(TODO_TAB);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var lock = LockService.getScriptLock();
  var locked = lock.tryLock(10000);
  try {
    var c = todoCols_(sheet);
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, c.width).getValues();
    var out = [];
    values.forEach(function (r, i) {
      var text = text_(r[c.task]);
      if (!text) return;
      var id = text_(r[c.id]);
      if (!id) {
        if (!locked) return; // can't safely give it an ID right now; it shows next time
        id = newTodoId_();
        sheet.getRange(i + 2, c.id + 1).setValue(id);
      }
      out.push({ id: id, text: text, done: isTicked_(r[c.done]),
        at: r[c.added] instanceof Date ? r[c.added].getTime() : 0,
        doneAt: r[c.doneOn] instanceof Date ? r[c.doneOn].getTime() : 0 });
    });
    if (locked) SpreadsheetApp.flush();
    return out;
  } finally {
    if (locked) lock.releaseLock();
  }
}

/** Saves one change from the app: a new task, a tick or untick, or a delete. */
function saveTodo_(todo, ev) {
  var id = String(ev.key || "");
  if (!/^[a-z0-9]{4,40}$/i.test(id)) return;
  var sheet = todo.sheet, c = todo.cols;
  var at = todo.ids.indexOf(id); // index into the sheet's rows (0 = row 1)
  if (ev.del) {
    if (at > 0) {
      // A sheet must keep one row under the headings, so empty the last one instead of deleting it.
      if (sheet.getMaxRows() > 2) sheet.deleteRow(at + 1); else sheet.getRange(at + 1, 1, 1, c.width).clearContent();
      todo.ids.splice(at, 1);
    }
    return;
  }
  var done = !!ev.done;
  if (at > 0) {
    var was = isTicked_(sheet.getRange(at + 1, c.done + 1).getValue());
    if (was !== done) {
      sheet.getRange(at + 1, c.done + 1).setValue(done);
      sheet.getRange(at + 1, c.doneOn + 1).setValue(done ? new Date() : "");
    }
    return;
  }
  var text = clip_(ev.text, 300).trim();
  if (!text) return;
  var row = [];
  for (var i = 0; i < c.width; i++) row.push("");
  row[c.task] = cell_(text);
  row[c.done] = done;
  row[c.added] = new Date();
  row[c.doneOn] = done ? new Date() : "";
  row[c.id] = id;
  sheet.appendRow(row);
  todo.ids.push(id);
}

/**
 * Runs by itself whenever you edit the sheet. On the To-do tab it fills in the
 * Added date when you type a task, and the Done on date when you tick one.
 */
function onEdit(e) {
  try {
    var sheet = e && e.range && e.range.getSheet();
    if (!sheet || sheet.getName() !== TODO_TAB) return;
    var first = e.range.getRow(), n = e.range.getNumRows();
    if (first + n - 1 < 2) return;
    var c = todoCols_(sheet);
    var start = Math.max(first, 2), count = first + n - start;
    var values = sheet.getRange(start, 1, count, c.width).getValues();
    var editedDone = e.range.getColumn() <= c.done + 1 && c.done + 1 <= e.range.getLastColumn();
    values.forEach(function (r, i) {
      var row = start + i;
      if (text_(r[c.task]) && !(r[c.added] instanceof Date) && text_(r[c.added]) === "") {
        sheet.getRange(row, c.added + 1).setValue(new Date());
      }
      if (editedDone) sheet.getRange(row, c.doneOn + 1).setValue(isTicked_(r[c.done]) ? new Date() : "");
    });
  } catch (err) { /* only fills in dates; never stop an edit */ }
}

function score_(v) { var n = parseInt(v, 10); return n >= 1 && n <= 3 ? n : ""; }
function isOnline_(type) { return /online/i.test(String(type || "")) && !/\bcoach\b/i.test(String(type || "")); }

/** A value from the Settings tab (Setting | Value), or "" if it isn't there. */
function setting_(ss, name) {
  var sheet = ss.getSheetByName(SETTINGS_TAB);
  if (!sheet || sheet.getLastRow() < 1) return "";
  var vals = sheet.getRange(1, 1, sheet.getLastRow(), 2).getDisplayValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim().toLowerCase() === name.toLowerCase()) return String(vals[i][1]).trim();
  }
  return "";
}

/** Puts the time a client opened the app in a "Last opened" column on the Clients tab. */
function recordOpen_(ss, code) {
  // The app can ask for the program twice at once (e.g. opening and refreshing), so take turns.
  // Otherwise both could add a "Last opened" heading and you'd get two columns.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
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
      if (normalise_(values[i][cCode]) === code) { sheet.getRange(i + 1, cLast + 1).setValue(new Date()); break; }
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/** Called by the app to save ticks and session comments: POST {code, events: [...]} */
function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: "Bad request" }); }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var client = findClient_(ss, normalise_(body.code));
  if (!client) return json_({ error: "That code wasn't recognised." });

  // A piece of a video upload (big, so it skips the queue below).
  if (body.video) {
    try { return json_(handleVideo_(ss, client, body.video)); }
    catch (err) { return json_({ error: "Something went wrong saving the video. Please try again.", retry: true, detail: String(err && err.message || err) }); }
  }

  var events = (body.events || []).slice(0, 200);
  var done = [], comments = [], checkins = [], community = [], posted = [], replies = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var progress = tab_(ss, PROGRESS_TAB, PROGRESS_HEADERS);
    var feedback = tab_(ss, FEEDBACK_TAB, FEEDBACK_HEADERS);
    var weights = null, wKeys = null, notes = null, nKeys = null, cis = null, cKeys = null, todo = null;
    var progSwap = null; // the Home swap column, found the first time it's needed
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
          at = progKeys.length - 1;
        }
        // What they did instead at home, if they swapped it (blank for the gym version).
        var swap = clip_(ev.swap, 200).trim();
        if (progSwap === null) progSwap = swapCol_(progress, false);
        if (swap && !progSwap) progSwap = swapCol_(progress, true);
        if (progSwap) progress.getRange(at + 1, progSwap).setValue(cell_(swap));
      } else if (ev.type === "weight") {
        if (!weights) {
          weights = tab_(ss, WEIGHTS_TAB, WEIGHT_HEADERS);
          wKeys = weights.getRange(1, 8, Math.max(weights.getLastRow(), 1), 1).getValues().map(function (r) { return String(r[0]); });
        }
        var wKey = normalise_(client.Code) + "|" + clip_(ev.key, 300);
        var wRow = [new Date(), cell_(name), cell_(ev.block), cell_(ev.week), cell_(ev.session), cell_(ev.exercise), asText_(clip_(ev.weight, 40).trim()), wKey];
        var wAt = wKeys.indexOf(wKey);
        if (wAt > 0) {
          weights.getRange(wAt + 1, 1, 1, wRow.length).setValues([wRow]);
        } else {
          weights.appendRow(wRow);
          wKeys.push(wKey);
        }
      } else if (ev.type === "note") {
        if (!notes) {
          notes = tab_(ss, NOTES_TAB, NOTE_HEADERS);
          nKeys = notes.getRange(1, 8, Math.max(notes.getLastRow(), 1), 1).getValues().map(function (r) { return String(r[0]); });
        }
        var nKey = normalise_(client.Code) + "|" + clip_(ev.key, 300);
        var nRow = [new Date(), cell_(name), cell_(ev.block), cell_(ev.week), cell_(ev.session), cell_(ev.exercise), cell_(clip_(ev.weight, 2000).trim()), nKey];
        var nAt = nKeys.indexOf(nKey);
        if (nAt > 0) {
          notes.getRange(nAt + 1, 1, 1, nRow.length).setValues([nRow]);
        } else {
          notes.appendRow(nRow);
          nKeys.push(nKey);
        }
      } else if (ev.type === "checkin") {
        var weekOf = String(ev.weekOf || "");
        if (/^\d{4}-\d{2}-\d{2}$/.test(weekOf)) {
          if (!cis) {
            cis = tab_(ss, CHECKINS_TAB, CHECKIN_HEADERS);
            cKeys = cis.getRange(1, 12, Math.max(cis.getLastRow(), 1), 1).getValues().map(function (r) { return String(r[0]); });
          }
          var cKey = normalise_(client.Code) + "|" + weekOf;
          var scores = CHECKIN_SCORES.map(function (s) { return score_(ev[s[0]]); });
          var cRow = [new Date(), Utilities.parseDate(weekOf, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd"), cell_(name)]
            .concat(scores, [asText_(clip_(ev.bw, 20).trim()), cell_(clip_(ev.note, 2000).trim())]);
          var cAt = cKeys.indexOf(cKey);
          // Columns A to J only, so a reply you've already typed (column K) is kept.
          if (cAt > 0) {
            cis.getRange(cAt + 1, 1, 1, cRow.length).setValues([cRow]);
          } else {
            cis.appendRow(cRow.concat(["", cKey]));
            cKeys.push(cKey);
          }
          checkins.push({ week: weekOf, scores: scores, bw: clip_(ev.bw, 20).trim(), note: clip_(ev.note, 2000).trim(), updated: cAt > 0 });
        }
      } else if (ev.type === "todo") {
        if (isCoach_(client.Type)) { // only your own coach profile has a to-do list
          if (!todo) {
            var tSheet = todoTab_(ss), tCols = todoCols_(tSheet);
            todo = { sheet: tSheet, cols: tCols,
              ids: tSheet.getRange(1, tCols.id + 1, Math.max(tSheet.getLastRow(), 1), 1).getValues().map(function (r) { return String(r[0]); }) };
          }
          saveTodo_(todo, ev);
        }
      } else if (ev.type === "profile") {
        if (!isCoach_(client.Type)) saveProfile_(ss, client, ev);
      } else if (ev.type === "coachprofile") {
        if (isCoach_(client.Type)) saveCoachProfile_(ss, client, ev);
      } else if (ev.type === "pb") {
        if (!isCoach_(client.Type)) savePb_(ss, client, ev);
      } else if (ev.type === "videoreply" || ev.type === "videohide") {
        var vr = saveVideoEvent_(ss, client, ev);
        if (vr) replies.push(vr);
      } else if (ev.type === "post" || ev.type === "react" || ev.type === "unpost") {
        community.push(ev); // saved together below, in the order they were sent
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
    if (community.length) posted = saveCommunity_(ss, client, community);
  } finally {
    lock.releaseLock();
  }

  if (comments.length) notify_(ss, client, comments);
  if (checkins.length) notifyCheckin_(ss, client, checkins);
  if (posted.length) notifyCommunity_(ss, client, posted);
  if (posted.length) safely_(function () { pushCommunity_(ss, client, posted); }, null);
  replies.forEach(function (r) {
    safely_(function () {
      sendPush_(ss, [personId_(r.to, communitySalt_())], "Kirst replied", "Kirst replied to your " + (r.lift ? r.lift.toLowerCase() + " " : "") + "form video. Tap to read it.", "videos");
    }, null);
  });
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

/** Emails you when an online client sends their weekly check-in. */
function notifyCheckin_(ss, client, checkins) {
  try {
    var to = Session.getEffectiveUser().getEmail();
    if (!to) return;
    var lines = checkins.map(function (c) {
      return (c.updated ? "Updated check-in" : "Check-in") + " for the week of " + c.week.split("-").reverse().join("/") + "\n" +
        CHECKIN_SCORES.map(function (s, i) { return s[1] + ": " + (c.scores[i] || "-"); }).join("  |  ") +
        (c.bw ? "\nBodyweight: " + c.bw : "") + (c.note ? "\n\nNote: " + c.note : "");
    });
    MailApp.sendEmail(to, "ScoutCo: check-in from " + (client.Name || "a client"),
      lines.join("\n\n") + "\n\n(1 = bad, 2 = OK, 3 = good)\n\nTo reply, type in the \"Reply from Kirst\" column on the Check-ins tab. " +
      "It shows in their app next time they open it:\n" + ss.getUrl());
  } catch (err) { /* email is a bonus; the check-in is already saved */ }
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
/** Keeps a weight like "1/2" or "40" exactly as typed (not turned into a date or number). */
function asText_(s) { return s ? "'" + s : ""; }
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
    .addItem("Set up online clients", "setupOnline")
    .addItem("Set up to-do list", "setupTodo")
    .addItem("Set up home swaps", "setupHomeSwaps")
    .addItem("Set up client profiles", "setupProfiles")
    .addItem("Set up Lift Club Community", "setupCommunity")
    .addItem("Set up push notifications", "setupPush")
    .addItem("Send me a test notification", "testPush")
    .addItem("Set up videos", "setupVideos")
    .addSeparator()
    .addItem("Send weekly summary now", "sendWeeklySummaryNow")
    .addItem("Turn on Monday email", "turnOnWeeklyEmail")
    .addItem("Turn off Monday email", "turnOffWeeklyEmail")
    .addToUi();
  try { formatDates_(); } catch (err) { /* not essential */ }
  try { updateWeeksLeft(true); } catch (err) { /* the menu item still works */ }
  // New exercises on Programs get a suggested home swap (only once the Home swaps tab is set up).
  try { var ss = SpreadsheetApp.getActiveSpreadsheet(); if (ss.getSheetByName(SWAPS_TAB)) syncHomeSwaps_(ss); } catch (err) { /* not essential */ }
  // New clients get a row on Profiles, and names and types stay in step with the Clients tab.
  try { var ss2 = SpreadsheetApp.getActiveSpreadsheet(); if (ss2.getSheetByName(PROFILES_TAB)) syncProfiles_(ss2); } catch (err) { /* not essential */ }
}

/** Shows the dates on Progress and Feedback as dd/mm/yyyy (new rows pick this up too). */
function formatDates_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  [PROGRESS_TAB, FEEDBACK_TAB, WEIGHTS_TAB, CHECKINS_TAB, PB_TAB].forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (sheet) sheet.getRange("A2:A").setNumberFormat("dd/mm/yyyy");
  });
  var ci = ss.getSheetByName(CHECKINS_TAB);
  if (ci) ci.getRange("B2:B").setNumberFormat("dd/mm/yyyy");
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
  var rows = weeksLeftRows_(ss);

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

/**
 * Works out, for each active client, their current block and week and how many written
 * weeks they have left. Each row: { code, name, left, now, week, lastDay, cells }.
 * left is -2 when their program can't be worked out yet (cells explain why).
 */
function weeksLeftRows_(ss) {
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
    var code = normalise_(c.Code);
    var opened = String(c["Last opened"] || "").trim() || "Not yet";
    var progName = String(c.Program || c.Name || "").trim();
    var key = progName.toLowerCase();
    var prog = programs[key];
    if (!prog) { rows.push({ code: code, name: name, left: -2, cells: [name, "", "", "", "", "No exercises on the Programs tab for \"" + progName + "\" yet", opened] }); return; }

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
      rows.push({ code: code, name: name, left: -2, cells: [name, "", "", "", "", why, opened] });
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
    rows.push({ code: code, name: name, left: left, now: nowText, week: weekText, lastDay: fromDayNo(lastEnd - 1),
      notStarted: today < firstStart, cells: [name, nowText, weekText, left, fromDayNo(lastEnd - 1), notes.filter(String).join(". "), opened] });
  });

  rows.sort(function (a, b) { return a.left - b.left; });
  // Put "no program yet" rows last.
  rows = rows.filter(function (r) { return r.left >= 0; }).concat(rows.filter(function (r) { return r.left < 0; }));

  return rows;
}

/* ------------------------------------------------------------------ */
/* Monday summary email: who trained, who's gone quiet, who to rebook.  */
/* ------------------------------------------------------------------ */

/** Run by the Monday trigger. */
function sendWeeklySummary() { sendSummary_(); }

/** ScoutCo menu → Send weekly summary now. */
function sendWeeklySummaryNow() {
  var to = sendSummary_();
  SpreadsheetApp.getUi().alert(to ? "Sent! Check your email (" + to + ")." : "Couldn't find your email address to send to.");
}

/** ScoutCo menu → Turn on Monday email. Safe to run again: it never makes two. */
function turnOnWeeklyEmail() {
  removeWeeklyTriggers_();
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  ScriptApp.newTrigger("sendWeeklySummary").timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).inTimezone(tz).create();
  SpreadsheetApp.getUi().alert("Done! You'll get a summary email every Monday at about 7am.\n\n" +
    "To see one straight away, choose ScoutCo → Send weekly summary now.");
}

/** ScoutCo menu → Turn off Monday email. */
function turnOffWeeklyEmail() {
  var n = removeWeeklyTriggers_();
  SpreadsheetApp.getUi().alert(n ? "The Monday email is turned off." : "The Monday email wasn't turned on.");
}

function removeWeeklyTriggers_() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendWeeklySummary") { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}

/** Builds and sends the summary of the last 7 days. Returns the address it went to. */
function sendSummary_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var now = new Date();
  var since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  var fmt = function (d) { return Utilities.formatDate(d, tz, "EEE d MMM"); };

  var clients = readTab_(ss, CLIENTS_TAB).filter(function (c) {
    // Your own Coach schedule isn't a client, so it stays out of the summary.
    return !isOff_(c.Active) && String(c.Code).trim() !== "" && !/\bcoach\b/i.test(String(c.Type || ""));
  });
  var plan = {};
  try { weeksLeftRows_(ss).forEach(function (r) { plan[r.code] = r; }); } catch (err) { /* summary still useful */ }

  var stats = {};
  clients.forEach(function (c) {
    stats[normalise_(c.Code)] = { sessions: {}, ticks: 0, home: 0, lastTick: null, weights: [], comments: 0, checkin: null };
  });
  var codeOf = function (key) { return normalise_(String(key).split("|")[0]); };

  var progSheet = ss.getSheetByName(PROGRESS_TAB);
  var homeCol = progSheet ? swapCol_(progSheet, false) : 0;
  rowsOf_(ss, PROGRESS_TAB, Math.max(8, homeCol)).forEach(function (r) {
    var st = stats[codeOf(r[7])];
    if (!st || r[6] !== "✓" || !(r[0] instanceof Date)) return;
    if (!st.lastTick || r[0] > st.lastTick) st.lastTick = r[0];
    if (r[0] >= since) {
      st.ticks++;
      st.sessions[[r[2], r[3], r[4]].join("|")] = true;
      if (homeCol && text_(r[homeCol - 1])) st.home++;
    }
  });
  rowsOf_(ss, WEIGHTS_TAB, 8).forEach(function (r) {
    var st = stats[codeOf(r[7])];
    var w = text_(r[6]).replace(/^'/, "");
    if (st && w && r[0] instanceof Date && r[0] >= since) st.weights.push({ ex: text_(r[5]), w: w, at: r[0] });
  });
  var byName = {};
  clients.forEach(function (c) { byName[String(c.Name || c.Code).trim().toLowerCase()] = stats[normalise_(c.Code)]; });
  rowsOf_(ss, FEEDBACK_TAB, 7).forEach(function (r) {
    var st = byName[String(r[1]).replace(/^'/, "").trim().toLowerCase()];
    if (st && r[0] instanceof Date && r[0] >= since) st.comments++;
  });

  // Online clients' check-ins from the last 7 days (the latest one per client).
  rowsOf_(ss, CHECKINS_TAB, CHECKIN_HEADERS.length).forEach(function (r) {
    var st = stats[codeOf(r[11])];
    if (!st || !(r[0] instanceof Date) || r[0] < since) return;
    if (!st.checkin || r[0] > st.checkin.at) {
      st.checkin = { at: r[0], scores: CHECKIN_SCORES.map(function (s, i) { return score_(r[3 + i]); }),
        bw: text_(r[8]).replace(/^'/, ""), note: text_(r[9]), reply: text_(r[10]) };
    }
  });

  // PBs in the last 7 days, and birthdays in the next 7.
  var celebrate = { pbs: [], birthdays: [] };
  try {
    var clientName = {};
    clients.forEach(function (c) { clientName[normalise_(c.Code)] = String(c.Name || c.Code).trim(); });
    rowsOf_(ss, PB_TAB, PB_HEADERS.length).forEach(function (r) {
      var nm = clientName[normalise_(r[7])];
      if (nm && r[0] instanceof Date && r[0] >= since) {
        celebrate.pbs.push(nm + ": " + text_(r[2]) + " " + text_(r[3]) + " kg" + (text_(r[4]) ? " (up from " + text_(r[4]) + " kg)" : ""));
      }
    });
    birthdaysSoon_(ss, 7).forEach(function (b) {
      if (clientName[b.code]) celebrate.birthdays.push(clientName[b.code] + ": " + Utilities.formatDate(b.date, tz, "EEEE d MMM") + (b.age ? " (turning " + b.age + ")" : ""));
    });
  } catch (err) { /* summary still useful */ }

  // Face to face and online clients each get their own section.
  var groups = [
    { title: "Face to face clients", online: false, quiet: [], rebook: [], setup: [], table: [] },
    { title: "Online clients", online: true, quiet: [], rebook: [], setup: [], table: [], noCheckin: [], reply: [], low: [] }
  ];
  clients.forEach(function (c) {
    var code = normalise_(c.Code), st = stats[code], p = plan[code] || {};
    var g = groups[isOnline_(c.Type) ? 1 : 0];
    var name = String(c.Name || c.Code).trim();
    var sessions = Object.keys(st.sessions).length;
    var opened = String(c["Last opened"] || "").trim();
    if (!sessions && !p.notStarted && p.left !== 0) {
      g.quiet.push(name + ": " + (st.lastTick ? "last ticked a session " + fmt(st.lastTick) : "hasn't ticked anything yet") +
        (opened ? ", last opened the app " + opened : ", hasn't opened the app yet"));
    }
    if (p.left === 0) g.rebook.push(name + ": program has run out");
    else if (p.left > 0 && p.left <= 2) g.rebook.push(name + ": " + p.left + " week" + (p.left === 1 ? "" : "s") + " left (last week ends " + fmt(p.lastDay) + ")");
    if (p.left != null && p.left < 0) g.setup.push(name + ": " + p.cells[5]);
    st.weights.sort(function (a, b) { return a.at - b.at; });
    var seen = {}, lifts = [];
    st.weights.forEach(function (x) { seen[x.ex.toLowerCase()] = x; });
    Object.keys(seen).forEach(function (k) { lifts.push(seen[k].ex + " " + seen[k].w); });
    var ci = st.checkin, pulse = "";
    if (g.online) {
      if (!ci) {
        g.noCheckin.push(name);
      } else {
        pulse = CHECKIN_SCORES.map(function (s, i) { return s[1] + " " + (ci.scores[i] || "-"); }).join(", ") + (ci.bw ? ", " + ci.bw : "");
        if (!ci.reply) g.reply.push(name + (ci.note ? ': "' + clip_(ci.note, 200) + '"' : ": no note, scores only"));
        var lows = CHECKIN_SCORES.filter(function (s, i) { return ci.scores[i] === 1; }).map(function (s) { return s[1]; });
        if (lows.length) g.low.push(name + ": " + lows.join(", "));
      }
    }
    g.table.push({ name: name, now: [p.now, p.week].filter(Boolean).join(", "), sessions: sessions,
      ticks: st.ticks, home: st.home,
      comments: st.comments, lifts: lifts, opened: opened || "Not yet", pulse: pulse || (g.online ? "No check-in" : "") });
  });
  groups = groups.filter(function (g) { return g.table.length; });
  groups.forEach(function (g) { g.table.sort(function (a, b) { return a.sessions - b.sessions || a.name.localeCompare(b.name); }); });

  var count = function (k) { return groups.reduce(function (n, g) { return n + (g[k] ? g[k].length : 0); }, 0); };
  var to = Session.getEffectiveUser().getEmail();
  if (!to) return "";
  var subject = "ScoutCo weekly summary, " + fmt(now) +
    (count("quiet") ? " · " + count("quiet") + " to check in with" : "") +
    (count("rebook") ? " · " + count("rebook") + " to rebook" : "") +
    (count("reply") ? " · " + count("reply") + " check-in" + (count("reply") === 1 ? "" : "s") + " to reply to" : "") +
    (celebrate.pbs.length ? " · " + plural_(celebrate.pbs.length, "PB") : "") +
    (celebrate.birthdays.length ? " · " + plural_(celebrate.birthdays.length, "birthday") : "");

  var h = function (t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
  var list = function (title, why, items, colour) {
    if (!items || !items.length) return "";
    return '<h3 style="margin:18px 0 4px;color:' + colour + '">' + h(title) + "</h3>" +
      '<div style="color:#6b7280;margin-bottom:6px">' + h(why) + "</div><ul style=\"margin:0;padding-left:20px\">" +
      items.map(function (i) { return "<li style=\"margin:3px 0\">" + h(i) + "</li>"; }).join("") + "</ul>";
  };
  var cell = 'style="padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top"';
  var section = function (g) {
    var heads = ["Client", "Now on", "Sessions", "Exercises ticked", "Comments", "Weights logged"].concat(g.online ? ["Check-in (1 bad, 3 good)"] : [], ["Last opened app"]);
    var empty = !g.quiet.length && !g.rebook.length && !g.setup.length && !(g.reply || []).length && !(g.noCheckin || []).length && !(g.low || []).length;
    return '<h2 style="margin:30px 0 4px;padding-bottom:6px;border-bottom:2px solid #8b5cf6">' + h(g.title) + " (" + g.table.length + ")</h2>" +
      list("Check in with", "No sessions ticked in the last 7 days.", g.quiet, "#b91c1c") +
      list("Low scores on their check-in", "Scored 1 (bad) on these.", g.low, "#b91c1c") +
      list("Check-ins waiting for your reply", "Type your reply on the Check-ins tab and it shows in their app.", g.reply, "#7c3aed") +
      list("No check-in this week", "Haven't sent their weekly pulse check in the last 7 days.", g.noCheckin, "#b45309") +
      list("Book their next block", "2 weeks or less left in their written program.", g.rebook, "#b45309") +
      list("Needs setting up", "The app can't work out their program yet.", g.setup, "#6b7280") +
      (empty ? "<p><b>Everyone trained" + (g.online ? ", checked in" : "") + " and nobody is running out. Nice!</b></p>" : "") +
      '<h3 style="margin:18px 0 6px">Last 7 days</h3>' +
      '<table style="border-collapse:collapse;width:100%;font-size:13px"><tr style="background:#ede9fe;text-align:left">' +
      heads.map(function (t) { return "<th " + cell + ">" + h(t) + "</th>"; }).join("") + "</tr>" +
      g.table.map(function (r) {
        return "<tr>" + [r.name, r.now, r.sessions, r.ticks + (r.home ? " (" + r.home + " swapped for home)" : ""), r.comments, r.lifts.join(", ") || ""].concat(g.online ? [r.pulse] : [], [r.opened]).map(function (v) {
          return "<td " + cell + ">" + h(v) + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</table>";
  };
  var html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#111827;max-width:760px">' +
    "<p>Here's how your clients went from " + h(fmt(since)) + " to " + h(fmt(now)) + ".</p>" +
    list("🏆 PBs this week", "New 1RMs logged in the app.", celebrate.pbs, "#047857") +
    list("🎂 Birthdays coming up", "In the next 7 days (from the Profiles tab).", celebrate.birthdays, "#7c3aed") +
    groups.map(section).join("") +
    '<p style="margin-top:22px"><a href="' + h(ss.getUrl()) + '">Open the ScoutCo sheet</a> for every tick, comment, weight and check-in.</p>' +
    '<p style="color:#9ca3af;font-size:12px">Clients whose Type on the Clients tab says "Online" are in the online section. ' +
    "Sent every Monday. To stop it: ScoutCo menu → Turn off Monday email.</p></div>";

  var block = function (title, items) { return items && items.length ? title + "\n- " + items.join("\n- ") + "\n\n" : ""; };
  var text = "ScoutCo weekly summary, " + fmt(since) + " to " + fmt(now) + "\n\n" +
    block("PBS THIS WEEK", celebrate.pbs) + block("BIRTHDAYS COMING UP", celebrate.birthdays) +
    groups.map(function (g) {
      return "===== " + g.title.toUpperCase() + " (" + g.table.length + ") =====\n\n" +
        block("CHECK IN WITH (no sessions in 7 days)", g.quiet) +
        block("LOW SCORES ON THEIR CHECK-IN", g.low) +
        block("CHECK-INS WAITING FOR YOUR REPLY", g.reply) +
        block("NO CHECK-IN THIS WEEK", g.noCheckin) +
        block("BOOK THEIR NEXT BLOCK (2 weeks or less left)", g.rebook) +
        block("NEEDS SETTING UP", g.setup) +
        "LAST 7 DAYS\n" + g.table.map(function (r) {
          return "- " + r.name + ": " + plural_(r.sessions, "session") + ", " + plural_(r.ticks, "exercise") + (r.home ? " (" + r.home + " swapped for home)" : "") + ", " + plural_(r.comments, "comment") +
            (r.lifts.length ? ". Weights: " + r.lifts.join(", ") : "") + (g.online ? ". Check-in: " + r.pulse : "");
        }).join("\n") + "\n\n";
    }).join("") + ss.getUrl();

  MailApp.sendEmail({ to: to, subject: subject, body: text, htmlBody: html });
  return to;
}

/* ------------------------------------------------------------------ */
/* Home swaps: a minimal-equipment version of an exercise for days a   */
/* client can't get to the gym. Squats, deadlifts and bench press stay */
/* gym only.                                                           */
/* ------------------------------------------------------------------ */

var SWAPS_TAB = "Home swaps";
var SWAP_HEADERS = ["Exercise", "Home swap", "How to do it", "Video"];
var NO_SWAP = "No swap";

/**
 * Back squat, deadlift and bench press (and their barbell variations) can't be swapped.
 * Other squats (front, goblet, split and so on) can.
 */
function isGymOnly_(name) {
  var n = String(name || "").toLowerCase();
  if (/\b(front|goblet|split|bulgarian|hack|sissy|jump|air|wall)\b/.test(n)) return false;
  if (!/\b(squat|deadlift|bench|larsen press|spoto press|rack pull)\b/.test(n)) return false;
  return !/\b(romanian|rdl|stiff|single-leg|kettlebell|lunge|db|dumbbell|push-up|hip thrust|step-up)\b/.test(n);
}

/**
 * Suggested home swaps, used to pre-fill the Home swaps tab. First match wins.
 * [pattern, home swap, how to do it]. A blank swap means it can already be done at home as written.
 */
var SWAP_RULES = [
  [/no conditioning/, "", ""],
  [/conditioning circuit/, "Home circuit: burpees / mountain climbers / skipping", "Same work and rest times, rotate through the three."],
  [/agility ladder/, "Ladder drills on the ground", "Mark a ladder with tape, chalk or a towel line and run the same patterns."],
  [/skip|shadow|ankle mobility|band pull-apart|band pallof|clam shell|dead bug|plank|push-up|broad jump|bound|burpee|walking lunge|walk cool|hill walk|hill sprint|glute bridge|single-leg hip thrust|single-leg rdl|bulgarian|split squat|goblet squat \(db\)|^goblet squat$|lateral raise|hammer curl|^dumbbell (reverse lunge|romanian|shoulder press)|^db (romanian|walking|hammer|bulgarian|shoulder press)|seated (db|dumbbell) shoulder press|neutral-grip db overhead press|half-kneeling single-arm|push press \(db|overhead dumbbell tricep|single-arm (db|dumbbell) row|walking db lunge|sandbag or db lunges|step-up/, "", ""],
  [/bike sprint/, "Hill or stair sprints", "Same work and rest times. Walk back down to recover."],
  [/ski erg|rowing machine|row or run|run or row|easy bike|treadmill/, "Run or brisk walk", "Same time or intervals, done outside. Hills or stairs make it harder."],
  [/battle rope/, "Fast mountain climbers or burpees", "Same work and rest times."],
  [/sled/, "Wall push sprints or a backpack hill walk", "Lean into a wall with straight arms and drive the knees hard for the same time, or walk up a hill with a loaded backpack."],
  [/depth jump/, "Drop from a low step into a squat jump", "Step off a low step, land soft, then jump straight up."],
  [/box jump|hurdle jump/, "Squat jump", "Land soft and quiet, stand tall and reset before each rep."],
  [/wall ball/, "DB or backpack thruster", "Squat, then drive the weight overhead as you stand."],
  [/chest pass/, "Explosive push-up", "Push hard enough that your hands leave the floor (or do it against a wall)."],
  [/med ball|landmine rotation/, "Band or light DB woodchop", "Rotate through the hips, arms long, same reps each side."],
  [/kettlebell swing/, "DB swing", "Hold one DB by the end and snap the hips like a kettlebell swing."],
  [/kettlebell deadlift/, "DB or backpack deadlift", "Slow lower, squeeze the glutes at the top."],
  [/pallof/, "Band Pallof press", "Anchor the band at chest height (door anchor or a post) and press it out without rotating."],
  [/face pull/, "Band face pull", "Anchor the band at face height and pull to your eyes, elbows high."],
  [/external rotation/, "Band external rotation", "Elbow tucked to your side (a rolled towel helps), rotate out slowly."],
  [/cable fly/, "Band chest fly", "Anchor the band behind you (or loop it around your back) and hug forward."],
  [/chest fly/, "Floor DB fly", "Lie on the floor so your elbows stop at the ground."],
  [/pulldown|pull-up|chin-up/, "Band lat pulldown", "Anchor a band high (top of a door) and pull your elbows down to your ribs. Pull-ups if you have a bar."],
  [/trx|ring row/, "Under-table row", "Lie under a sturdy table, hold the edge and pull your chest up to it. Or a band row."],
  [/single-arm cable row|cable single-arm row/, "Single-arm band row", "Anchor the band at chest height, pull the elbow back past your ribs."],
  [/chest-supported|bent-over row|barbell row|pendlay|cable row|seated cable|machine row|t-bar/, "DB or band bent-over row", "Hinge forward with a flat back and pull to your belly button."],
  [/curl \+ pushdown/, "Band curl + band pushdown", "Stand on the band for curls, then anchor it high for pushdowns."],
  [/hamstring curl|leg curl|glute-ham|nordic/, "Slider hamstring curl", "On your back, heels on a towel on a smooth floor. Lift the hips and slide the heels in and out."],
  [/incline (db|dumbbell) curl|bicep curl|cable bicep curl/, "Band or DB curl", "Stand on the band (or use DBs), slow on the way down."],
  [/pushdown/, "Band tricep pushdown", "Anchor the band high (top of a door) and push down, elbows pinned."],
  [/skull crusher/, "Floor DB skull crusher", "Lie on the floor, lower the DBs to beside your head."],
  [/incline (db|dumbbell) press|db incline press/, "Feet-elevated push-up", "Feet on a couch or step. Or a DB floor press."],
  [/flat db press|db bench press|dumbbell bench press/, "DB floor press", "Lie on the floor, lower until your elbows touch the ground."],
  [/landmine press/, "Half-kneeling single-arm DB press", "Press up and slightly forward, ribs down."],
  [/overhead press/, "DB or band overhead press", "Standing, ribs down, squeeze the glutes."],
  [/hip thrust/, "DB hip thrust off the couch", "Upper back on the couch, DB on the hips. Single-leg if it's too easy."],
  [/romanian deadlift|barbell rdl|stiff-leg/, "DB or backpack RDL", "Push the hips back, flat back, slow on the way down."],
  [/good morning/, "Band good morning", "Stand on the band, loop it behind your neck and hinge."],
  [/hack squat|front squat/, "Goblet squat (DB or backpack)", "Heels raised on a small plate or book if you like, slow on the way down."],
  [/leg press/, "Goblet squat (DB or backpack)", "3 seconds on the way down. Add a few reps to make up for the lighter load."],
  [/leg extension/, "Wall sit", "Hold for about as long as your set would take (30-45 s)."],
  [/adduct/, "Short-lever Copenhagen plank", "Top knee on the couch, lift your hips and hold."],
  [/abduct/, "Banded crab walk", "Band around the knees, stay low and step sideways."],
  [/calf raise/, "Single-leg calf raise off a step", "Full stretch at the bottom, pause at the top."],
  [/cable crunch/, "Kneeling band crunch", "Anchor the band high, kneel and crunch down."],
  [/ab wheel/, "Plank walk-out", "From standing, walk your hands out to a long plank and back. Or a towel rollout on a smooth floor."],
  [/hanging/, "Lying leg raise", "Lower back pressed into the floor the whole time."],
  [/farmer/, "Heavy bag or DB farmer carry", "Fill two bags (or use DBs), walk tall for the same distance or time."],
  [/suitcase carry/, "Heavy bag or DB suitcase carry", "One side only, don't lean. Same distance each side."]
];

/** The suggested swap for an exercise: [home swap, how to do it]. */
function suggestSwap_(name) {
  if (isGymOnly_(name)) return [NO_SWAP, "Gym only"];
  var n = String(name || "").toLowerCase().trim();
  for (var i = 0; i < SWAP_RULES.length; i++) {
    if (SWAP_RULES[i][0].test(n)) return [SWAP_RULES[i][1], SWAP_RULES[i][2]];
  }
  return ["", ""];
}

function swapKey_(name) { return String(name || "").trim().toLowerCase().replace(/\s+/g, " "); }

/**
 * The Home swaps tab as { "<exercise>": { name, how, video } or { locked: true } or {} (no swap) }.
 * Type "No swap" in the Home swap column to keep an exercise gym only, or leave it blank for no swap button.
 */
function homeSwaps_(ss) {
  var out = {};
  var sheet = ss.getSheetByName(SWAPS_TAB);
  if (!sheet || sheet.getLastRow() < 2) return out;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, SWAP_HEADERS.length).getDisplayValues().forEach(function (r) {
    var k = swapKey_(r[0]);
    if (!k) return;
    var swap = text_(r[1]);
    if (/^(no swap|gym only)/i.test(swap)) out[k] = { locked: true };
    else if (swap) out[k] = { name: swap, how: text_(r[2]), video: text_(r[3]) };
    else out[k] = {};
  });
  return out;
}

/** Adds each exercise's home swap (ex.home) or ex.locked, from the Home swaps tab or the built-in suggestions. */
function addHomeSwaps_(ss, blocks) {
  var tab = homeSwaps_(ss);
  blocks.forEach(function (b) {
    b.weeks.forEach(function (w) {
      w.days.forEach(function (d) {
        d.exercises.forEach(function (x) {
          var s = tab[swapKey_(x.name)];
          if (!s) {
            var sug = suggestSwap_(x.name);
            s = sug[0] === NO_SWAP ? { locked: true } : sug[0] ? { name: sug[0], how: sug[1] } : {};
          }
          if (s.locked) x.locked = true;
          else if (s.name) x.home = s;
        });
      });
    });
  });
  return blocks;
}

/**
 * Makes sure every exercise on the Programs tab has a row on the Home swaps tab, filled in with a
 * suggestion. Rows already there are never changed, so your own edits are kept. Returns how many it added.
 */
function syncHomeSwaps_(ss) {
  var sheet = ss.getSheetByName(SWAPS_TAB);
  var isNew = !sheet;
  if (isNew) {
    sheet = ss.insertSheet(SWAPS_TAB);
    sheet.appendRow(SWAP_HEADERS);
    styleHeader_(sheet, SWAP_HEADERS.length);
    sheet.setColumnWidth(1, 280);
    sheet.setColumnWidth(2, 280);
    sheet.setColumnWidth(3, 460);
    sheet.setColumnWidth(4, 200);
    // Gym only rows go grey, even ones you change later.
    var rule = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=REGEXMATCH(LOWER($B2),"^(no swap|gym only)")')
      .setBackground("#e5e7eb").setFontColor("#6b7280").setRanges([sheet.getRange("A2:D")]).build();
    sheet.setConditionalFormatRules([rule]);
  }
  var have = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) { have[swapKey_(r[0])] = true; });
  }
  var add = [];
  readTab_(ss, PROGRAMS_TAB).forEach(function (r) {
    var name = text_(r.Exercise), k = swapKey_(name);
    if (!k || have[k]) return;
    have[k] = true;
    var sug = suggestSwap_(name);
    add.push([cell_(name), sug[0], sug[1], ""]);
  });
  if (isNew) add.sort(function (a, b) { return a[0].toLowerCase() < b[0].toLowerCase() ? -1 : 1; });
  if (add.length) sheet.getRange(sheet.getLastRow() + 1, 1, add.length, SWAP_HEADERS.length).setValues(add);
  return add.length;
}

/**
 * A YouTube search for an exercise's demo. Used when the Video cell (on Programs or Home swaps) is empty.
 * The main lifts (gym only) don't get one. Paste your own video link in the Video column to use that instead.
 */
function demoLink_(name) {
  var q = String(name || "").split(/\s+[—–]\s+|:\s/)[0].trim();
  return q ? "https://www.youtube.com/results?search_query=" + encodeURIComponent(q + " exercise demo") : "";
}
function addDemoLinks_(blocks) {
  blocks.forEach(function (b) {
    b.weeks.forEach(function (w) {
      w.days.forEach(function (d) {
        d.exercises.forEach(function (x) {
          if (!x.video && !x.locked && !isGymOnly_(x.name)) x.video = demoLink_(x.name);
          if (x.home && !x.home.video) x.home.video = demoLink_(x.home.name);
        });
      });
    });
  });
  return blocks;
}

/** ScoutCo menu → Set up home swaps. */
function setupHomeSwaps() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var added = syncHomeSwaps_(ss);
  ss.setActiveSheet(ss.getSheetByName(SWAPS_TAB));
  SpreadsheetApp.getUi().alert("Done! " + (added ? added + " exercises added. " : "Every exercise is already listed. ") +
    "Clients see a \"Swap for home\" button on any exercise with something in the Home swap column.\n\n" +
    "Change any swap by typing over it. Type \"No swap\" to keep an exercise gym only, or clear the cell for no button. " +
    "New exercises you add to Programs get a row here each time you open the sheet.");
}

/** The Progress tab's "Home swap" column number (adds the heading if it isn't there yet). */
function swapCol_(sheet, create) {
  var width = Math.max(sheet.getLastColumn(), 1);
  var h = sheet.getRange(1, 1, 1, width).getDisplayValues()[0].map(function (x) { return String(x).trim().toLowerCase(); });
  var at = h.indexOf("home swap");
  if (at >= 0) return at + 1;
  if (!create) return 0;
  var col = width + 1;
  sheet.getRange(1, col).setValue("Home swap").setFontWeight("bold").setBackground("#ede9fe");
  sheet.setColumnWidth(col, 220);
  return col;
}

function plural_(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

/** All rows below the headings of a tab, as raw values (dates stay dates). */
function rowsOf_(ss, name, width) {
  var sheet = ss.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
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
  tab_(ss, WEIGHTS_TAB, WEIGHT_HEADERS).setColumnWidth(6, 220);
  setupCheckinsTab_(ss);
  setupSettingsTab_(ss);
  todoTab_(ss);

  var first = ss.getSheets()[0];
  if (first.getName() !== CLIENTS_TAB && first.getName() !== PROGRAMS_TAB && first.getLastRow() === 0) {
    ss.deleteSheet(first);
  }
  SpreadsheetApp.getUi().alert("Done! Your tabs are ready.");
}

/** The Check-ins tab, with the reply column highlighted so it's easy to spot. */
function setupCheckinsTab_(ss) {
  var sheet = tab_(ss, CHECKINS_TAB, CHECKIN_HEADERS);
  sheet.getRange("B2:B").setNumberFormat("dd/mm/yyyy");
  sheet.setColumnWidth(10, 320);
  sheet.setColumnWidth(11, 320);
  sheet.getRange(1, 11).setBackground("#bbf7d0");
  return sheet;
}

/** The Settings tab: one setting per row (Setting | Value). */
function setupSettingsTab_(ss) {
  var sheet = ss.getSheetByName(SETTINGS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS_TAB);
    sheet.appendRow(["Setting", "Value"]);
    styleHeader_(sheet, 2);
    sheet.setColumnWidth(1, 240);
    sheet.setColumnWidth(2, 480);
  }
  var names = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1).getDisplayValues().map(function (r) { return String(r[0]).trim().toLowerCase(); });
  if (names.indexOf(BOOKING_SETTING.toLowerCase()) === -1) sheet.appendRow([BOOKING_SETTING, BOOKING_DEFAULT]);
  return sheet;
}

/** ScoutCo menu → Set up online clients: adds the Check-ins and Settings tabs. */
function setupOnline() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  setupCheckinsTab_(ss);
  ss.setActiveSheet(setupSettingsTab_(ss));
  SpreadsheetApp.getUi().alert("Done! The Book a check-in call button uses the link next to \"" +
    BOOKING_SETTING + "\" on the Settings tab. You can change it there any time.\n\nOnline clients' check-ins will land on the Check-ins tab. " +
    "Type your reply in the green \"Reply from Kirst\" column.");
}

/** ScoutCo menu → Set up to-do list: adds the To-do tab. */
function setupTodo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setActiveSheet(todoTab_(ss));
  SpreadsheetApp.getUi().alert("Done! Type a task in the Task column (one per row) and tick the Done box when it's finished.\n\n" +
    "Tasks show in the To-do tab of your coach app, and anything you add or tick there lands here too.");
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

/* ------------------------------------------------------------------ */
/* Client profiles: photo, 1RMs, date of birth, goals, hobbies, food.  */
/* Name and Type come from the Clients tab. Clients fill in the rest.  */
/* ------------------------------------------------------------------ */

var PROFILES_TAB = "Profiles";
// [field the app uses, heading on the tab]. Columns are found by heading, so you can move them around.
var PROFILE_COLS = [
  ["name", "Client"], ["type", "Type"], ["photo", "Photo"], ["dob", "Date of birth"], ["age", "Age"],
  ["squat", "Back squat 1RM (kg)"], ["deadlift", "Deadlift 1RM (kg)"], ["bench", "Bench press 1RM (kg)"],
  ["goals", "Health and fitness goals"], ["hobbies", "Hobbies and interests"], ["food", "Favourite food"],
  ["updated", "Updated"], ["code", "Code"], ["photoData", "Photo data"]
];
var PB_TAB = "PBs";
var PB_HEADERS = ["Date", "Client", "Lift", "New 1RM (kg)", "Old 1RM (kg)", "Logged on", "ID", "Code"];
var LIFT_COLS = { squat: "squat", deadlift: "deadlift", bench: "bench" };

function safely_(fn, fallback) { try { return fn(); } catch (err) { return fallback; } }

/** The Profiles tab, created the first time it's needed. */
function profilesTab_(ss) {
  var sheet = ss.getSheetByName(PROFILES_TAB);
  if (sheet) return sheet;
  sheet = ss.insertSheet(PROFILES_TAB);
  var heads = PROFILE_COLS.map(function (c) { return c[1]; });
  sheet.appendRow(heads);
  styleHeader_(sheet, heads.length);
  sheet.setFrozenColumns(1);
  var widths = { name: 160, type: 130, photo: 90, dob: 110, age: 50, goals: 320, hobbies: 280, food: 180, updated: 110, code: 100, photoData: 60 };
  PROFILE_COLS.forEach(function (c, i) { if (widths[c[0]]) sheet.setColumnWidth(i + 1, widths[c[0]]); });
  sheet.getRange(2, 4, sheet.getMaxRows() - 1, 1).setNumberFormat("dd/mm/yyyy");
  sheet.getRange(2, 12, sheet.getMaxRows() - 1, 1).setNumberFormat("dd/mm/yyyy");
  // The photo is also kept as text so the app can show it. That column is hidden.
  sheet.getRange(1, 14, sheet.getMaxRows(), 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sheet.hideColumns(14);
  sheet.getRange(1, 3, 1, 9).setBackground("#bbf7d0"); // what the client fills in
  return sheet;
}

/** Where each Profiles column is (1-based), found by heading. Missing headings are added on the right. */
function profileCols_(sheet) {
  var width = Math.max(sheet.getLastColumn(), 1);
  var h = sheet.getRange(1, 1, 1, width).getDisplayValues()[0].map(function (x) { return String(x).trim().toLowerCase(); });
  var cols = {};
  PROFILE_COLS.forEach(function (c) {
    var at = h.indexOf(c[1].toLowerCase());
    if (at < 0) {
      at = h.length;
      h.push(c[1].toLowerCase());
      sheet.getRange(1, at + 1).setValue(c[1]).setFontWeight("bold").setBackground("#ede9fe");
    }
    cols[c[0]] = at + 1;
  });
  cols.width = h.length;
  return cols;
}

function colLetter_(n) { var s = ""; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

/** The row number for this client on Profiles, adding a row (with their name and type) if they don't have one. */
function profileRow_(sheet, cols, client, create) {
  var code = normalise_(client.Code);
  var last = sheet.getLastRow();
  if (last >= 2) {
    var codes = sheet.getRange(2, cols.code, last - 1, 1).getDisplayValues();
    for (var i = 0; i < codes.length; i++) if (normalise_(codes[i][0]) === code) return i + 2;
  }
  if (!create) return 0;
  var row = last + 1;
  sheet.getRange(row, cols.code).setValue(code);
  fillClientCells_(sheet, cols, row, client);
  return row;
}

/** Name, Type and the Age formula: kept in step with the Clients tab. */
function fillClientCells_(sheet, cols, row, client) {
  sheet.getRange(row, cols.name).setValue(cell_(String(client.Name || "")));
  sheet.getRange(row, cols.type).setValue(cell_(String(client.Type || "")));
  var dob = colLetter_(cols.dob) + row;
  sheet.getRange(row, cols.age).setFormula('=IF(' + dob + '="","",DATEDIF(' + dob + ',TODAY(),"Y"))');
}

/** This client's profile for the app, or null if they don't have a row yet. */
function profileFor_(ss, code) { return profilesByCode_(ss)[code] || null; }

/** Every filled-in row on the Profiles tab, as { "<code>": { dob, squat, ..., photo, at } }. */
function profilesByCode_(ss) {
  var out = {};
  var sheet = ss.getSheetByName(PROFILES_TAB);
  if (!sheet || sheet.getLastRow() < 2) return out;
  var cols = profileCols_(sheet);
  var tz = ss.getSpreadsheetTimeZone();
  sheet.getRange(2, 1, sheet.getLastRow() - 1, cols.width).getValues().forEach(function (r) {
    var code = normalise_(r[cols.code - 1]);
    if (!code) return;
    var get = function (f) { return text_(r[cols[f] - 1]).replace(/^'/, ""); };
    var dob = toDate_(r[cols.dob - 1]);
    var upd = r[cols.updated - 1];
    var p = { dob: dob ? Utilities.formatDate(dob, tz, "yyyy-MM-dd") : "", at: upd instanceof Date ? upd.getTime() : 0 };
    ["goals", "hobbies", "food"].forEach(function (f) { p[f] = get(f); });
    ["squat", "deadlift", "bench"].forEach(function (f) { var n = kg_(r[cols[f] - 1]); p[f] = n ? String(n) : ""; });
    var photo = get("photoData");
    p.photo = /^data:image\//.test(photo) ? photo : "";
    // A row with only name and type (from Set up client profiles) counts as not filled in yet.
    var filled = ["dob", "goals", "hobbies", "food", "squat", "deadlift", "bench", "photo"].some(function (f) { return p[f]; });
    if (filled || p.at) out[code] = p;
  });
  return out;
}

/** This client's last 20 PBs, newest first. */
function pbsFor_(ss, code) {
  var out = [];
  rowsOf_(ss, PB_TAB, PB_HEADERS.length).forEach(function (r) {
    if (normalise_(r[7]) !== code) return;
    out.push({ at: r[0] instanceof Date ? r[0].getTime() : 0, lift: text_(r[2]), kg: kg_(r[3]), prev: kg_(r[4]) });
  });
  out.sort(function (a, b) { return b.at - a.at; });
  return out.slice(0, 20);
}

/** A weight in kg from a cell like 100, "100", "100 kg". 0 if there isn't one. */
function kg_(v) {
  if (typeof v === "number") return v > 0 && v < 1000 ? Math.round(v * 2) / 2 : 0;
  var m = String(v == null ? "" : v).replace(",", ".").match(/\d+(?:\.\d+)?/);
  var n = m ? parseFloat(m[0]) : 0;
  return n > 0 && n < 1000 ? Math.round(n * 2) / 2 : 0;
}

/** Saves the profile the client filled in on the app. */
function saveProfile_(ss, client, ev) {
  var sheet = profilesTab_(ss), cols = profileCols_(sheet);
  var row = profileRow_(sheet, cols, client, true);
  fillClientCells_(sheet, cols, row, client);
  var dob = String(ev.dob || "");
  sheet.getRange(row, cols.dob).setValue(/^\d{4}-\d{2}-\d{2}$/.test(dob) ? Utilities.parseDate(dob, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd") : "");
  ["squat", "deadlift", "bench"].forEach(function (f) { var n = kg_(ev[f]); sheet.getRange(row, cols[f]).setValue(n || ""); });
  ["goals", "hobbies", "food"].forEach(function (f) { sheet.getRange(row, cols[f]).setValue(cell_(clip_(ev[f], 1000).trim())); });
  sheet.getRange(row, cols.updated).setValue(new Date());
  setPhoto_(sheet, cols, row, client, String(ev.photo || ""));
}

/** Puts the photo in the sheet (so you can see it) and in the hidden Photo data column (for the app). */
function setPhoto_(sheet, cols, row, client, photo) {
  var ok = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(photo) && photo.length <= 48000;
  var current = text_(sheet.getRange(row, cols.photoData).getValue());
  if (ok && current === photo) return; // same photo as before
  if (!ok) {
    sheet.getRange(row, cols.photoData).setValue("");
    sheet.getRange(row, cols.photo).setValue("");
    return;
  }
  sheet.getRange(row, cols.photoData).setValue(photo);
  try {
    var img = SpreadsheetApp.newCellImage().setSourceUrl(photo).setAltTextTitle(String(client.Name || "Photo")).build();
    sheet.getRange(row, cols.photo).setValue(img);
    sheet.setRowHeight(row, 80);
  } catch (err) {
    sheet.getRange(row, cols.photo).setValue("✓ in app");
  }
}

/** A client beat their 1RM: log it on the PBs tab and update Profiles (only ever upwards). */
function savePb_(ss, client, ev) {
  var field = LIFT_COLS[String(ev.liftId || "")];
  var kg = kg_(ev.kg);
  if (!field || !kg) return;
  var pbs = tab_(ss, PB_TAB, PB_HEADERS);
  var ids = pbs.getRange(1, 7, Math.max(pbs.getLastRow(), 1), 1).getValues().map(function (r) { return String(r[0]); });
  if (ids.indexOf(String(ev.id)) !== -1) return; // already saved
  var where = [ev.exercise, ev.weight ? "logged " + clip_(ev.weight, 40) : "", ev.block, ev.week, ev.session].map(function (x) { return clip_(x, 100).trim(); }).filter(String).join(" · ");
  pbs.appendRow([new Date(), cell_(String(client.Name || client.Code)), cell_(clip_(ev.lift, 40)), kg, kg_(ev.prev) || "", cell_(where), String(ev.id), normalise_(client.Code)]);

  var sheet = profilesTab_(ss), cols = profileCols_(sheet);
  var row = profileRow_(sheet, cols, client, true);
  var cell = sheet.getRange(row, cols[field]);
  if (kg > kg_(cell.getValue())) cell.setValue(kg);
  sheet.getRange(row, cols.updated).setValue(new Date());
}

/** Gives every active client (not your Coach row) a Profiles row, and refreshes names and types. */
function syncProfiles_(ss) {
  var sheet = profilesTab_(ss), cols = profileCols_(sheet), added = 0;
  readTab_(ss, CLIENTS_TAB).forEach(function (c) {
    if (!String(c.Code || "").trim() || isOff_(c.Active) || isCoach_(c.Type)) return;
    var row = profileRow_(sheet, cols, c, false);
    if (!row) { profileRow_(sheet, cols, c, true); added++; }
    else {
      var cur = sheet.getRange(row, 1, 1, cols.width).getDisplayValues()[0];
      if (cur[cols.name - 1] !== String(c.Name || "") || cur[cols.type - 1] !== String(c.Type || "")) fillClientCells_(sheet, cols, row, c);
    }
  });
  return added;
}

/** Clients with a birthday in the next `days` days: [{ code, date, age }]. */
function birthdaysSoon_(ss, days) {
  var sheet = ss.getSheetByName(PROFILES_TAB);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var cols = profileCols_(sheet), out = [];
  var now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  sheet.getRange(2, 1, sheet.getLastRow() - 1, cols.width).getValues().forEach(function (r) {
    var dob = toDate_(r[cols.dob - 1]);
    if (!dob) return;
    for (var y = today.getFullYear(); y <= today.getFullYear() + 1; y++) {
      var next = new Date(y, dob.getMonth(), dob.getDate());
      var diff = Math.round((next - today) / 864e5);
      if (diff >= 0 && diff < days) { out.push({ code: normalise_(r[cols.code - 1]), date: next, age: y - dob.getFullYear() }); break; }
      if (diff >= 0) break;
    }
  });
  return out.sort(function (a, b) { return a.date - b.date; });
}

/** ScoutCo menu → Set up client profiles. */
function setupProfiles() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var added = syncProfiles_(ss);
  tab_(ss, PB_TAB, PB_HEADERS).setColumnWidth(6, 360);
  coachTab_(ss);
  ss.setActiveSheet(ss.getSheetByName(PROFILES_TAB));
  SpreadsheetApp.getUi().alert("Done! " + (added ? added + " clients added to the Profiles tab. " : "Every client is already on the Profiles tab. ") +
    "Names and types come from the Clients tab. The green columns fill in when clients complete their profile in the app.\n\n" +
    "When a client logs a weight heavier than their 1RM on back squat, deadlift or bench press, they get a PB pop-up, " +
    "their 1RM updates here and the PB is listed on the PBs tab. PBs and birthdays also show in your Monday email.\n\n" +
    "Your own profile goes on the Coach profile tab. Fill it in from the Profile tab of your coach app (or type it there), and clients see it on their ScoutCo HQ tab.");
}

/* ------------------------------------------------------------------ */
/* Your coach profile (clients see it) and every client's profile      */
/* for your coach app.                                                 */
/* ------------------------------------------------------------------ */

var COACH_TAB = "Coach profile";
// [field the app uses, label in column A]. Type straight into column B to change anything.
var COACH_ROWS = [
  ["photo", "Photo"], ["about", "About me"], ["quals", "Qualifications and experience"],
  ["hobbies", "Hobbies and interests"], ["food", "Favourite food"], ["updated", "Updated"], ["photoData", "Photo data (for the app)"]
];

/** The Coach profile tab: one row per item, with the label in column A and your answer in column B. */
function coachTab_(ss) {
  var sheet = ss.getSheetByName(COACH_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(COACH_TAB);
    sheet.appendRow(["Item", "Your answer"]);
    styleHeader_(sheet, 2);
    sheet.setColumnWidth(1, 240);
    sheet.setColumnWidth(2, 520);
  }
  var labels = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1).getDisplayValues().map(function (r) { return String(r[0]).trim().toLowerCase(); });
  COACH_ROWS.forEach(function (r) {
    if (labels.indexOf(r[1].toLowerCase()) === -1) { sheet.appendRow([r[1], ""]); labels.push(r[1].toLowerCase()); }
  });
  var dataRow = labels.indexOf(COACH_ROWS[6][1].toLowerCase()) + 1;
  sheet.getRange(dataRow, 2).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  if (!sheet.isRowHiddenByUser(dataRow)) sheet.hideRows(dataRow);
  sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).setVerticalAlignment("top");
  return sheet;
}

/** Row number of each item on the Coach profile tab: { about: 3, ... }. */
function coachRows_(sheet) {
  var labels = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1).getDisplayValues().map(function (r) { return String(r[0]).trim().toLowerCase(); });
  var rows = {};
  COACH_ROWS.forEach(function (r) { var at = labels.indexOf(r[1].toLowerCase()); if (at >= 0) rows[r[0]] = at + 1; });
  return rows;
}

/** Your profile for the app, or null if the tab isn't there yet. */
function coachProfile_(ss) {
  var sheet = ss.getSheetByName(COACH_TAB);
  if (!sheet || sheet.getLastRow() < 2) return null;
  var rows = coachRows_(sheet);
  var vals = sheet.getRange(1, 2, sheet.getLastRow(), 1).getValues();
  var get = function (f) { return rows[f] ? text_(vals[rows[f] - 1][0]) : ""; };
  var photo = get("photoData");
  var upd = rows.updated ? vals[rows.updated - 1][0] : "";
  return { photo: /^data:image\//.test(photo) ? photo : "", about: get("about"), quals: get("quals"), hobbies: get("hobbies"), food: get("food"),
    at: upd instanceof Date ? upd.getTime() : 0 };
}

/** Saves what you typed on the Profile tab of your coach app. */
function saveCoachProfile_(ss, client, ev) {
  var sheet = coachTab_(ss), rows = coachRows_(sheet);
  ["about", "quals", "hobbies", "food"].forEach(function (f) { sheet.getRange(rows[f], 2).setValue(cell_(clip_(ev[f], 2000).trim())); });
  sheet.getRange(rows.updated, 2).setValue(new Date()).setNumberFormat("dd/mm/yyyy h:mm am/pm");
  var photo = String(ev.photo || "");
  var ok = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(photo) && photo.length <= 48000;
  if (ok && text_(sheet.getRange(rows.photoData, 2).getValue()) === photo) return;
  sheet.getRange(rows.photoData, 2).setValue(ok ? photo : "");
  sheet.getRange(rows.photo, 2).setValue("");
  if (!ok) return;
  try {
    sheet.getRange(rows.photo, 2).setValue(SpreadsheetApp.newCellImage().setSourceUrl(photo).setAltTextTitle("Coach photo").build());
    sheet.setRowHeight(rows.photo, 120);
  } catch (err) {
    sheet.getRange(rows.photo, 2).setValue("✓ in app");
  }
}

/** Every active client's profile (and latest PBs) for your coach app, in the Clients tab's order. */
function clientProfiles_(ss) {
  var out = [], byCode = {}, profiles = profilesByCode_(ss), salt = safely_(communitySalt_, "");
  readTab_(ss, CLIENTS_TAB).forEach(function (c) {
    var code = normalise_(c.Code);
    if (!code || isOff_(c.Active) || isCoach_(c.Type)) return;
    var p = profiles[code] || {};
    var row = { name: String(c.Name || ""), type: String(c.Type || ""), photo: p.photo || "", dob: p.dob || "",
      squat: p.squat || "", deadlift: p.deadlift || "", bench: p.bench || "", goals: p.goals || "", hobbies: p.hobbies || "", food: p.food || "",
      at: p.at || (p.dob || p.goals || p.photo ? 1 : 0), pbs: [], vid: salt ? personId_(code, salt) : "" };
    byCode[code] = row;
    out.push(row);
  });
  rowsOf_(ss, PB_TAB, PB_HEADERS.length).forEach(function (r) {
    var row = byCode[normalise_(r[7])];
    if (row) row.pbs.push({ at: r[0] instanceof Date ? r[0].getTime() : 0, lift: text_(r[2]), kg: kg_(r[3]), prev: kg_(r[4]) });
  });
  out.forEach(function (row) { row.pbs.sort(function (a, b) { return b.at - a.at; }); row.pbs = row.pbs.slice(0, 5); });
  return out;
}

/* ------------------------------------------------------------------ */
/* Lift Club Community: a board where every client and coach can post, */
/* react and reply. Tick "Hide" on the tab to take a post down.        */
/* ------------------------------------------------------------------ */

var COMMUNITY_TAB = "Lift Club Community";
var COMMUNITY_HEADERS = ["Posted", "From", "Post", "Replying to", "Hide", "Reactions", "ID", "Reply to ID", "Reaction data", "Code"];
var COMMUNITY_REACTIONS = ["💪", "🔥", "👏", "❤️"];
var COMMUNITY_SHOW = 60; // newest posts sent to the app (each with all its replies)
// [column, 1-based]. The tab is created with these, in this order.
var CC = { at: 1, from: 2, text: 3, replyTo: 4, hide: 5, reactions: 6, id: 7, parent: 8, data: 9, code: 10 };

/** The Lift Club Community tab, created the first time it's needed. */
function communityTab_(ss) {
  var sheet = ss.getSheetByName(COMMUNITY_TAB);
  if (sheet) return sheet;
  sheet = ss.insertSheet(COMMUNITY_TAB);
  sheet.appendRow(COMMUNITY_HEADERS);
  styleHeader_(sheet, COMMUNITY_HEADERS.length);
  sheet.setColumnWidth(CC.at, 130);
  sheet.setColumnWidth(CC.from, 130);
  sheet.setColumnWidth(CC.text, 420);
  sheet.setColumnWidth(CC.replyTo, 220);
  sheet.setColumnWidth(CC.hide, 60);
  sheet.setColumnWidth(CC.reactions, 140);
  sheet.getRange(2, CC.at, sheet.getMaxRows() - 1, 1).setNumberFormat("dd/mm/yyyy h:mm am/pm");
  sheet.getRange(2, CC.text, sheet.getMaxRows() - 1, 2).setWrap(true);
  sheet.getRange(1, CC.hide).setBackground("#fecaca").setNote("Tick to hide a post (and its replies) from everyone. Untick to bring it back.");
  sheet.hideColumns(CC.id, 4); // ID, Reply to ID, Reaction data, Code: the app needs these, you don't
  return sheet;
}

/** A private, random salt so the app can tell people apart without ever seeing anyone's code. */
function communitySalt_() {
  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty("communitySalt");
  if (!salt) { salt = Utilities.getUuid(); props.setProperty("communitySalt", salt); }
  return salt;
}
function personId_(code, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + "|" + normalise_(code));
  return bytes.slice(0, 8).map(function (b) { return ((b + 256) % 256).toString(16).replace(/^(.)$/, "0$1"); }).join("");
}

/** The name shown on posts: first name and last initial ("Ali V."). Coaches show their first name. */
function communityName_(client) {
  var parts = String(client.Name || "").trim().split(/\s+/).filter(String);
  if (!parts.length) return isCoach_(client.Type) ? "Coach" : "ScoutCo member";
  var first = parts[0];
  if (isCoach_(client.Type)) return /^kirst/i.test(first) ? "Kirst" : first;
  return first + (parts.length > 1 ? " " + parts[parts.length - 1].charAt(0).toUpperCase() + "." : "");
}

function reactionData_(v) {
  try { var o = JSON.parse(String(v || "{}")); return o && typeof o === "object" ? o : {}; } catch (err) { return {}; }
}
function reactionSummary_(data) {
  return COMMUNITY_REACTIONS.filter(function (e) { return (data[e] || []).length; })
    .map(function (e) { return e + " " + data[e].length; }).join("  ");
}

/** Every row on the tab: [{ row, at, text, hide, id, parent, data, code }]. */
function communityRows_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, COMMUNITY_HEADERS.length).getValues().map(function (r, i) {
    return { row: i + 2, at: r[CC.at - 1] instanceof Date ? r[CC.at - 1].getTime() : 0, from: text_(r[CC.from - 1]),
      text: text_(r[CC.text - 1]).replace(/^'/, ""), hide: isTicked_(r[CC.hide - 1]), id: text_(r[CC.id - 1]),
      parent: text_(r[CC.parent - 1]), data: reactionData_(r[CC.data - 1]), code: normalise_(r[CC.code - 1]) };
  }).filter(function (p) { return p.id && p.text; });
}

/** What the Lift Club Community tab in the app shows: the newest posts, their replies, and who wrote them. */
function communityFeed_(ss, code) {
  var sheet = ss.getSheetByName(COMMUNITY_TAB);
  var salt = communitySalt_();
  var me = personId_(code, salt);
  if (!sheet) return { me: me, posts: [], people: {} };

  var all = communityRows_(sheet);
  var visible = {};
  all.forEach(function (p) { if (!p.hide && !p.parent) visible[p.id] = p; });
  var tops = Object.keys(visible).map(function (k) { return visible[k]; })
    .sort(function (a, b) { return b.at - a.at; }).slice(0, COMMUNITY_SHOW);
  var shown = {};
  tops.forEach(function (p) { shown[p.id] = true; });
  var replies = all.filter(function (p) { return !p.hide && p.parent && shown[p.parent]; });

  // Names and photos, looked up now so a new photo shows on old posts too.
  var clients = {}, profiles = safely_(function () { return profilesByCode_(ss); }, {});
  readTab_(ss, CLIENTS_TAB).forEach(function (c) { if (normalise_(c.Code)) clients[normalise_(c.Code)] = c; });
  var coachPhoto = null;
  var people = {}, ids = {};
  var item = function (p) {
    var pid = ids[p.code] || (ids[p.code] = personId_(p.code, salt));
    if (!people[pid]) {
      var c = clients[p.code], coach = !!(c && isCoach_(c.Type)), photo = "";
      if (coach) {
        if (coachPhoto === null) coachPhoto = safely_(function () { return (coachProfile_(ss) || {}).photo || ""; }, "");
        photo = coachPhoto;
      } else if (c && profiles[p.code]) photo = profiles[p.code].photo || "";
      people[pid] = { name: c ? communityName_(c) : (p.from || "ScoutCo member"), photo: photo, coach: coach };
    }
    var counts = {}, mine = [];
    COMMUNITY_REACTIONS.forEach(function (e) {
      var who = p.data[e] || [];
      if (who.length) counts[e] = who.length;
      if (who.indexOf(me) !== -1) mine.push(e);
    });
    return { id: p.id, by: pid, at: p.at, text: p.text, parent: p.parent || "", counts: counts, mine: mine };
  };
  return { me: me, posts: tops.map(item).concat(replies.map(item)), people: people, reactions: COMMUNITY_REACTIONS };
}

/** When the newest post (not your own) went up, so the app can put a dot on the tab. */
function communityLatest_(ss, code) {
  var sheet = ss.getSheetByName(COMMUNITY_TAB);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var last = sheet.getLastRow(), from = Math.max(2, last - 49);
  var latest = 0;
  sheet.getRange(from, 1, last - from + 1, COMMUNITY_HEADERS.length).getValues().forEach(function (r) {
    var at = r[CC.at - 1] instanceof Date ? r[CC.at - 1].getTime() : 0;
    if (at > latest && !isTicked_(r[CC.hide - 1]) && normalise_(r[CC.code - 1]) !== code) latest = at;
  });
  return latest;
}

/**
 * Saves the app's community events: "post" (a post or a reply), "react" (tap an emoji) and "unpost"
 * (someone deletes their own post, or a coach hides any post). Returns the new posts, for the email.
 */
function saveCommunity_(ss, client, events) {
  var sheet = communityTab_(ss);
  var rows = communityRows_(sheet);
  var byId = {};
  rows.forEach(function (p) { byId[p.id] = p; });
  var code = normalise_(client.Code), me = personId_(code, communitySalt_());
  var name = communityName_(client), coach = isCoach_(client.Type);
  var posted = [];
  events.forEach(function (ev) {
    if (ev.type === "post") {
      var id = clip_(ev.id, 40), text = clip_(ev.text, 2000).trim();
      if (!text || byId[id]) return; // empty, or already saved
      var parent = byId[clip_(ev.parent, 40)];
      if (ev.parent && (!parent || parent.parent)) parent = null; // replies go on top-level posts only
      if (ev.parent && !parent) return;
      var row = [new Date(), cell_(name), cell_(text), parent ? cell_(parent.from + ": " + clip_(parent.text, 60) + (parent.text.length > 60 ? "…" : "")) : "",
        false, "", id, parent ? parent.id : "", "{}", code];
      sheet.appendRow(row);
      var at = sheet.getLastRow();
      sheet.getRange(at, CC.hide).insertCheckboxes();
      byId[id] = { row: at, id: id, text: text, from: name, parent: parent ? parent.id : "", data: {}, code: code };
      // Who gets a notification: everyone for a new post; for a reply, whoever wrote the post or replied to it.
      var to = null;
      if (parent) {
        to = [parent.code];
        Object.keys(byId).forEach(function (k) { if (byId[k].parent === parent.id) to.push(byId[k].code); });
      }
      posted.push({ text: text, reply: parent ? parent.from + ": " + clip_(parent.text, 80) : "", to: to });
    } else if (ev.type === "react") {
      var p = byId[clip_(ev.post, 40)], e = String(ev.emoji || "");
      if (!p || COMMUNITY_REACTIONS.indexOf(e) === -1) return;
      var who = (p.data[e] || []).filter(function (x) { return x !== me; });
      if (ev.on) who.push(me);
      if (who.length) p.data[e] = who; else delete p.data[e];
      sheet.getRange(p.row, CC.reactions).setValue(reactionSummary_(p.data));
      sheet.getRange(p.row, CC.data).setValue(JSON.stringify(p.data));
    } else if (ev.type === "unpost") {
      var q = byId[clip_(ev.post, 40)];
      if (!q || (q.code !== code && !coach)) return; // clients can only delete their own posts
      sheet.getRange(q.row, CC.hide).setValue(true);
      if (q.code === code) sheet.getRange(q.row, CC.from).setValue(cell_(q.from + " (deleted it)"));
    }
  });
  return posted;
}

/** Emails you when a client posts, so you always know what's going up. */
function notifyCommunity_(ss, client, posts) {
  if (!posts.length || isCoach_(client.Type)) return;
  try {
    var to = Session.getEffectiveUser().getEmail();
    if (!to) return;
    var lines = posts.map(function (p) { return (p.reply ? "Reply to " + p.reply + "\n" : "") + p.text; });
    MailApp.sendEmail(to, "ScoutCo: Lift Club Community post from " + communityName_(client),
      lines.join("\n\n") + "\n\nTo take a post down, tick Hide on the Lift Club Community tab (or tap Hide in your coach app):\n" + ss.getUrl());
  } catch (err) { /* email is a bonus; the post is already saved */ }
}

/** ScoutCo menu: makes the Lift Club Community tab. */
function setupCommunity() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = communityTab_(ss);
  communitySalt_();
  ss.setActiveSheet(sheet);
  SpreadsheetApp.getUi().alert("Done! The Lift Club Community tab is ready.\n\n" +
    "Every client and coach now has a Lift Club Community tab in their app where they can post, react and reply. " +
    "Each post shows up here, and you get an email when a client posts.\n\n" +
    "To take a post down, tick its Hide box (untick to bring it back), or tap Hide on the post in your coach app. " +
    "You can also delete the row.");
}

/* ------------------------------------------------------------------ */
/* Push notifications for the Lift Club Community, sent by OneSignal   */
/* (free). Your OneSignal App ID and API key go on the Settings tab.   */
/* ------------------------------------------------------------------ */

var PUSH_APP_SETTING = "OneSignal App ID";
var PUSH_KEY_SETTING = "OneSignal API key";
var APP_URL = "https://scoutco01.github.io/scoutco-app/";

/** Sends a notification through OneSignal to these people (personId_ values). Tapping it opens that tab of the app. Returns OneSignal's reply. */
function sendPush_(ss, ids, title, message, view) {
  var appId = setting_(ss, PUSH_APP_SETTING), key = setting_(ss, PUSH_KEY_SETTING);
  if (!appId || !key || !ids.length) return null;
  var res = UrlFetchApp.fetch("https://api.onesignal.com/notifications?c=push", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: (/^(Key|Basic) /.test(key) ? "" : "Key ") + key },
    payload: JSON.stringify({
      app_id: appId, target_channel: "push", include_aliases: { external_id: ids },
      headings: { en: title }, contents: { en: clip_(message, 180) }, url: APP_URL + "?view=" + (view || "community")
    }),
    muteHttpExceptions: true
  });
  return { code: res.getResponseCode(), body: res.getContentText() };
}

/** After someone posts: a notification to everyone else (a new post), or to the people in that thread (a reply). */
function pushCommunity_(ss, client, posted) {
  if (!setting_(ss, PUSH_APP_SETTING) || !setting_(ss, PUSH_KEY_SETTING)) return;
  var salt = communitySalt_(), mine = normalise_(client.Code), name = communityName_(client);
  var everyone = readTab_(ss, CLIENTS_TAB).filter(function (c) { return normalise_(c.Code) && !isOff_(c.Active); })
    .map(function (c) { return normalise_(c.Code); });
  posted.forEach(function (p) {
    var codes = (p.to || everyone).filter(function (c, i, all) { return c && c !== mine && all.indexOf(c) === i && everyone.indexOf(c) !== -1; });
    var ids = codes.map(function (c) { return personId_(c, salt); });
    sendPush_(ss, ids, "Lift Club Community", (p.to ? name + " replied: " : name + ": ") + p.text);
  });
}

/** ScoutCo menu: adds the two OneSignal rows to the Settings tab. */
function setupPush() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = setupSettingsTab_(ss);
  var names = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1).getDisplayValues().map(function (r) { return String(r[0]).trim().toLowerCase(); });
  [PUSH_APP_SETTING, PUSH_KEY_SETTING].forEach(function (n) { if (names.indexOf(n.toLowerCase()) === -1) sheet.appendRow([n, ""]); });
  ss.setActiveSheet(sheet);
  SpreadsheetApp.getUi().alert("Nearly there! On the Settings tab, paste your OneSignal App ID and API key next to their names.\n\n" +
    "Then open your app, go to Lift Club Community, tap Turn on notifications, and come back here and run ScoutCo > Send me a test notification.");
}

/** ScoutCo menu: sends a test notification to every coach's phone. */
function testPush() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), ui = SpreadsheetApp.getUi();
  if (!setting_(ss, PUSH_APP_SETTING) || !setting_(ss, PUSH_KEY_SETTING)) {
    ui.alert("First paste your OneSignal App ID and API key on the Settings tab (ScoutCo > Set up push notifications adds the rows).");
    return;
  }
  var salt = communitySalt_();
  var ids = readTab_(ss, CLIENTS_TAB).filter(function (c) { return normalise_(c.Code) && isCoach_(c.Type) && !isOff_(c.Active); })
    .map(function (c) { return personId_(c.Code, salt); });
  if (!ids.length) { ui.alert("No row on the Clients tab has the Type Coach, so there's no one to send it to."); return; }
  var r = sendPush_(ss, ids, "Lift Club Community", "Test notification. If you can see this, notifications are working! 🎉");
  var ok = r && r.code === 200 && !/"errors"/.test(r.body);
  if (r && r.code === 200 && /invalid_aliases|not subscribed/i.test(r.body)) {
    ui.alert("OneSignal is connected, but your phone isn't signed up for notifications yet.\n\n" +
      "Open your app, go to Lift Club Community and tap Turn on notifications (on iPhone, open the app from your home screen first). Then try this again.");
    return;
  }
  ui.alert(ok ? "Sent! It should pop up on your phone in a few seconds.\n\nNothing showing? Check you tapped Turn on notifications in the Lift Club Community tab of your app, on that phone."
    : "OneSignal didn't send it. Check the App ID and API key on the Settings tab.\n\nWhat OneSignal said: " + (r ? r.code + " " + clip_(r.body, 300) : "no reply"));
}

/* ------------------------------------------------------------------ */
/* Videos. You send a client a video from their session, and clients  */
/* send you form videos of their back squat, deadlift and bench press. */
/* The files go into a "ScoutCo videos" folder in your Google Drive.   */
/* ------------------------------------------------------------------ */

var VIDEOS_TAB = "Videos";
var VIDEO_HEADERS = ["Uploaded", "Client", "Type", "Lift", "Note", "Reply from Kirst", "Hide", "Video", "File ID", "ID", "Code", "Replied"];
// [column, 1-based]. The tab is created with these, in this order.
var VC = { at: 1, client: 2, type: 3, lift: 4, note: 5, reply: 6, hide: 7, link: 8, file: 9, id: 10, code: 11, replied: 12 };
var VIDEO_FROM_COACH = "From Kirst";
var VIDEO_FORM = "Form check";
var VIDEO_LIFTS = ["Back squat", "Deadlift", "Bench press"];
var VIDEO_FOLDER = "ScoutCo videos";
var VIDEO_CHUNK = 8 * 1024 * 1024;        // the app sends videos in 8 MB pieces (Drive needs multiples of 256 KB)
var VIDEO_MAX = 500 * 1024 * 1024;        // biggest video the app accepts
var VIDEO_SHOW = 150;                     // newest videos sent to your coach app

/** The Videos tab, created the first time it's needed. */
function videosTab_(ss) {
  var sheet = ss.getSheetByName(VIDEOS_TAB);
  if (sheet) return sheet;
  sheet = ss.insertSheet(VIDEOS_TAB);
  sheet.appendRow(VIDEO_HEADERS);
  styleHeader_(sheet, VIDEO_HEADERS.length);
  sheet.setColumnWidth(VC.at, 130);
  sheet.setColumnWidth(VC.client, 140);
  sheet.setColumnWidth(VC.type, 100);
  sheet.setColumnWidth(VC.lift, 110);
  sheet.setColumnWidth(VC.note, 260);
  sheet.setColumnWidth(VC.reply, 300);
  sheet.setColumnWidth(VC.hide, 60);
  sheet.setColumnWidth(VC.link, 260);
  sheet.getRange(2, VC.at, sheet.getMaxRows() - 1, 1).setNumberFormat("dd/mm/yyyy h:mm am/pm");
  sheet.getRange(2, VC.note, sheet.getMaxRows() - 1, 2).setWrap(true);
  sheet.getRange(1, VC.reply).setNote("Type a reply to a client's form video here and it shows under the video in their app (or reply from the Videos tab of your coach app).");
  sheet.getRange(1, VC.hide).setBackground("#fecaca").setNote("Tick to take a video out of the app. The file stays in your Drive.");
  sheet.hideColumns(VC.file, 4); // File ID, ID, Code, Replied: the app needs these, you don't
  return sheet;
}

/** The "ScoutCo videos" folder in your Drive (made the first time). Only you can open it. */
function videoFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("videoFolder");
  if (id) {
    try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (err) { /* deleted: make a new one */ }
  }
  var found = DriveApp.getFoldersByName(VIDEO_FOLDER);
  var folder = found.hasNext() ? found.next() : DriveApp.createFolder(VIDEO_FOLDER);
  props.setProperty("videoFolder", folder.getId());
  return folder;
}

function videoLift_(s) {
  s = String(s || "").trim().toLowerCase();
  for (var i = 0; i < VIDEO_LIFTS.length; i++) if (VIDEO_LIFTS[i].toLowerCase() === s) return VIDEO_LIFTS[i];
  return "";
}

/** Active, non-coach client whose community id matches (the coach app picks clients by this id, never by code). */
function clientByPersonId_(ss, pid) {
  var salt = communitySalt_(), list = readTab_(ss, CLIENTS_TAB);
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (normalise_(c.Code) && !isOff_(c.Active) && !isCoach_(c.Type) && personId_(c.Code, salt) === String(pid || "")) return c;
  }
  return null;
}

/**
 * Uploads come in pieces, because a phone video is far bigger than one message can carry.
 *   start:  the app says what's coming; Drive gives us an upload address, kept here for 6 hours
 *   chunk:  one piece of the video, passed straight on to Drive
 *   status: after a dropped connection, how much Drive already has, so the app can carry on
 */
function handleVideo_(ss, client, v) {
  if (!v || typeof v !== "object") return { error: "Bad request" };
  var cache = CacheService.getScriptCache();
  var me = normalise_(client.Code);

  if (v.op === "start") {
    var size = Math.floor(Number(v.size) || 0);
    if (size <= 0) return { error: "That video looks empty." };
    if (size > VIDEO_MAX) return { error: "That video is too big. Trim it to under " + Math.round(VIDEO_MAX / 1048576) + " MB and try again." };
    var mime = /^video\/[a-z0-9.+-]+$/i.test(String(v.mime || "")) ? String(v.mime) : "video/mp4";
    var job = { code: me, size: size, mime: mime, note: clip_(v.note, 1000).trim() };
    if (isCoach_(client.Type)) {
      var to = clientByPersonId_(ss, v.to);
      if (!to) return { error: "Pick a client to send it to." };
      job.kind = VIDEO_FROM_COACH; job.to = normalise_(to.Code); job.toName = String(to.Name || to.Code);
      job.lift = clip_(v.lift, 60).trim();
    } else {
      job.kind = VIDEO_FORM; job.to = me; job.toName = String(client.Name || client.Code);
      job.lift = videoLift_(v.lift);
      if (!job.lift) return { error: "Form videos are for back squat, deadlift and bench press." };
    }
    var ext = (/\.([a-z0-9]{2,4})$/i.exec(String(v.name || "")) || [, mime.split("/")[1] === "quicktime" ? "mov" : "mp4"])[1].toLowerCase();
    var stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd HHmm");
    var fileName = [job.toName, stamp, job.kind === VIDEO_FORM ? job.lift + " form check" : (job.lift || "session")].join(" - ") + "." + ext;
    var res = UrlFetchApp.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id", {
      method: "post",
      contentType: "application/json; charset=UTF-8",
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken(), "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(size) },
      payload: JSON.stringify({ name: fileName, mimeType: mime, parents: [videoFolder_().getId()] }),
      muteHttpExceptions: true
    });
    var url = header_(res, "Location");
    if (res.getResponseCode() !== 200 || !url) return { error: "Google Drive didn't take the video (" + res.getResponseCode() + "). Try again soon." };
    job.url = String(url);
    var upload = Utilities.getUuid();
    cache.put("video:" + upload, JSON.stringify(job), 21600);
    return { ok: true, upload: upload, chunk: VIDEO_CHUNK };
  }

  var raw = cache.get("video:" + String(v.upload || ""));
  if (!raw) return { error: "That upload timed out. Please try again.", restart: true };
  var j = JSON.parse(raw);
  if (j.code !== me) return { error: "Bad request" };

  if (v.op === "status") {
    var st = UrlFetchApp.fetch(j.url, { method: "put", headers: { "Content-Range": "bytes */" + j.size }, payload: "", muteHttpExceptions: true, followRedirects: false });
    return videoProgress_(ss, j, st, v.upload);
  }

  if (v.op === "chunk") {
    var start = Math.floor(Number(v.start) || 0);
    var bytes = Utilities.base64Decode(String(v.data || ""));
    var end = start + bytes.length - 1;
    var last = end + 1 === j.size;
    if (start < 0 || !bytes.length || end >= j.size || (!last && bytes.length % (256 * 1024) !== 0)) return { error: "Bad request" };
    var put = UrlFetchApp.fetch(j.url, {
      method: "put",
      contentType: j.mime,
      headers: { "Content-Range": "bytes " + start + "-" + end + "/" + j.size },
      payload: bytes,
      muteHttpExceptions: true,
      followRedirects: false
    });
    return videoProgress_(ss, j, put, v.upload);
  }
  return { error: "Bad request" };
}

/** A reply header, whatever case the server wrote its name in. */
function header_(res, name) {
  var h = res.getAllHeaders(), want = name.toLowerCase();
  for (var k in h) if (k.toLowerCase() === want) return String(Array.isArray(h[k]) ? h[k][0] : h[k]);
  return "";
}

/** Reads Drive's answer: 308 means "send the next piece", 200/201 means the video is all there. */
function videoProgress_(ss, j, res, upload) {
  var code = res.getResponseCode();
  if (code === 308) {
    var range = header_(res, "Range");
    var m = /-(\d+)\s*$/.exec(range);
    return { ok: true, next: m ? Number(m[1]) + 1 : 0 };
  }
  if (code === 200 || code === 201) {
    var fileId = "";
    try { fileId = JSON.parse(res.getContentText()).id || ""; } catch (err) { /* handled below */ }
    if (!fileId) return { error: "Drive saved it but didn't say where. Check the ScoutCo videos folder." };
    CacheService.getScriptCache().remove("video:" + upload);
    return { ok: true, done: true, video: finishVideo_(ss, j, fileId) };
  }
  if (code === 404 || code === 410) return { error: "That upload timed out. Please try again.", restart: true };
  return { error: "Google Drive had a hiccup (" + code + ").", retry: true };
}

/** The video is in Drive: let the app play it, add it to the Videos tab, and let the right person know. */
function finishVideo_(ss, j, fileId) {
  var link = "https://drive.google.com/file/d/" + fileId + "/view";
  var shared = true;
  try {
    var file = DriveApp.getFileById(fileId);
    // "Anyone with the link can view" is what lets the app play it without a Google sign-in.
    // The link is long and random, and only this client's app (and yours) is ever given it.
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    file.setDescription(j.kind + " for " + j.toName + (j.lift ? " (" + j.lift + ")" : "") + (j.note ? ": " + j.note : ""));
  } catch (err) { shared = false; }
  var id = "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = videosTab_(ss);
    sheet.appendRow([new Date(), cell_(j.toName), j.kind, cell_(j.lift), cell_(j.note), "", false, link, fileId, id, j.to, ""]);
    sheet.getRange(sheet.getLastRow(), VC.hide).insertCheckboxes();
  } finally {
    lock.releaseLock();
  }
  var who = readTab_(ss, CLIENTS_TAB).filter(function (c) { return normalise_(c.Code) === j.to; })[0] || { Name: j.toName, Code: j.to };
  if (j.kind === VIDEO_FORM) {
    try {
      var to = Session.getEffectiveUser().getEmail();
      if (to) MailApp.sendEmail(to, "ScoutCo: " + j.lift.toLowerCase() + " form video from " + j.toName,
        (j.note ? j.toName + " says: " + j.note + "\n\n" : "") + "Watch it: " + link +
        "\n\nReply from the Videos tab of your coach app, or type it in the Reply from Kirst column on the Videos tab:\n" + ss.getUrl());
    } catch (err) { /* email is a bonus */ }
    safely_(function () {
      var salt = communitySalt_();
      var coaches = readTab_(ss, CLIENTS_TAB).filter(function (c) { return normalise_(c.Code) && isCoach_(c.Type) && !isOff_(c.Active); })
        .map(function (c) { return personId_(c.Code, salt); });
      sendPush_(ss, coaches, "New form video", communityName_(who) + " sent a " + j.lift.toLowerCase() + " video for you to check", "videos");
    }, null);
  } else {
    safely_(function () {
      sendPush_(ss, [personId_(j.to, communitySalt_())], "New video from Kirst", "Kirst sent you a video" + (j.lift ? " of your " + j.lift.toLowerCase() : " from your session") + ". Tap to watch.", "videos");
    }, null);
  }
  return { id: id, at: Date.now(), kind: j.kind === VIDEO_FORM ? "form" : "coach", lift: j.lift, note: j.note, reply: "", file: fileId, shared: shared,
    client: j.toName, who: personId_(j.to, communitySalt_()) };
}

/** Videos for the app: a client gets their own, the coach gets everyone's (newest first). */
function videosFor_(ss, code, coach) {
  var sheet = ss.getSheetByName(VIDEOS_TAB);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, VIDEO_HEADERS.length).getValues();
  var salt = coach ? communitySalt_() : "", ids = {};
  var out = [];
  rows.forEach(function (r) {
    var rc = normalise_(r[VC.code - 1]), file = text_(r[VC.file - 1]);
    if (!file || !rc || isTicked_(r[VC.hide - 1])) return;
    if (!coach && rc !== code) return;
    var v = { id: text_(r[VC.id - 1]), at: r[VC.at - 1] instanceof Date ? r[VC.at - 1].getTime() : 0,
      kind: text_(r[VC.type - 1]) === VIDEO_FORM ? "form" : "coach", lift: text_(r[VC.lift - 1]), note: text_(r[VC.note - 1]),
      reply: text_(r[VC.reply - 1]), file: file };
    if (coach) { v.client = text_(r[VC.client - 1]); v.who = ids[rc] || (ids[rc] = personId_(rc, salt)); }
    out.push(v);
  });
  out.sort(function (a, b) { return b.at - a.at; });
  return coach ? out.slice(0, VIDEO_SHOW) : out;
}

/** From the app: your reply to a form video, or taking a video down. */
function saveVideoEvent_(ss, client, ev) {
  var sheet = ss.getSheetByName(VIDEOS_TAB);
  if (!sheet || sheet.getLastRow() < 2) return;
  var ids = sheet.getRange(2, VC.id, sheet.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); });
  var at = ids.indexOf(String(ev.video || ""));
  if (at === -1) return;
  var row = at + 2, coach = isCoach_(client.Type);
  var rowCode = normalise_(sheet.getRange(row, VC.code).getValue());
  if (ev.type === "videoreply") {
    if (!coach) return;
    var text = clip_(ev.text, 2000).trim();
    sheet.getRange(row, VC.reply).setValue(cell_(text));
    sheet.getRange(row, VC.replied).setValue(new Date());
    if (text) return { to: rowCode, lift: text_(sheet.getRange(row, VC.lift).getValue()) };
  } else if (ev.type === "videohide") {
    if (!coach && rowCode !== normalise_(client.Code)) return; // clients can only take down their own
    sheet.getRange(row, VC.hide).setValue(true);
    try { DriveApp.getFileById(text_(sheet.getRange(row, VC.file).getValue())).setTrashed(true); } catch (err) { /* already gone */ }
  }
}

/** ScoutCo menu: makes the Videos tab and the Drive folder (and asks Google for permission to use your Drive). */
function setupVideos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = videosTab_(ss);
  var folder = videoFolder_();
  communitySalt_();
  ss.setActiveSheet(sheet);
  SpreadsheetApp.getUi().alert("Done! Videos are ready.\n\n" +
    "Send a client a video: open your coach app, go to the Videos tab, pick the client and choose a video.\n\n" +
    "Form checks: on back squat, deadlift and bench press, clients now have a \"Send Kirst a form video\" button. " +
    "You get an email, and the video shows on the Videos tab of your coach app where you can watch it and reply.\n\n" +
    "Every video is saved in the \"" + folder.getName() + "\" folder in your Google Drive and listed on this Videos tab. " +
    "Tick Hide to take one out of the app.");
}
