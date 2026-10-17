# ScoutCo Training app

A free, ScoutCo-branded app your clients save to their phone's home screen. Each client opens it with a private code and sees only their own program. You write and update programs in a Google Sheet, and clients see the changes the next time they open the app.

- **The app** (this folder) is hosted free on GitHub Pages.
- **Your programs** live in a private Google Sheet. A small script inside the sheet hands each client only their own program.
- **Try it now:** open the app and enter the code `DEMO`.

---

## One-time setup: connect your Google Sheet (about 10 minutes)

1. Go to [sheets.new](https://sheets.new) to create a new Google Sheet, and name it **ScoutCo Programs**.
2. In the sheet, open **Extensions → Apps Script**.
3. Delete everything in the code box. Then paste in the full contents of [`google-apps-script/Code.gs`](google-apps-script/Code.gs) and click the 💾 **Save** icon.
4. Go back to your sheet and refresh the page. A **ScoutCo** menu appears at the top. Choose **ScoutCo → Set up tabs (first time only)**.
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

## Writing a program (Programs tab)

| Column | What to put | Example |
|---|---|---|
| Program | The program's name (usually the client's name) | Jake Smith |
| Week | Groups days into tabs | Week 1 |
| Day | Session name | Day 1 · Lower |
| Order | Exercise order or label | A1, A2, B1 |
| Exercise | Exercise name | Back squat |
| Sets / Reps / Load / Tempo / Rest | Anything you like, or leave blank | 4 / 6 / 80% / 3-1-1 / 2 min |
| Notes | Coaching cues | Brace hard |
| Video | A YouTube or Instagram link | https://youtu.be/... |

Changes are live as soon as you type them. Clients see them the next time they open the app.

## Sending the app to a client

Text each client their personal link:

```
https://scoutco01.github.io/scoutco-app/?code=SC-7Q4K9X
```

That link signs them straight in. Then they add the app to their home screen:

- **iPhone:** open the link in **Safari**, tap **Share**, then **Add to Home Screen**.
- **Android:** open the link in **Chrome**, tap **Install** (or the menu ⋮ then **Add to Home screen**).

## Changing the look

- **Logo:** replace the files in `icons/`. Or send Claude your logo and Claude will update them.
- **Colours:** see the top of `styles.css`.
