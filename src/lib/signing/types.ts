/** One signing boundary for the whole broker. Callers never know where the key lives. */
export type Signer = {
  /** Stable key identifier published in the JWKS and in JWT headers. */
  keyId(): Promise<string>;
  /** Public half, as a JWK, for anyone verifying our signatures. */
  publicJwk(): Promise<JsonWebKey>;
  /** ES256 signature over the signing input, returned as base64url raw r||s. */
  sign(input: string): Promise<string>;
  /** Where the private key actually lives — surfaced in the console. */
  custody(): "kms" | "vault" | "local";
};
