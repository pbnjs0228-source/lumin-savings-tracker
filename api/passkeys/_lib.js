import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

export const auth = getAuth();
export const db = getFirestore();
export const rpID = process.env.LUMIN_RP_ID;
export const origin = process.env.LUMIN_ORIGIN;
export const rpName = "LUMIN";

const challenges = db.collection("_lumin_passkey_challenges");

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
  return auth.verifyIdToken(token);
}

export async function listPasskeys(uid) {
  const snap = await db.collection("users").doc(uid).collection("passkeys").get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function createChallenge(uid, type, challenge) {
  const ref = challenges.doc();
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
  const ref = challenges.doc(String(sessionId));
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

export function safeError(error) {
  console.error(error);
  return error?.message || "Passkey request failed.";
}
