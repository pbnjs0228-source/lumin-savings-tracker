import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  adminAuth, adminDb, webauthnConfig, onlyPost, consumeChallenge,
  base64UrlToBytes, send, safeError
} from "../_lib.js";

export default async function handler(req, res) {
  if (!onlyPost(req, res)) return;

  try {
    const { rpID, origin } = webauthnConfig();
    const { sessionId, credential } = req.body || {};
    const session = await consumeChallenge(sessionId, "auth");

    const credentialId = String(credential?.id || "");
    if (!credentialId) throw new Error("Missing passkey credential.");

    const ref = adminDb().collection("users").doc(session.uid)
      .collection("passkeys").doc(credentialId);

    const snap = await ref.get();
    if (!snap.exists) throw new Error("Passkey is not registered.");

    const saved = snap.data();

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: session.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
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

    const firebaseToken = await adminAuth().createCustomToken(session.uid);
    send(res, 200, { verified: true, firebaseToken });
  } catch (error) {
    send(res, 400, { error: safeError(error) });
  }
}
