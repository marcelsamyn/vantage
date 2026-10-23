import { connect } from "node:tls";
import { HttpError } from "../../../server/kit";

/**
 * A Hue bridge's certificate comes from Signify's own root, which no public authority vouches for, so the chain
 * cannot be checked. VANTAGE instead pins the SHA-256 fingerprint of the bridge's certificate when it pairs, and
 * checks it again before it sends the username.
 */

const CONNECT_TIMEOUT_MS = 4_000;
/** How long a check result stays valid. The username goes out every few seconds, so this bounds the extra connections. */
export const RECHECK_AFTER_MS = 10 * 60_000;

/** The SHA-256 fingerprint of the leaf certificate that the server at `address` (e.g. "https://192.168.1.2:443") presents. */
export function peerFingerprint(address: string, timeoutMs: number = CONNECT_TIMEOUT_MS): Promise<string> {
  const { hostname, port } = new URL(address);
  return new Promise((resolve, reject) => {
    const fail = (reason: string): void => reject(new HttpError(504, "hue_unreachable", `The Hue Bridge at ${hostname} did not show a certificate: ${reason}.`));
    // No data is sent: the handshake alone shows the certificate, and the socket closes right after.
    const socket = connect({ host: hostname, port: Number(port || 443), rejectUnauthorized: false }, () => {
      const fingerprint = socket.getPeerCertificate().fingerprint256;
      socket.end();
      if (fingerprint) resolve(fingerprint);
      else fail("none was sent");
    });
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      fail("it took too long");
    });
    socket.once("error", (err) => fail(err.message));
  });
}

export interface FingerprintGuard {
  /** True when the server at `address` still presents `expected`. Asks the server at most once per `RECHECK_AFTER_MS`. */
  matches(key: string, address: string, expected: string): Promise<boolean>;
}

export function createFingerprintGuard(fingerprintOf: (address: string) => Promise<string> = peerFingerprint, now: () => number = Date.now): FingerprintGuard {
  const verdicts = new Map<string, { at: number; matches: Promise<boolean> }>();
  return {
    matches(key, address, expected) {
      const id = `${key}|${address}|${expected}`;
      const hit = verdicts.get(id);
      if (hit && now() - hit.at < RECHECK_AFTER_MS) return hit.matches;
      const matches = fingerprintOf(address).then((seen) => seen.toLowerCase() === expected.toLowerCase());
      verdicts.set(id, { at: now(), matches });
      // A failed check says nothing about the certificate, so the next call asks again.
      matches.catch(() => verdicts.delete(id));
      return matches;
    },
  };
}
