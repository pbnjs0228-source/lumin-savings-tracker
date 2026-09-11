import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  adminDb, webauthnConfig, onlyPost, requireUser, consumeChallenge,
  bytesToBase64Url, setPasskey2faEnabled, send, safeError
} from "../_lib.js";

export default async function handler(req, res) {
  if (!onlyPost(req, res)) return;

  try {
    const { rpID, origin } = webauthnConfig();
    const user = await requireUser(req);
    const { sessionId, credential, name } = req.body || {};
    const session = await consumeChallenge(sessionId, "register");

    if (session.uid !== user.uid) {
      throw new Error("Passkey session belongs to another account.");
    }

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: session.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      supportedAlgorithmIDs: [-7, -257],
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new Error("Passkey registration could not be verified.");
    }

    const saved = verification.registrationInfo.credential;

    await adminDb().collection("users").doc(user.uid)
      .collection("passkeys").doc(saved.id).set({
        publicKey: bytesToBase64Url(saved.publicKey),
        counter: saved.counter || 0,
        transports: saved.transports || credential?.response?.transports || [],
        name: String(name || "Passkey").slice(0, 80),
        createdAt: FieldValue.serverTimestamp(),
        lastUsedAt: null,
      });

    const state = await setPasskey2faEnabled(user.uid, true);
    send(res, 200, { verified: true, ...state });
  } catch (error) {
    send(res, 400, { error: safeError(error) });
  }
}
