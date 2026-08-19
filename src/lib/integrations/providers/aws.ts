import type { Spec } from "../types";

const ACCOUNT = {
  name: "AWS_ACCOUNT_ID",
  label: "AWS account id",
  example: "123456789012",
};

const REGION = { name: "AWS_REGION", label: "Region", example: "us-east-1", value: "us-east-1" };

const ISSUER = {
  name: "AEGIS_ISSUER",
  label: "This broker's issuer URL",
  example: "https://love.vespoli.me",
};

export const aws: Spec = {
  id: "aws",
  label: "AWS",
  kind: "service",
  summary:
    "Isolated Lambda compute per broker, signed with short-lived credentials obtained through OIDC federation — no static access keys are ever created.",
  docsUrl: "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_oidc.html",
  tiers: {
    read: {
      summary: "Describe functions and roles. No mutation of any kind.",
      lifetime: "short-lived",
      vault: "aegis-read",
      bootstrapScopes: [],
      capabilities: [
        "See Lambda deployments and their configuration",
        "Detect drift between deployed and expected code",
        "Read CloudWatch log groups for broker functions",
      ],
      scopes: [
        {
          name: "lambda:GetFunction, lambda:ListFunctions",
          grants: "Read function configuration and code digests.",
          why: "Fleet view and drift detection.",
        },
        {
          name: "logs:FilterLogEvents",
          grants: "Read log events for broker functions only.",
          why: "Surfaces runtime errors in the console without giving log access anywhere else.",
        },
      ],
      blueprint: {
        variables: [ACCOUNT, REGION, ISSUER],
        steps: [
          {
            title: "Register this broker as an OIDC identity provider",
            why: "Federation means AWS trusts a signed token from this app instead of us holding a permanent key. Nothing to leak, nothing to rotate.",
            command: `aws iam create-open-id-connect-provider \\
  --url "$AEGIS_ISSUER" \\
  --client-id-list "sts.amazonaws.com" \\
  --region "$AWS_REGION"`,
          },
          {
            title: "Write the trust policy for the read role",
            why: "Only a token issued by this broker, for the read role, can assume it. The condition pins the subject so a different broker cannot.",
            command: `cat > aegis-read-trust.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::AWS_ACCOUNT_ID:oidc-provider/ISSUER_HOST" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": { "StringEquals": { "ISSUER_HOST:sub": "aegis:read" } }
    }
  ]
}
JSON`,
          },
          {
            title: "Create the read role",
            why: "A named role keeps read separate from write; assuming one never grants the other.",
            command: `aws iam create-role \\
  --role-name "aegis-read" \\
  --assume-role-policy-document file://aegis-read-trust.json`,
          },
          {
            title: "Write the read permission policy",
            why: "These are the only two API families the app calls when it is inspecting.",
            command: `cat > aegis-read-policy.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [ "lambda:GetFunction", "lambda:ListFunctions", "logs:FilterLogEvents" ],
      "Resource": "*"
    }
  ]
}
JSON`,
          },
          {
            title: "Attach the policy to the role",
            why: "Completes the read role. Credentials are minted per call and expire in an hour.",
            command: `aws iam put-role-policy \\
  --role-name "aegis-read" \\
  --policy-name "aegis-read" \\
  --policy-document file://aegis-read-policy.json`,
          },
        ],
        outputs: [
          "The role ARN is arn:aws:iam::$AWS_ACCOUNT_ID:role/aegis-read",
          "Paste that ARN into the AWS card under 'Read tier'. There is no secret to copy.",
        ],
      },
      manual: [
        {
          title: "Open the IAM identity providers page",
          url: "https://console.aws.amazon.com/iam/home#/identity_providers",
          detail:
            "Add provider, choose OpenID Connect, provider URL is this broker's URL, audience is sts.amazonaws.com.",
          why: "Lets AWS accept a signed token from this app in place of a stored key.",
        },
        {
          title: "Create a role named aegis-read",
          url: "https://console.aws.amazon.com/iam/home#/roles",
          detail:
            "Trusted entity: web identity, the provider you just added. Inline policy allowing lambda:GetFunction, lambda:ListFunctions and logs:FilterLogEvents.",
          why: "Read-only inspection of the broker fleet.",
        },
      ],
    },
    write: {
      summary: "Create and update Lambda functions. Cannot delete.",
      lifetime: "short-lived",
      vault: "aegis-write",
      bootstrapScopes: [],
      capabilities: [
        "Deploy a broker to its own isolated Lambda",
        "Update function code and configuration",
        "Create the execution role a new broker needs",
      ],
      scopes: [
        {
          name: "lambda:CreateFunction, lambda:UpdateFunctionCode, lambda:UpdateFunctionConfiguration",
          grants: "Create and update functions whose name starts with aegis-.",
          why: "Deploys and updates broker runtimes.",
        },
        {
          name: "lambda:CreateFunctionUrlConfig",
          grants: "Give a broker function its own HTTPS URL.",
          why: "The MCP endpoint for that broker.",
        },
        {
          name: "iam:PassRole",
          grants: "Pass the aegis execution role to a function.",
          why: "Required by Lambda; scoped to the single execution role we create.",
        },
      ],
      blueprint: {
        variables: [ACCOUNT, REGION, ISSUER],
        steps: [
          {
            title: "Write the trust policy for the write role",
            why: "Same federation, different subject, so a read token can never assume the write role.",
            command: `cat > aegis-write-trust.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::AWS_ACCOUNT_ID:oidc-provider/ISSUER_HOST" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": { "StringEquals": { "ISSUER_HOST:sub": "aegis:write" } }
    }
  ]
}
JSON`,
          },
          {
            title: "Create the write role",
            why: "Deployment power lives in its own identity that inspection never touches.",
            command: `aws iam create-role \\
  --role-name "aegis-write" \\
  --assume-role-policy-document file://aegis-write-trust.json`,
          },
          {
            title: "Write the write permission policy",
            why: "Note there is no Delete action here. Names are restricted to the aegis- prefix so nothing else in the account is reachable.",
            command: `cat > aegis-write-policy.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:CreateFunctionUrlConfig"
      ],
      "Resource": "arn:aws:lambda:AWS_REGION:AWS_ACCOUNT_ID:function:aegis-*"
    },
    {
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::AWS_ACCOUNT_ID:role/aegis-execution"
    }
  ]
}
JSON`,
          },
          {
            title: "Attach the policy to the role",
            why: "Completes the write role.",
            command: `aws iam put-role-policy \\
  --role-name "aegis-write" \\
  --policy-name "aegis-write" \\
  --policy-document file://aegis-write-policy.json`,
          },
        ],
        outputs: [
          "The role ARN is arn:aws:iam::$AWS_ACCOUNT_ID:role/aegis-write",
          "Paste that ARN into the AWS card under 'Write tier'.",
        ],
      },
      manual: [
        {
          title: "Create a role named aegis-write",
          url: "https://console.aws.amazon.com/iam/home#/roles",
          detail:
            "Web identity trust on the same provider, inline policy with the create and update Lambda actions scoped to function:aegis-*.",
          why: "Deployment without any delete power.",
        },
      ],
    },
    destructive: {
      summary: "Remove functions and roles. Locked behind your security key, one use at a time.",
      lifetime: "single-use",
      vault: "aegis-admin",
      bootstrapScopes: [],
      capabilities: ["Tear down a broker's Lambda and its execution role"],
      scopes: [
        {
          name: "lambda:DeleteFunction",
          grants: "Delete functions named aegis-*.",
          why: "Retiring a broker cleanly.",
        },
        {
          name: "iam:DeleteRole, iam:DeleteRolePolicy",
          grants: "Delete the execution role belonging to a retired broker.",
          why: "Leaves no orphaned identity behind.",
        },
      ],
      blueprint: {
        variables: [ACCOUNT, REGION, ISSUER],
        steps: [
          {
            title: "Write the trust policy for the destructive role",
            why: "A separate subject again. The app only requests this token after your security key has been touched, and discards it after one call.",
            command: `cat > aegis-admin-trust.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::AWS_ACCOUNT_ID:oidc-provider/ISSUER_HOST" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": { "StringEquals": { "ISSUER_HOST:sub": "aegis:admin" } }
    }
  ]
}
JSON`,
          },
          {
            title: "Create the destructive role with a one hour maximum session",
            why: "Even if a token were captured it stops working within the hour.",
            command: `aws iam create-role \\
  --role-name "aegis-admin" \\
  --max-session-duration 3600 \\
  --assume-role-policy-document file://aegis-admin-trust.json`,
          },
          {
            title: "Write and attach the delete-only policy",
            why: "Delete actions and nothing else, restricted to resources this app created.",
            command: `cat > aegis-admin-policy.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [ "lambda:DeleteFunction", "iam:DeleteRole", "iam:DeleteRolePolicy" ],
      "Resource": [
        "arn:aws:lambda:AWS_REGION:AWS_ACCOUNT_ID:function:aegis-*",
        "arn:aws:iam::AWS_ACCOUNT_ID:role/aegis-*"
      ]
    }
  ]
}
JSON`,
          },
          {
            title: "Attach it",
            why: "Completes the destructive role.",
            command: `aws iam put-role-policy \\
  --role-name "aegis-admin" \\
  --policy-name "aegis-admin" \\
  --policy-document file://aegis-admin-policy.json`,
          },
        ],
        outputs: [
          "The role ARN is arn:aws:iam::$AWS_ACCOUNT_ID:role/aegis-admin",
          "Paste that ARN into the AWS card under 'Destructive tier'. It stays sealed until your security key is used.",
        ],
      },
      manual: [
        {
          title: "Create a role named aegis-admin",
          url: "https://console.aws.amazon.com/iam/home#/roles",
          detail: "Web identity trust, delete-only inline policy, maximum session duration one hour.",
          why: "Teardown is the only thing this identity can do.",
        },
      ],
    },
  },
};
