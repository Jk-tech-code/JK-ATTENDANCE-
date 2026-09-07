/**
 * Constant-time string equality check.
 *
 * Why: simple `===` exits as soon as the first byte differs, leaking timing
 * information that can be used to brute-force secrets one byte at a time.
 *
 * This pads both inputs to the longer length and always processes every byte,
 * so the comparison time depends only on input length, not on where they
 * first diverge. Returns false immediately when lengths differ to avoid
 * trivial length-based leaks (acceptable because the secret length is fixed
 * and known to the attacker anyway).
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
