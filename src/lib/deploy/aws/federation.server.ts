import { bootstrapSigner, signJws } from "@/lib/signing/index.server";
import type { AwsCredentials } from "./sigv4.server";

export type AwsFederation = {
  region: string;
  issuer: string;
  roleArn: string;
  executionRoleArn: string;
  kmsKeyArn?: string;
};

function escapeShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function xml(value: string, name: string): string {
  const match = value.match(new RegExp(`<${name}>([^<]+)</${name}>`));
  if (!match?.[1]) throw new Error(`AWS did not return ${name}`);
  return match[1];
}

function validate(config: AwsFederation): AwsFederation {
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(config.region)) throw new Error("AWS region is invalid");
  if (!/^https:\/\/[a-z0-9.-]+\/$/.test(config.issuer)) throw new Error("AWS issuer URL is invalid");
  if (!/^arn:aws(?:-us-gov)?:iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]+$/.test(config.roleArn)) {
    throw new Error("AWS federation role ARN is invalid");
  }
  if (!/^arn:aws(?:-us-gov)?:iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]+$/.test(config.executionRoleArn)) {
    throw new Error("AWS execution role ARN is invalid");
  }
  if (config.kmsKeyArn && !/^arn:aws(?:-us-gov)?:kms:[a-z0-9-]+:\d{12}:key\/[a-f0-9-]+$/.test(config.kmsKeyArn)) {
    throw new Error("AWS KMS key ARN is invalid");
  }
  return config;
}

export function federationParse(value: string): AwsFederation {
  try {
    return validate(JSON.parse(value) as AwsFederation);
  } catch (error) {
    throw new Error(error instanceof SyntaxError ? "Paste the complete AEGIS_AWS receipt from CloudShell" : (error as Error).message);
  }
}

export async function federationLoad(): Promise<AwsFederation | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("integrations").select("tiers").eq("provider", "aws").maybeSingle();
    const receipt = (data?.tiers as Record<string, { federation?: AwsFederation }> | null)?.["write"]?.federation;
    return receipt ? validate(receipt) : null;
  } catch {
    return null;
  }
}

export async function federationStore(config: AwsFederation, actor: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { record } = await import("@/lib/integrations/install.server");
  const { data } = await supabaseAdmin.from("integrations").select("tiers").eq("provider", "aws").maybeSingle();
  const tiers = ((data?.tiers as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  tiers["write"] = {
    ...(tiers["write"] as object),
    federation: validate(config),
    itemId: "federated:aws",
    via: "click",
    identity: config.roleArn,
    mintedAt: new Date().toISOString(),
  };
  await supabaseAdmin.from("integrations").upsert(
    {
      provider: "aws",
      tiers: tiers as never,
      status: "connected",
      installed_via: "click",
      account_label: config.roleArn.split(":")[4] ?? null,
      last_verified_at: new Date().toISOString(),
      revoked_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider" },
  );
  const { resetBrokerSigner } = await import("@/lib/signing/index.server");
  resetBrokerSigner();
  await record({
    provider: "aws",
    tier: "write",
    step: "federate",
    message: config.kmsKeyArn
      ? "AWS keyless federation connected; broker signing key moved into your KMS HSM"
      : "AWS keyless federation connected; no long-lived credential was issued or stored",
    actor,
    meta: { region: config.region, roleArn: config.roleArn, kms: !!config.kmsKeyArn },
  });
}

export async function credentials(): Promise<(AwsCredentials & { roleArn: string }) | null> {
  const config = await federationLoad();
  if (!config) return null;
  const now = Math.floor(Date.now() / 1000);
  // Always the bootstrap key: the broker key may live in the very account this
  // assertion is used to reach, which would be circular.
  const token = await signJws({
    iss: config.issuer.slice(0, -1),
    sub: "aegis:aws",
    aud: "sts.amazonaws.com",
    iat: now,
    exp: now + 300,
    jti: crypto.randomUUID(),
  }, bootstrapSigner());
  const body = new URLSearchParams({
    Action: "AssumeRoleWithWebIdentity",
    Version: "2011-06-15",
    RoleArn: config.roleArn,
    RoleSessionName: `aegis-${crypto.randomUUID().slice(0, 8)}`,
    DurationSeconds: "900",
    WebIdentityToken: token,
  });
  const response = await fetch("https://sts.amazonaws.com/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    const reason = text.match(/<Message>([^<]+)<\/Message>/)?.[1] ?? `HTTP ${response.status}`;
    throw new Error(`AWS federation failed: ${reason}`);
  }
  return {
    region: config.region,
    access: xml(text, "AccessKeyId"),
    secret: xml(text, "SecretAccessKey"),
    session: xml(text, "SessionToken"),
    roleArn: config.executionRoleArn,
  };
}

export async function bootstrapScript(region = "us-east-1"): Promise<string> {
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) throw new Error("AWS region is invalid");
  const publicJwk = await bootstrapSigner().publicJwk();
  const kid = await bootstrapSigner().keyId();
  const jwks = JSON.stringify({ keys: [{ ...publicJwk, kid, use: "sig", alg: "ES256", key_ops: undefined }] });
  const handler = `const JWKS=${JSON.stringify(jwks)};\nexport const handler=async(event)=>{const origin=\"https://\"+event.requestContext.domainName+\"/\";const path=event.rawPath;if(path===\"/.well-known/openid-configuration\")return{statusCode:200,headers:{\"content-type\":\"application/json\"},body:JSON.stringify({issuer:origin.slice(0,-1),jwks_uri:origin+\".well-known/jwks.json\",response_types_supported:[\"id_token\"],subject_types_supported:[\"public\"],id_token_signing_alg_values_supported:[\"ES256\"]})};if(path===\"/.well-known/jwks.json\")return{statusCode:200,headers:{\"content-type\":\"application/json\",\"cache-control\":\"public,max-age=300\"},body:JWKS};return{statusCode:404,body:\"not found\"};};`;

  return `#!/bin/sh
set -eu

# Aegis AWS keyless bootstrap. Run this in AWS CloudShell while signed into the
# account that will hold the private 1Password adapter. It creates no IAM user,
# access key or secret. The only public endpoint serves OIDC public-key metadata.
AWS_REGION=${escapeShell(region)}
ISSUER_FUNCTION="aegis-oidc-issuer"
CONTROL_ROLE="aegis-control"
EXECUTION_ROLE="aegis-execution"
KMS_ALIAS="aegis-broker-signing"

cat > index.mjs <<'AEGIS_ISSUER'
${handler}
AEGIS_ISSUER
zip -q issuer.zip index.mjs

cat > lambda-trust.json <<'AEGIS_LAMBDA_TRUST'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
AEGIS_LAMBDA_TRUST

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
EXECUTION_ARN="arn:aws:iam::$ACCOUNT_ID:role/$EXECUTION_ROLE"
CONTROL_ARN="arn:aws:iam::$ACCOUNT_ID:role/$CONTROL_ROLE"

aws iam get-role --role-name "$EXECUTION_ROLE" >/dev/null 2>&1 || aws iam create-role --role-name "$EXECUTION_ROLE" --assume-role-policy-document file://lambda-trust.json >/dev/null
aws iam attach-role-policy --role-name "$EXECUTION_ROLE" --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

if aws lambda get-function --function-name "$ISSUER_FUNCTION" --region "$AWS_REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$ISSUER_FUNCTION" --zip-file fileb://issuer.zip --region "$AWS_REGION" >/dev/null
else
  aws lambda create-function --function-name "$ISSUER_FUNCTION" --runtime nodejs22.x --handler index.handler --role "$EXECUTION_ARN" --zip-file fileb://issuer.zip --region "$AWS_REGION" >/dev/null
fi
aws lambda wait function-active-v2 --function-name "$ISSUER_FUNCTION" --region "$AWS_REGION"
aws lambda get-function-url-config --function-name "$ISSUER_FUNCTION" --region "$AWS_REGION" >/dev/null 2>&1 || aws lambda create-function-url-config --function-name "$ISSUER_FUNCTION" --auth-type NONE --region "$AWS_REGION" >/dev/null
aws lambda add-permission --function-name "$ISSUER_FUNCTION" --statement-id aegis-public-oidc --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE --region "$AWS_REGION" >/dev/null 2>&1 || true
aws lambda add-permission --function-name "$ISSUER_FUNCTION" --statement-id aegis-public-oidc-invoke --action lambda:InvokeFunction --principal '*' --invoked-via-function-url --region "$AWS_REGION" >/dev/null 2>&1 || true

ISSUER="$(aws lambda get-function-url-config --function-name "$ISSUER_FUNCTION" --region "$AWS_REGION" --query FunctionUrl --output text)"
ISSUER_HOST="$(printf '%s' "$ISSUER" | sed -e 's#^https://##' -e 's#/$##')"
PROVIDER_ARN="arn:aws:iam::$ACCOUNT_ID:oidc-provider/$ISSUER_HOST"
aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER_ARN" >/dev/null 2>&1 || aws iam create-open-id-connect-provider --url "https://$ISSUER_HOST" --client-id-list sts.amazonaws.com --thumbprint-list 8da7f965ec5efc37910f1c6e59fdc1cc6a6ede16 >/dev/null

cat > control-trust.json <<AEGIS_CONTROL_TRUST
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Federated":"$PROVIDER_ARN"},"Action":"sts:AssumeRoleWithWebIdentity","Condition":{"StringEquals":{"$ISSUER_HOST:aud":"sts.amazonaws.com","$ISSUER_HOST:sub":"aegis:aws"}}}]}
AEGIS_CONTROL_TRUST
aws iam get-role --role-name "$CONTROL_ROLE" >/dev/null 2>&1 || aws iam create-role --role-name "$CONTROL_ROLE" --assume-role-policy-document file://control-trust.json >/dev/null
aws iam update-assume-role-policy --role-name "$CONTROL_ROLE" --policy-document file://control-trust.json

# Signing key for everything Aegis issues. Generated inside the KMS HSM; the
# private half can never be exported, only used for ECDSA signatures.
KMS_ARN="$(aws kms list-aliases --region "$AWS_REGION" --query "Aliases[?AliasName=='alias/$KMS_ALIAS'].TargetKeyId" --output text)"
if [ -z "$KMS_ARN" ] || [ "$KMS_ARN" = "None" ]; then
  KEY_ID="$(aws kms create-key --key-spec ECC_NIST_P256 --key-usage SIGN_VERIFY --description 'Aegis broker signing key' --region "$AWS_REGION" --query KeyMetadata.KeyId --output text)"
  aws kms create-alias --alias-name "alias/$KMS_ALIAS" --target-key-id "$KEY_ID" --region "$AWS_REGION"
else
  KEY_ID="$KMS_ARN"
fi
KMS_KEY_ARN="arn:aws:kms:$AWS_REGION:$ACCOUNT_ID:key/$KEY_ID"

cat > control-policy.json <<AEGIS_CONTROL_POLICY
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["lambda:CreateFunction","lambda:GetFunction","lambda:UpdateFunctionCode","lambda:InvokeFunction"],"Resource":"arn:aws:lambda:$AWS_REGION:$ACCOUNT_ID:function:aegis-*"},{"Effect":"Allow","Action":"iam:PassRole","Resource":"$EXECUTION_ARN"},{"Effect":"Allow","Action":["kms:Sign","kms:GetPublicKey"],"Resource":"$KMS_KEY_ARN"}]}
AEGIS_CONTROL_POLICY
aws iam put-role-policy --role-name "$CONTROL_ROLE" --policy-name aegis-control --policy-document file://control-policy.json

printf 'AEGIS_AWS={"region":"%s","issuer":"%s","roleArn":"%s","executionRoleArn":"%s","kmsKeyArn":"%s"}\n' "$AWS_REGION" "$ISSUER" "$CONTROL_ARN" "$EXECUTION_ARN" "$KMS_KEY_ARN"
printf 'Paste only the JSON after AEGIS_AWS= into the Aegis AWS federation field. It contains no secret.\n'
`;
}