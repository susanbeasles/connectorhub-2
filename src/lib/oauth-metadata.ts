export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/public/oauth/authorize`,
    token_endpoint: `${origin}/api/public/oauth/token`,
    registration_endpoint: `${origin}/api/public/oauth/register`,
    revocation_endpoint: `${origin}/api/public/oauth/revoke`,
    scopes_supported: ["mcp:discover"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    dpop_signing_alg_values_supported: ["ES256", "ES384", "RS256", "PS256"],
    jwks_uri: `${origin}/.well-known/jwks.json`,
  };
}

export function protectedResourceMetadata(origin: string, resourcePath: string) {
  return {
    resource: `${origin}${resourcePath}`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    dpop_bound_access_tokens_required: true,
    dpop_signing_alg_values_supported: ["ES256", "ES384", "RS256", "PS256"],
    scopes_supported: ["mcp:discover"],
  };
}

export const jsonHeaders = {
  "content-type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, dpop, mcp-protocol-version",
  "Access-Control-Expose-Headers": "DPoP-Nonce, WWW-Authenticate",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
