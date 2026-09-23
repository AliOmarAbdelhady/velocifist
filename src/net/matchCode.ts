// Versus match codes (ADR-018): a 5-character code from an unambiguous
// alphabet (no 0/O/1/I — read them over a phone call without spelling).
// The host CLAIMS the peer id derived from the code; the guest connects to
// that id. Pure module — fully unit-tested.

/** No 0/O/1/I/L: every character survives bad lighting and hasty reading. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LEN = 5;
export const PEER_PREFIX = 'roben-race-';

/** Deterministic code from a uniform rng (0..1) — tests pin sequences. */
export function genCode(rand: () => number): string {
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) {
    code += CODE_ALPHABET[Math.min(CODE_ALPHABET.length - 1, Math.floor(rand() * CODE_ALPHABET.length))];
  }
  return code;
}

/** Peer id the host claims for a code (PeerJS ids allow [A-Za-z0-9-_]). */
export function peerIdFor(code: string): string {
  return PEER_PREFIX + code;
}

/**
 * Accepts sloppy user input (" ab3-kq ", "AB3KQ") → canonical "AB3KQ", or
 * null when the input can't be a code (wrong length or unknown characters).
 */
export function normalizeCode(input: string): string | null {
  const cleaned = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (cleaned.length !== CODE_LEN) return null;
  for (const ch of cleaned) {
    if (!CODE_ALPHABET.includes(ch)) return null;
  }
  return cleaned;
}
