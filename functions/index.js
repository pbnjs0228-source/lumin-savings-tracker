import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";

initializeApp();

const auth = getAuth();
const db = getFirestore();

const RP_ID = process.env.LUMIN_RP_ID;
const ORIGIN = process.env.LUMIN_ORIGIN;
const RP_NAME = "LUMIN";

if (!RP_ID || !ORIGIN) {
  console.warn("Set LUMIN_RP_ID and LUMIN_ORIGIN before using passkeys.");
}

const json = (res, status, body) => res.status(status).json(body);
const challenges = db.collection("_lumin_passkey_challenges");

function bearer(req) {
  const value = String(req.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

async function requireFirebaseUser(req) {
  const token = bearer(req);
  if (!token) throw new Error("Missing Firebase ID token.");
  return auth.verifyIdToken(token);
}

async function passkeysFor(uid) {
  const snap = await db.collection("users").doc(uid).collection("passkeys").get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function storeChallenge({ uid, type, challenge }) {
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

async function takeChallenge(sessionId, expectedType) {
  if (!sessionId) throw new Error("Missing passkey session.");
  const ref = challenges.doc(String(sessionId));
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Passkey session expired.");
  const data = snap.data();
  await ref.delete().catch(() => {});
  if (data.type !== expectedType) throw new Error("Wrong passkey session type.");
  if (!data.expiresAt || data.expiresAt.toMillis() < Date.now()) throw new Error("Passkey session expired.");
  return data;
}

function bytesToBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlToBytes(value) {
  return Buffer.from(String(value), "base64url");
}

async function handleRegisterOptions(req, res) {
  const user = await requireFirebaseUser(req);
  const account = await auth.getUser(user.uid);
  const existing = await passkeysFor(user.uid);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: account.email || user.uid,
    userDisplayName: account.displayName || account.email || "LUMIN user",
    attestationType: "none",
    excludeCredentials: existing.map(p => ({
      id: p.id,
      transports: Array.isArray(p.transports) ? p.transports : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  const sessionId = await storeChallenge({
    uid: user.uid,
    type: "register",
    challenge: options.challenge,
  });

  return json(res, 200, { sessionId, options });
}

async function handleRegisterVerify(req, res) {
  const user = await requireFirebaseUser(req);
  const body = req.body || {};
  const session = await takeChallenge(body.sessionId, "register");
  if (session.uid !== user.uid) throw new Error("Passkey session does not belong to this account.");

  const verification = await verifyRegistrationResponse({
    response: body.credential,
    expectedChallenge: session.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Passkey registration could not be verified.");
  }

  const credential = verification.registrationInfo.credential;
  await db.collection("users").doc(user.uid).collection("passkeys").doc(credential.id).set({
    publicKey: bytesToBase64Url(credential.publicKey),
    counter: credential.counter || 0,
    transports: credential.transports || body.credential?.response?.transports || [],
    name: String(body.name || "Passkey").slice(0, 80),
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: null,
  });

  return json(res, 200, { verified: true });
}

async function handleAuthOptions(req, res) {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) throw new Error("Enter your account email.");

  const account = await auth.getUserByEmail(email);
  const existing = await passkeysFor(account.uid);
  if (!existing.length) throw new Error("No passkeys are registered for this account.");

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
    allowCredentials: existing.map(p => ({
      id: p.id,
      transports: Array.isArray(p.transports) ? p.transports : undefined,
    })),
  });

  const sessionId = await storeChallenge({
    uid: account.uid,
    type: "auth",
    challenge: options.challenge,
  });

  return json(res, 200, { sessionId, options });
}

async function handleAuthVerify(req, res) {
  const body = req.body || {};
  const session = await takeChallenge(body.sessionId, "auth");
  const credentialId = String(body.credential?.id || "");
  if (!credentialId) throw new Error("Missing credential.");

  const ref = db.collection("users").doc(session.uid).collection("passkeys").doc(credentialId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Passkey is not registered.");

  const saved = snap.data();
  const verification = await verifyAuthenticationResponse({
    response: body.credential,
    expectedChallenge: session.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: credentialId,
      publicKey: base64UrlToBytes(saved.publicKey),
      counter: Number(saved.counter || 0),
      transports: Array.isArray(saved.transports) ? saved.transports : undefined,
    },
  });

  if (!verification.verified) throw new Error("Passkey could not be verified.");

  await ref.update({
    counter: verification.authenticationInfo.newCounter,
    lastUsedAt: FieldValue.serverTimestamp(),
  });

  const firebaseToken = await auth.createCustomToken(session.uid);
  return json(res, 200, { verified: true, firebaseToken });
}

export const passkeys = onRequest(
  {
    region: "australia-southeast1",
    cors: true,
    timeoutSeconds: 30,
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") return json(res, 405, { error: "POST required." });

      const path = String(req.path || req.url || "").replace(/\?.*$/, "").replace(/\/+$/, "");
      if (path.endsWith("/register/options")) return await handleRegisterOptions(req, res);
      if (path.endsWith("/register/verify")) return await handleRegisterVerify(req, res);
      if (path.endsWith("/auth/options")) return await handleAuthOptions(req, res);
      if (path.endsWith("/auth/verify")) return await handleAuthVerify(req, res);

      return json(res, 404, { error: "Unknown passkey route." });
    } catch (error) {
      console.error(error);
      return json(res, 400, { error: error?.message || "Passkey request failed." });
    }
  }
);
