# LUMIN passkey backend

The app-side passkey UI is already wired into `index.html`.

1. From this `functions` folder, run `npm install`.
2. Copy `.env.example` to `.env`.
3. Set:
   - `LUMIN_ORIGIN` to the exact public LUMIN origin, for example `https://example.github.io`
   - `LUMIN_RP_ID` to its WebAuthn RP ID/domain.
4. Deploy the function with Firebase CLI:
   `firebase deploy --only functions:passkeys`
5. Copy the deployed HTTPS function URL into `firebase-config.js` as `passkeyApiBase`.
6. Deploy the updated static LUMIN files over HTTPS.

Email/password remains available for account recovery.
