import {
  onlyPost, requireUser, setPasskey2faEnabled,
  send, safeError
} from "./_lib.js";

export default async function handler(req, res) {
  if (!onlyPost(req, res)) return;

  try {
    const user = await requireUser(req);
    if (typeof req.body?.enabled !== "boolean") {
      throw new Error("Missing enabled=true/false.");
    }

    const state = await setPasskey2faEnabled(user.uid, req.body.enabled);
    send(res, 200, state);
  } catch (error) {
    send(res, 400, { error: safeError(error) });
  }
}
