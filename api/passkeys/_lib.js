import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

let adminApp = null;

function cleanEnv(name) {
  let value = String(process.env[name] || "").trim();

  // People often paste JSON string values into Vercel including quotes.
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    try {
      value = JSON.parse(value);
    } catch {
      value = value.slice(1, -1);
    }
  }

  return String(value).trim();
}

function privateKeyValue() {
  let key = cleanEnv("FIREBASE_PRIVATE_KEY");
  key = key.replace(/\\n/g, "\n");
  return key;
}

export function environmentStatus() {
  const privateKey = privateKeyValue();

  return {
    FIREBASE_PROJECT_ID: !!cleanEnv("FIREBASE_PROJECT_ID"),
    FIREBASE_CLIENT_EMAIL: !!cleanEnv("FIREBASE_CLIENT_EMAIL"),
    FIREBASE_PRIVATE_KEY: !!privateKey,
    FIREBASE_PRIVATE_KEY_LOOKS_VALID:
      privateKey.includes("-----BEGIN PRIVATE KEY-----") &&
      privateKey.includes("-----END PRIVATE KEY-----"),
    LUMIN_ORIGIN: !!cleanEnv("LUMIN_ORIGIN"),
    LUMIN_RP_ID: !!cleanEnv("LUMIN_RP_ID"),
    CBOR_NATIVE_ACCELERATION_DISABLED:
      String(process.env.CBOR_NATIVE_ACCELERATION_DISABLED || "") === "true",
  };
}

function assertEnvironment() {
  const status = environmentStatus();

  const missing = [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "LUMIN_ORIGIN",
    "LUMIN_RP_ID",
  ].filter(key => !status[key]);

  if (missing.length) {
    throw new Error(`Missing Vercel environment variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);
  }

  if (!status.FIREBASE_PRIVATE_KEY_LOOKS_VALID) {
    throw new Error(
      "FIREBASE_PRIVATE_KEY does not look like a valid PEM private key. Paste the full private_key value including BEGIN PRIVATE KEY and END PRIVATE KEY."
    );
  }
}

export function getAdminApp() {
  assertEnvironment();

  if (adminApp) return adminApp;

  if (getApps().length) {
    adminApp = getApps()[0];
    return adminApp;
  }

  // This is intentionally lazy. If a credential is malformed, the error now
  // happens inside the request handler and can be returned as JSON instead of
  // Vercel's generic "A server error has occurred".
  adminApp = initializeApp({
    credential: cert({
      projectId: cleanEnv("FIREBASE_PROJECT_ID"),
      clientEmail: cleanEnv("FIREBASE_CLIENT_EMAIL"),
      privateKey: privateKeyValue(),
    }),
  });

  return adminApp;
}

export function adminAuth() {
  return getAuth(getAdminApp());
}

export function adminDb() {
  return getFirestore(getAdminApp());
}

export function webauthnConfig() {
  assertEnvironment();

  const origin = cleanEnv("LUMIN_ORIGIN").replace(/\/+$/, "");
  const rpID = cleanEnv("LUMIN_RP_ID");

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("LUMIN_ORIGIN must be a full HTTPS URL, for example https://lumin-savings.vercel.app");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("LUMIN_ORIGIN must use https://");
  }

  if (parsed.hostname !== rpID) {
    throw new Error(
      `LUMIN_ORIGIN hostname (${parsed.hostname}) does not match LUMIN_RP_ID (${rpID}).`
    );
  }

  return { origin, rpID, rpName: "LUMIN" };
}

const challengeCollection = () => adminDb().collection("_lumin_passkey_challenges");

export function send(res, status, body) {
  res.status(status).json(body);
}

export function onlyPost(req, res) {
  if (req.method !== "POST") {
    send(res, 405, { error: "POST required." });
    return false;
  }
  return true;
}

export async function requireUser(req) {
  const value = String(req.headers.authorization || "");
  const token = value.startsWith("Bearer ") ? value.slice(7) : "";
  if (!token) throw new Error("Please sign in first.");
  return adminAuth().verifyIdToken(token);
}

export async function listPasskeys(uid) {
  const snap = await adminDb().collection("users").doc(uid).collection("passkeys").get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

function passkey2faRef(uid) {
  return adminDb().collection("users").doc(uid).collection("security").doc("passkey2fa");
}

export async function getPasskey2faState(uid, existingPasskeys = null) {
  const passkeys = existingPasskeys || await listPasskeys(uid);
  const snap = await passkey2faRef(uid).get();

  // Migration behavior: accounts that already had a passkey before the toggle
  // feature existed stay protected by default.
  let enabled = passkeys.length > 0;

  if (snap.exists && typeof snap.data()?.enabled === "boolean") {
    enabled = snap.data().enabled && passkeys.length > 0;
  }

  return {
    enabled,
    passkeyCount: passkeys.length,
  };
}

export async function setPasskey2faEnabled(uid, enabled) {
  const passkeys = await listPasskeys(uid);

  if (enabled && !passkeys.length) {
    throw new Error("Add a passkey before turning on passkey 2FA.");
  }

  await passkey2faRef(uid).set({
    enabled: !!enabled,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    enabled: !!enabled && passkeys.length > 0,
    passkeyCount: passkeys.length,
  };
}

export async function createChallenge(uid, type, challenge) {
  const ref = challengeCollection().doc();
  await ref.set({
    uid,
    type,
    challenge,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
  });
  return ref.id;
}

export async function consumeChallenge(sessionId, expectedType) {
  if (!sessionId) throw new Error("Missing passkey session.");

  const ref = challengeCollection().doc(String(sessionId));
  const snap = await ref.get();

  if (!snap.exists) throw new Error("Passkey session expired.");

  const data = snap.data();
  await ref.delete().catch(() => {});

  if (data.type !== expectedType) throw new Error("Wrong passkey session.");

  if (!data.expiresAt || data.expiresAt.toMillis() < Date.now()) {
    throw new Error("Passkey session expired.");
  }

  return data;
}

export function bytesToBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function base64UrlToBytes(value) {
  return new Uint8Array(Buffer.from(String(value), "base64url"));
}

function errorText(value, fallback = "Passkey request failed.") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string") return value;

  if (value instanceof Error) {
    return errorText(
      value.message ||
      value.errorInfo?.message ||
      value.cause ||
      value,
      fallback
    );
  }

  if (typeof value === "object") {
    const candidates = [
      value.message,
      value.error_description,
      value.error,
      value.details,
      value.reason,
      value.errorInfo?.message,
      value.response?.data?.message,
    ];

    for (const candidate of candidates) {
      if (candidate !== undefined && candidate !== null && candidate !== value) {
        const found = errorText(candidate, "");
        if (found) return found;
      }
    }

    try {
      const json = JSON.stringify(value);
      if (json && json !== "{}") return json;
    } catch {}
  }

  const stringified = String(value);
  return stringified === "[object Object]" ? fallback : stringified;
}

export function safeError(error) {
  console.error("[LUMIN passkeys]", error);
  return errorText(error);
}
