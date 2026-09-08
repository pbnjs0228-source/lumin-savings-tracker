import {
  adminAuth, adminDb, webauthnConfig, environmentStatus,
  send, safeError
} from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return send(res, 405, { ok: false, error: "Open this URL normally in your browser using GET." });
  }

  const env = environmentStatus();

  try {
    const config = webauthnConfig();

    // Test that the service account can actually obtain an OAuth token and
    // talk to Firebase Authentication.
    await adminAuth().listUsers(1);

    // Test Firestore separately because passkey challenges/credentials live there.
    await adminDb().collection("_lumin_passkey_health").limit(1).get();

    return send(res, 200, {
      ok: true,
      message: "LUMIN passkey backend is healthy.",
      node: process.version,
      origin: config.origin,
      rpID: config.rpID,
      firebaseAdmin: "ok",
      firestore: "ok",
      cborWorkaround: env.CBOR_NATIVE_ACCELERATION_DISABLED ? "enabled" : "missing",
    });
  } catch (error) {
    return send(res, 500, {
      ok: false,
      error: safeError(error),
      node: process.version,
      environment: env,
    });
  }
}
