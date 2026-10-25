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

**Message** shows as a "From Kirst" note at the top of that client's app. (The name clients see is set by `coachName` in `config.js`.) Clients can react to it (👍 ❤️ 💪 🔥 🙌) to show they've seen it. Their pick goes in the **Reaction**, **Reacted on** and **Reacted to** columns on the Clients tab, and shows on the Clients tab of the coach app. Change someone's Message and their old reaction clears.

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

## Demo videos

Every exercise except the main lifts (back squat, deadlift, bench press) gets a **▶ Demo videos on YouTube** link in the app, and so does every home swap. It opens a YouTube search for that exercise. To show one particular video instead, paste its link in the **Video** column (on the Programs tab, or the Home swaps tab for a home swap) and the button changes to **▶ Watch demo**.

The main lifts get no automatic video, because you teach those in person. Instead they show "Not confident on your form? Book a session with Kirst to learn the technique." The link goes to `techniqueBookingUrl` in `config.js` (your booking page).

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

- **Check-in tab: a weekly pulse check.** Sleep, Nutrition, Energy, Soreness and Head noise (anxiety/stress), each scored 1 = bad, 2 = OK, 3 = good, plus optional bodyweight and a "Note for Kirst". It opens on **Friday** and closes at the end of **Sunday**, and they can send it once a week (weeks run Monday to Sunday). Monday to Thursday the tab says "Your check-in will appear here on Friday".
- **Check-in reminders.** When they open the app on Friday (or Saturday) a pop-up says their check-in is open, and if it's still not done on Sunday they get a "Don't forget your check-in" pop-up. Each shows once. A yellow dot sits on the tab until it's done. With **ScoutCo > Turn on check-in reminders**, clients who turned notifications on also get a phone notification on Friday about 7am and, only if they haven't done it, Sunday about 5pm (Brisbane time).
- **Ask a client to book a call.** On the **Check-ins** tab, tick **Send call link** on their row. They get a "Coach would like a call" notification that opens your booking link (once **Turn on check-in reminders** is on), and a **Book a check-in call** button in their app for 3 weeks. A note on the tick box shows when it was sent. Untick and tick again to send it again.
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

## Client profiles and PBs

Every client (not your Coach row) has a **Profile** tab in the app. Their name and type come from the Clients tab. They add:

- a profile photo (shrunk to a small square so it fits in the sheet)
- their 1RM for back squat, deadlift and bench press
- date of birth, health and fitness goals, hobbies and interests, and favourite food

Until they've filled it in, the Program tab shows a "Tell Kirst about you" card and the Profile tab has a dot.

Everything lands on the **Profiles** tab of your sheet, one row per client, with their photo in the Photo column and their age worked out from their date of birth. You can type over anything there (for example, a 1RM you tested together) and the app picks it up next time it opens.

**PB pop-up:** when a client types a weight in "Weight used" on back squat, deadlift or bench press that's heavier than their 1RM, the app celebrates with a pop-up, updates their 1RM, and adds a row to the **PBs** tab. Variations like front squats, RDLs or incline bench don't count. A jump of more than 30% asks "Is that right?" first, to catch typos. If a client hasn't entered a 1RM for a lift yet, there's nothing to beat, so no pop-up.

By default only a weight heavier than their 1RM counts. To also count an estimated 1RM from a set of up to 10 reps (100 kg for 5 reps is about 117 kg), set `pbFromEstimate: true` in `config.js`.

Your **Monday email** now starts with PBs from the last week and birthdays in the next 7 days.

Set up: **ScoutCo → Set up client profiles** adds the Profiles and PBs tabs and a row for every client.

### Your coach profile, and seeing clients' profiles

Your own coach app (the Clients row with Type "Coach") has two extra tabs:

- **Profile**: your photo, About me, qualifications and experience, hobbies and interests, and favourite food. Clients see this as a "Your coach" card at the top of their **ScoutCo HQ** tab. Your photo also sits at the top right of their app and on your "From Kirst" notes and check-in replies; tapping it opens your profile. It's saved on the **Coach profile** tab of the sheet, where you can also type it directly.
- **Clients**: every active client's profile: photo, type, age and birthday (with a 🎂 when it's within a week), their 1RMs, goals, hobbies, favourite food and latest PBs. Tap a client to open their card.

## Lift Club Community

Every client and coach has a **Lift Club Community** tab in their app. They can post, react (💪 🔥 👏 ❤️) and reply. Posts show each person's first name and last initial (coaches show their first name with a Coach badge) and their profile photo. A dot on the tab means there's a new post.

- Turn it on: ScoutCo menu → **Set up Lift Club Community** (the tab is also made by itself the first time someone posts).
- Every post and reply lands on the **Lift Club Community** tab of the sheet, and you get an email when a client posts.
- Anyone can add a photo to a post (📷 **Add photo**). The app shrinks it first. Photos are saved in a **ScoutCo Lift Club photos** folder in your Google Drive, with a link in the **Photo** column. Hiding a post hides its photo too. (Photos need the same Drive permission as videos: ScoutCo menu → **Set up videos**.)
- To take a post down, tick its **Hide** box (untick to bring it back), tap **Hide** on the post in your coach app, or delete the row. Hiding a post hides its replies too.
- Clients can delete their own posts. Those rows stay on the sheet with "(deleted it)" after their name.
- The app shows the newest 60 posts.

### Lift Club notifications (OneSignal, free)

People can get a phone notification when someone posts in the Lift Club (everyone except the person who posted) or replies to a post they're in. Each person turns them on or off with the 🔔 Notifications card on their Lift Club Community or Profile tab. The yellow dot on the tab shows either way. On iPhone, notifications only work once the app is added to the home screen and opened from there.

Setup: make a free OneSignal account and a Web app for `https://scoutco01.github.io` (Custom Code setup). Then ScoutCo menu → **Set up push notifications**, paste the **OneSignal App ID** and **OneSignal API key** on the Settings tab, and use **Send me a test notification** to check. The API key stays in your sheet. The app only gets the App ID.

## Videos

**Send a client a video from their session.** In your coach app, open the **Videos** tab, pick the client, add a note if you like, tap **Choose video and send** and pick a video from your phone. It shows on that client's **My videos** tab (nobody else's), and they get a notification if they've turned notifications on.

**Form checks from clients.** On back squat, deadlift and bench press, clients have a **🎥 Send Kirst a form video** button (and they can also send one from their My videos tab). You get an email and a notification, and the video shows at the top of your Videos tab under **Form checks to look at** with a number on the tab. Tap **Reply** to send them your feedback; it shows under the video in their app and they get a notification.

- Turn it on: ScoutCo menu → **Set up videos**. Google asks for permission to use your Drive the first time; say yes.
- Every video is saved in a **ScoutCo videos** folder in your Google Drive and listed on the **Videos** tab of the sheet. You can also type a reply in the **Reply from Kirst** column.
- Tick **Hide** on the Videos tab, or tap **Remove** in the app, to take a video out of the app (Remove also moves the file to your Drive bin).
- The video files are set to "anyone with the link can view" so the app can play them without a Google sign-in. The link is long and random and only goes to that client's app and yours.
- Keep the app open with the screen on while a video sends. The phone sends it straight to your Google Drive, so it goes as fast as your signal allows (if a phone won't allow that, it goes through the sheet instead, which is slower). Videos up to 500 MB work; a minute of 1080p phone video is about 100 MB, and 4K is about 4 times that. If the connection drops, the app picks up where it left off.
- A video can take a few minutes after sending before Google lets it play.
- Your free Google Drive has 15 GB, which holds a few hundred short clips. Delete old ones from the ScoutCo videos folder when it gets full.

## Online coaching enquiry form

`eoi.html` is a public page (https://scoutco01.github.io/scoutco-app/eoi.html) for people interested in online coaching. It explains how online coaching works and what's included, then asks about the person: contact details, goals, training background, days per week, equipment, 1RMs (squat, bench, deadlift), APSS health screening, injuries and lifestyle.

Answers go to the same Apps Script web app. Each enquiry is a row on the **Online enquiries** tab (made on the first one), with a Status dropdown and a notes column for Kirst. Kirst gets an email with every answer (a red heads-up if any APSS answer is yes; hit Reply to write back to them), and the person gets a short thank-you email.

Link to it from the website with a Squarespace Button block. Add `?preview` to the address to try the form without saving anything.

## Face-to-face coaching enquiry form

`face-to-face.html` (https://scoutco01.github.io/scoutco-app/face-to-face.html) is the same idea for the weekly and fortnightly face-to-face packages. It explains how face-to-face coaching works and the two packages, then asks the same questions as the online form plus which package, which days and times suit for studio sessions, and how they'll train between sessions.

Enquiries go on the **Face-to-face enquiries** tab (made on the first one), with the same Status dropdown, notes column and emails.

Both forms also save a PDF of every enquiry in your Drive, in **ScoutCo enquiries > Online** or **ScoutCo enquiries > Face to face** (made on the first one). The PDF is linked in a PDF column on the enquiry's row and attached to your email. Add `?package=weekly` or `?package=fortnightly` to the link to tick that package for them, and `?preview` to try it without saving.
