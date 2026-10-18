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

**Message** shows as a "From your coach" note at the top of that client's app.

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
- **Feedback:** each session has a "Comments for your coach" box. Comments land here, and you get an email for each one.

Both tabs are created automatically (or by **ScoutCo → Set up tabs**). If a client is offline, the app keeps their ticks and comments and sends them when they're back online.

## Weeks left (when to write the next block)

The **Weeks left** tab shows every active client with their current block and week, how many written weeks they have left (counting this week), and the date their last written week ends. Nothing needs ticking: it works it out from the Blocks tab start dates and the number of weeks on the Programs tab.

- **Yellow:** 2 weeks or fewer left, time to write the next block.
- **Red:** their program has run out.
- A block with no start date is counted as starting straight after the block before it.

It refreshes every time you open the sheet, or any time from **ScoutCo → Update weeks left**.

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
