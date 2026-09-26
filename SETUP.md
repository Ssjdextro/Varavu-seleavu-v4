# Connecting The Ledger to Firebase (login + cloud storage)

The app now supports signing in with Google. Once signed in, your entries
sync automatically to Firestore (Firebase's database) instead of only living
in the browser, so you can open the same ledger from any device. Setup takes
about 10 minutes, one time, and stays on Firebase's free "Spark" plan — no
credit card required.

This replaces the old Google Sheets / Apps Script backend. `Code.gs` is no
longer used by the app — you can leave your old Apps Script deployment as-is
or delete it, your call.

## 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and click **Add project**.
2. Name it anything (e.g. "The Ledger"). You can skip Google Analytics — it's not needed here.
3. Wait for the project to finish provisioning.

## 2. Turn on Google sign-in

1. In the left sidebar, go to **Build → Authentication**.
2. Click **Get started**.
3. Under the **Sign-in method** tab, click **Google**, toggle it **Enabled**,
   pick a support email, and click **Save**.

## 3. Create the database

1. In the left sidebar, go to **Build → Firestore Database**.
2. Click **Create database**.
3. Choose a location close to you and click **Next**.
4. Start in **production mode** (we'll set proper rules in the next step) and click **Create**.

## 4. Lock down the security rules

By default, production mode blocks everyone. Replace the rules so each
signed-in user can only read and write their **own** transactions:

1. In Firestore, go to the **Rules** tab.
2. Replace the contents with:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/transactions/{txId} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```

3. Click **Publish**.

## 5. Get your web app config

1. Click the **gear icon → Project settings** (top of the left sidebar).
2. Scroll to **Your apps** and click the **</>** (web) icon to register a new web app.
3. Give it a nickname (e.g. "Ledger web"), skip Firebase Hosting for now, and click **Register app**.
4. Firebase shows a `firebaseConfig` object — copy the values into `firebase-config.js`
   (included alongside this file) so it looks like:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abcdef"
   };
   ```

## 6. Allow your domain to sign in

Google sign-in only works on domains Firebase knows about:

1. Still in **Authentication → Settings → Authorized domains**, `localhost`
   is already listed, which covers local testing.
2. If you host the app somewhere (GitHub Pages, Netlify, Vercel, your own
   domain), add that domain here too, or the sign-in popup will fail.

> **Note:** opening `index.html` directly as a `file://` path won't work for
> sign-in. Serve it over `http://` locally instead — e.g. run
> `npx serve .` in the project folder, or use a tool like VS Code's
> "Live Server" extension, then open the `localhost` URL it gives you.

## 7. Try it

1. Open the app (via `localhost`, not `file://`).
2. Click the sync pill in the top-right — it should say **"Signed out"**.
3. Click **Continue with Google** and sign in.
4. Add an entry — it should appear in Firestore under
   **Firestore Database → Data → users → (your uid) → transactions**.
5. Open the app on another device/browser and sign in with the same Google
   account — your entries should show up there too.

## How it works

- Signed **out**: entries are saved only in this browser's `localStorage`,
  same as before.
- Signed **in**: entries live in Firestore under `users/{your uid}/transactions`,
  synced in real time — the app also keeps a local cache for instant loading
  and offline resilience.
- If you had entries saved locally before signing in for the first time,
  they're automatically copied up to your new cloud ledger the first time
  you sign in (one-time, only if the cloud ledger is empty).
- Firestore's free tier (1GB storage, 50K reads/20K writes per day) is far
  more than a personal ledger needs, and — unlike some alternatives — the
  project doesn't get paused for going quiet.

## Export to Excel & Analytics

Two new buttons sit next to "Add entry":

- **Export** downloads an `.xlsx` file (Transactions + Category Summary, and a
  Monthly Summary sheet for "All time") using the free SheetJS library
  loaded from a CDN — nothing to configure.
- **Analytics** opens a chart view (income vs. expenses by month, and a
  category breakdown for the month you're viewing) using Chart.js, also
  loaded from a CDN — nothing to configure.

Both run entirely in the browser; no data leaves your device except through
your own Firebase sync.

## Troubleshooting

- **"Firebase not configured" in the sync pill** — `firebase-config.js`
  still has the placeholder values; fill it in from step 5.
- **Sign-in popup closes immediately or errors** — check that your domain
  is in Authorized domains (step 6), and that you're not opening the app via
  `file://`.
- **"Sync failed" after signing in** — double-check the Firestore rules from
  step 4 were published, and that Firestore Database was actually created
  (step 3).
