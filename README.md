# ScoutCo Training app

A free, ScoutCo-branded app your clients save to their phone's home screen. Each client opens it with a private code and sees only their own program. You write and update programs in a Google Sheet, and clients see the changes the next time they open the app.

- **The app** (this folder) is hosted free on GitHub Pages.
- **Your programs** live in a private Google Sheet. A small script inside the sheet hands each client only their own program.
- **Try it now:** open the app and enter the code `DEMO`.

---

## One-time setup: connect your Google Sheet (about 10 minutes)

1. Go to [sheets.new](https://sheets.new) to create a new Google Sheet, and name it **ScoutCo Programs**.
2. In the sheet, open **Extensions → Apps Script**.
3. Open the [plain-text script](https://raw.githubusercontent.com/ScoutCo01/scoutco-app/main/google-apps-script/Code.gs), select all (Ctrl+A or Cmd+A) and copy it. Delete everything in the Apps Script code box, paste, and click the 💾 **Save** icon.
4. Go back to your sheet and refresh the page. A **ScoutCo** menu appears at the top. Choose **ScoutCo → Set up tabs**. It's safe to run again: it only adds tabs that are missing.
   - Google will ask you to authorise the script. Click **Continue**, pick your account, then **Advanced → Go to (unsafe)** → **Allow**. The "unsafe" warning appears because you wrote the script yourself and Google hasn't reviewed it. It only reads and writes this one sheet.
5. Back in **Apps Script**, click **Deploy → New deployment**.
   - Click the ⚙️ next to "Select type" and choose **Web app**.
   - **Execute as:** *Me*
   - **Who has access:** *Anyone*
   - Click **Deploy**, then copy the **Web app URL**. It ends in `/exec`.
6. Send that URL to Claude in your project thread, and Claude will connect the app to your sheet.

"Anyone" only means anyone can *ask* the script for a program. The script only answers with the program that matches a valid client code, and your sheet itself stays private.

## Adding a client

1. In the sheet, choose **ScoutCo → Add a new client** and type their name.
2. You'll get a private code like `SC-7Q4K9X`, and a new row is added on the **Clients** tab.
3. On the **Programs** tab, add their exercises, one row per exercise, with their name in the **Program** column.

To give two clients the same program, put the same name in their **Program** column on the Clients tab.

To stop a client's access, change **Active** to `No`.

**Message** shows as a "From Kirst" note at the top of that client's app. (The name clients see is set by `coachName` in `config.js`.)

**Type** (e.g. Online only, Weekly, Fortnightly) and **Sessions** (e.g. Mondays at 7:15 pm) show in a "Your sessions" box at the top of the app. Add these two column headings to the Clients tab if they're not there, in any empty columns.

## Writing a program (Programs tab)

| Column | What to put | Example |
|---|---|---|
| Program | The program's name (usually the client's name) | Jake Smith |
| Block | Training block (optional) | Block 1 |
| Week | Groups days into tabs | Week 1 |
| Day | Session name | Day 1 · Lower |
| Order | Exercise order or label | A1, A2, B1 |
| Exercise | Exercise name | Back squat |
| Sets / Reps / Load / Tempo / Rest | Anything you like, or leave blank | 4 / 6 / 80% / 3-1-1 / 2 min |
| Notes | Coaching cues | Brace hard |
| Video | A YouTube or Instagram link | https://youtu.be/... |

### Blocks and dates (Blocks tab)

Program blocks in advance. On the **Blocks** tab, add one row per block: **Program** (client name), **Block** (same name as on the Programs tab) and **Start date** (the first day of Week 1). Week 2 starts 7 days later, and so on.

When a client opens the app, it jumps to the current block and week. They can still tap any block, week or session. Blocks with no start date still show, but the app won't pick them automatically.

Changes are live as soon as you type them. Clients see them the next time they open the app.

## Seeing what clients do (Progress and Feedback tabs)

- **Progress:** each time a client ticks or unticks an exercise, a row is updated with ✓ and the time.
- **Feedback:** each session has a "Comments for Kirst" box. Comments land here, and you get an email for each one.
- **Weights:** under each exercise there's a "Weight used" box. Whatever the client types (for example "40 kg") is saved here, one row per exercise per session. Next time that exercise comes up, the app shows "Last time: 40 kg". Filter the Exercise or Client column to see someone's progress on a lift.

These tabs are created automatically (or by **ScoutCo → Set up tabs**). If a client is offline, the app keeps their ticks and comments and sends them when they're back online.

## Home swaps (training at home)

If a client can't get to the gym, they can tap **⇄ Swap for home** on an exercise (or **Swap all for home** at the top of a session) to see a version they can do with minimal equipment: bodyweight, bands or light dumbbells. Sets, reps and rest stay the same; the load is hidden and your "How to do it" note shows instead. Back squat, deadlift and bench press (and their barbell variations) are gym only and can't be swapped. Other squats like front or goblet squats can be swapped.

The swaps live on the **Home swaps** tab (Exercise | Home swap | How to do it | Video). Choose **ScoutCo → Set up home swaps** once and it lists every exercise on your Programs tab with a suggested swap. Then:

- Type over any swap or note to change it.
- Type `No swap` in **Home swap** to keep an exercise gym only (those rows go grey).
- Leave **Home swap** empty when the exercise can already be done at home (no button shows).

New exercises you add to Programs get a row with a suggestion each time you open the sheet. When a client ticks a swapped exercise, what they did shows in the **Home swap** column of the Progress tab, and the Monday email says how many exercises each client swapped.

## Weeks left (when to write the next block)

The **Weeks left** tab shows every active client with their current block and week, how many written weeks they have left (counting this week), and the date their last written week ends. Nothing needs ticking: it works it out from the Blocks tab start dates and the number of weeks on the Programs tab.

- **Yellow:** 2 weeks or fewer left, time to write the next block.
- **Red:** their program has run out.
- A block with no start date is worked out from the blocks around it (it starts when the block before ends, or ends when the next one starts).
- If a client shows no dates, the Heads up column says why (for example, block names that differ between the Programs and Blocks tabs).

It refreshes every time you open the sheet, or any time from **ScoutCo → Update weeks left**.

## Online clients

Set a client's **Type** on the Clients tab to anything with "Online" in it (for example `Online only`). Their app then gets:

- **Check-in tab: a weekly pulse check.** Sleep, Nutrition, Energy, Soreness and Head noise (anxiety/stress), each scored 1 = bad, 2 = OK, 3 = good, plus optional bodyweight and a "Note for Kirst". A yellow dot shows on the tab until they've done this week's (weeks run Monday to Sunday). They can update it during the week.
- **Your replies in the app.** Check-ins land on the **Check-ins** tab and you get an email for each one. Type your reply in the green **Reply from Kirst** column. It shows at the top of their app as "Reply from Kirst" the next time they open it (for 3 weeks), and under that check-in on their Check-in tab.
- **Book a check-in call button**, shown in the second-last week of the block they're on (week 3 of a 4-week block). It opens the link on the **Settings** tab next to **Check-in call booking link**. Leave it blank to hide the button.

Every client (online or face to face) also gets a **Progress tab**: a streak (weeks in a row with at least one session ticked), sessions trained this block, sessions this week, a sessions-per-week chart, and a chart for each lift they've logged a weight for. Online clients also see their pulse check scores and bodyweight over time.

To set up the tabs: **ScoutCo → Set up online clients**.

## Monday summary email

Once a week you get one email covering the last 7 days, split into **Face to face clients** and **Online clients**:

- **Check in with:** clients who haven't ticked a session in 7 days, with when they last trained and last opened the app.
- **Book their next block:** clients with 2 weeks or less left (or whose program has run out).
- **Last 7 days:** a table of every client with sessions done, exercises ticked, comments and the weights they logged.
- **Online clients also get:** low scores (anyone who scored a 1), check-ins waiting for your reply, and who hasn't checked in this week. Their table shows each check-in's scores.

Turn it on once with **ScoutCo → Turn on Monday email** (Google asks for permission the first time). It arrives every Monday at about 7am. **ScoutCo → Send weekly summary now** sends one straight away, and **ScoutCo → Turn off Monday email** stops it.

## When a client last opened the app

Each time a client opens the app, the time is saved in a **Last opened** column on the Clients tab (added automatically the first time). It also shows on the Weeks left tab.

## Your own coach schedule

Add yourself as a client on the Clients tab and set **Type** to `Coach`. Your app then becomes a weekly schedule:

- On the Programs tab, use your own program name. Make each **Day** a weekday (e.g. Monday), and each row a client, e.g. Order `1`, Exercise `6:30pm Jonny`.
- Under each client there's a **Session notes** box instead of "Weight used". Notes save to a **Session notes** tab, and the app shows your note from their last session.
- Your schedule has no "Comments for your coach" box and is left out of the Monday email.

### Your to-do list

Your coach app has a **To-do** tab next to **Schedule**. Type a task (e.g. `Send Lauren invoice`) and tap **Add**, tick it off when it's done, or tap ✕ to delete it.

Everything is kept on the **To-do** tab of your sheet (Task | Done | Added | Done on | ID), so you can also work from there: type a task in the **Task** column and tick the **Done** box. The Added and Done on dates fill in by themselves. Changes in the sheet show in the app next time it opens or comes back to the front. Leave the **ID** column alone; the app uses it to match tasks up.

If the tab isn't there yet, choose **ScoutCo → Set up to-do list**. Only the Clients row with Type `Coach` gets a to-do list.

## Sending the app to a client

**Tip:** to get every client's link in the sheet, paste this into cell **F1** of the Clients tab:

```
={"Link"; ARRAYFORMULA(IF(A2:A="", "", "https://scoutco01.github.io/scoutco-app/?code=" & A2:A))}
```

Text each client their personal link:

```
https://scoutco01.github.io/scoutco-app/?code=SC-7Q4K9X
```

That link signs them straight in. Then they add the app to their home screen:

- **iPhone:** open the link in **Safari**, tap **Share**, then **Add to Home Screen**.
- **Android:** open the link in **Chrome**, tap **Install** (or the menu ⋮ then **Add to Home screen**).

## Changing the look

- **Logo:** the files in `icons/` were made from the ScoutCo logo. Send Claude a new one to update them.
- **Colours:** see the top of `styles.css`.
