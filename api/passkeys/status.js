import {
  onlyPost, requireUser, listPasskeys, getPasskey2faState,
  send, safeError
} from "./_lib.js";

export default async function handler(req, res) {
  if (!onlyPost(req, res)) return;

  try {
    const user = await requireUser(req);
    const passkeys = await listPasskeys(user.uid);
    const state = await getPasskey2faState(user.uid, passkeys);
    send(res, 200, state);
  } catch (error) {
    send(res, 400, { error: safeError(error) });
  }
}
