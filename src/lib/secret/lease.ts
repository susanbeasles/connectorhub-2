/**
 * Nothing in this application holds a secret as a string it owns. A resolved
 * secret is a lease: bytes with a use count, a deadline, and a guaranteed
 * overwrite. The plaintext is decoded at the point of use and the decoded copy
 * is dropped with the call frame, so no value outlives the request that needed
 * it — not in a module cache, not on a returned object, not in a closure.
 *
 * A lease that is never disposed still expires: the deadline is checked on
 * every use, so a forgotten `dispose` degrades to a short-lived value rather
 * than a permanent one.
 */

export type LeaseTerms = {
  /** Hard cap on how many times the value may be read. */
  uses?: number;
  /** Wall-clock ceiling, whichever runs out first. */
  ttlMs?: number;
};

const DEFAULT_TERMS: Required<LeaseTerms> = { uses: 1, ttlMs: 30_000 };

export class Lease {
  private bytes: Uint8Array | null;
  private remaining: number;
  private readonly deadline: number;

  private constructor(bytes: Uint8Array, terms: Required<LeaseTerms>) {
    this.bytes = bytes;
    this.remaining = terms.uses;
    this.deadline = Date.now() + terms.ttlMs;
  }

  static of(bytes: Uint8Array, terms: LeaseTerms = {}): Lease {
    return new Lease(bytes, { ...DEFAULT_TERMS, ...terms });
  }

  static ofText(value: string, terms: LeaseTerms = {}): Lease {
    return Lease.of(new TextEncoder().encode(value), terms);
  }

  get spent(): boolean {
    return this.bytes === null || this.remaining <= 0 || Date.now() > this.deadline;
  }

  /** Borrow the plaintext for exactly one scope. */
  async use<T>(consume: (value: string) => T | Promise<T>): Promise<T> {
    return this.useBytes(async (bytes) => consume(new TextDecoder().decode(bytes)));
  }

  /** Borrow the raw bytes, for key material that must never become a string. */
  async useBytes<T>(consume: (bytes: Uint8Array) => T | Promise<T>): Promise<T> {
    if (this.bytes === null) throw new Error("Secret lease has been disposed");
    if (Date.now() > this.deadline) {
      this.dispose();
      throw new Error("Secret lease expired");
    }
    if (this.remaining <= 0) {
      this.dispose();
      throw new Error("Secret lease is exhausted");
    }
    this.remaining -= 1;
    try {
      return await consume(this.bytes);
    } finally {
      if (this.remaining <= 0) this.dispose();
    }
  }

  /** Overwrite the backing bytes and drop the reference. Idempotent. */
  dispose(): void {
    if (this.bytes) {
      this.bytes.fill(0);
      this.bytes = null;
    }
    this.remaining = 0;
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

/** Run one scope with a lease and dispose it however the scope ends. */
export async function withLease<T>(
  lease: Lease | Promise<Lease>,
  consume: (value: string) => T | Promise<T>,
): Promise<T> {
  const held = await lease;
  try {
    return await held.use(consume);
  } finally {
    held.dispose();
  }
}
