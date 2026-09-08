LUMIN Vercel passkeys

Upload these files into the SAME GitHub repository Vercel deploys for:
https://lumin-savings.vercel.app

Vercel environment variables:
LUMIN_ORIGIN=https://lumin-savings.vercel.app
LUMIN_RP_ID=lumin-savings.vercel.app
FIREBASE_PROJECT_ID=<project_id from Firebase service-account JSON>
FIREBASE_CLIENT_EMAIL=<client_email from Firebase service-account JSON>
FIREBASE_PRIVATE_KEY=<entire private_key including BEGIN/END lines>

Never upload the Firebase service-account JSON to GitHub.

Expected endpoints:
POST /api/passkeys/register/options
POST /api/passkeys/register/verify
POST /api/passkeys/auth/options
POST /api/passkeys/auth/verify
