LUMIN - deploy folder
=====================

index.html          The app (single file). Open it from a web host (GitHub Pages, Firebase Hosting, etc.).
manifest.json       Web app manifest (name, colours, Android adaptive + themed icons).
icons/              App icons referenced by manifest.json. Keep this folder next to index.html.
firestore.rules     Firestore security rules (free plan: 5 active goals, Ultra: unlimited).

Not included (yours): firebase-config.js
  index.html loads ./firebase-config.js for your Firebase project settings.
  Keep your existing copy next to index.html.

After uploading
  - Replace your old manifest.json and icons.
  - Publish firestore.rules in the Firebase console (Firestore > Rules) or with: firebase deploy --only firestore:rules
  - On Android, remove the old home-screen app and add it again to get the new icon.
