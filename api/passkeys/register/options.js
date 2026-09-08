import { generateRegistrationOptions } from "@simplewebauthn/server";
import {
  auth, rpID, rpName, onlyPost, requireUser, listPasskeys,
  createChallenge, send, safeError
} from "../_lib.js";

export default async function handler(req, res) {
  if (!onlyPost(req, res)) return;

  try {
    const user = await requireUser(req);
    const account = await auth.getUser(user.uid);
    const existing = await listPasskeys(user.uid);

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: account.email || user.uid,
      userDisplayName: account.displayName || account.email || "LUMIN user",
      attestationType: "none",
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
