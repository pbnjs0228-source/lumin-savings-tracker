import { generateAuthenticationOptions } from "@simplewebauthn/server";
import {
  adminAuth, webauthnConfig, onlyPost, listPasskeys, createChallenge,
  send, safeError
} from "../_lib.js";

export default async function handler(req, res) {
  if (!onlyPost(req, res)) return;

  try {
    const { rpID } = webauthnConfig();
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!email) throw new Error("Enter your account email.");

    const account = await adminAuth().getUserByEmail(email);
    const existing = await listPasskeys(account.uid);

    if (!existing.length) {
      throw new Error("No passkey is registered for this account yet. Sign in with your password, then add one in Settings → Security.");
    }

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "preferred",
      allowCredentials: existing.map(passkey => ({
        id: passkey.id,
        transports: Array.isArray(passkey.transports) ? passkey.transports : undefined,
      })),
    });

    const sessionId = await createChallenge(account.uid, "auth", options.challenge);
    send(res, 200, { sessionId, options });
  } catch (error) {
    send(res, 400, { error: safeError(error) });
  }
}
