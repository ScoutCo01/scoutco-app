// ScoutCo app settings.
// apiUrl: paste the Google Apps Script "Web app" URL here (it ends in /exec).
// Leave it empty to run in demo mode (code DEMO shows a sample program).
window.SCOUTCO_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbxyQlOWtm2LOBN_c6QrxTSFkl6B1MUmQRrEkxsR8pSCnVtMkwx373E4KniqN77bfO21/exec",
  businessName: "ScoutCo",
  // What clients call you. Used on buttons and notes in the app.
  coachName: "Kirst",
  websiteUrl: "https://www.scoutco.com.au/",
  // Back squat, deadlift and bench press show "Not confident on your form? Book a session with Kirst". This is where that button goes.
  techniqueBookingUrl: "https://www.scoutco.com.au/booking-page",
  // PB pop-up on back squat, deadlift and bench press.
  // false: only a weight heavier than their 1RM counts as a PB.
  // true: also counts an estimated 1RM from a set of up to 10 reps (e.g. 100 kg for 5 reps = about 117 kg).
  pbFromEstimate: false,
  // The ScoutCo HQ tab in the app. Change a label or link here, or add another line.
  websiteLinks: [
    { label: "Buy Merch", url: "https://www.scoutco.com.au/shop" },
    { label: "Mindset Stuff", url: "https://www.scoutco.com.au/blog" },
    { label: "Book in", url: "https://www.scoutco.com.au/booking-page" },
    { label: "What we're about", url: "https://www.scoutco.com.au/services" },
    { label: "Policies", url: "https://www.scoutco.com.au/policies" }
  ]
};
