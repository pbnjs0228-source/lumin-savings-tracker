import { generateRegistrationOptions } from "@simplewebauthn/server";
import {
  adminAuth, webauthnConfig, onlyPost, requireUser, listPasskeys,
  createChallenge, send, safeError
} from "../_lib.js";

export default async function handler(req, res) {
  if (!onlyPost(req, res)) return;

  try {
    const { rpID, rpName } = webauthnConfig();
    const user = await requireUser(req);
    const account = await adminAuth().getUser(user.uid);
    const existing = await listPasskeys(user.uid);

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: account.email || user.uid,
      userDisplayName: account.displayName || account.email || "LUMIN user",
      attestationType: "none",
      supportedAlgorithmIDs: [-7, -257],
      excludeCredentials: existing.map(passkey => ({
        id: passkey.id,
        transports: Array.isArray(passkey.transports) ? passkey.transports : undefined,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    const sessionId = await createChallenge(user.uid, "register", options.challenge);
    send(res, 200, { sessionId, options });
  } catch (error) {
    send(res, 400, { error: safeError(error) });
  }
}
