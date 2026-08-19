import type { Spec } from "../types";

const ACCOUNT = { name: "OP_ACCOUNT", label: "1Password account", example: "acme.1password.com" };
const READ_VAULT = { name: "OP_READ_VAULT", label: "Read vault name", example: "aegis-read", value: "aegis-read" };
const WRITE_VAULT = {
  name: "OP_WRITE_VAULT",
  label: "Write vault name",
  example: "aegis-write",
  value: "aegis-write",
};
const ADMIN_VAULT = {
  name: "OP_ADMIN_VAULT",
  label: "Destructive vault name",
  example: "aegis-admin",
  value: "aegis-admin",
};

export const onepassword: Spec = {
  id: "1password",
  label: "1Password",
  kind: "service",
  summary:
    "Where every credential the app holds actually lives. Three vaults, three service accounts, so read access can never reach a write secret.",
  docsUrl: "https://developer.1password.com/docs/service-accounts/",
  selfProvision: {
    credential: "aegis-seed service account token",
    creates: [
      "confirms aegis-seed, aegis-read, aegis-write and aegis-admin all exist",
      "adopts the read, write and admin service account tokens already filed in aegis-seed",
      "proves each one can reach the vault it is meant to, before any is relied on",
      "keeps the seed sealed as the sole custodian of aegis-seed",
    ],
    hint: "Paste the aegis-seed token once. The app reads the three service accounts you already filed in aegis-seed, verifies each against its vault, and takes custody from there. It creates nothing.",
    docsUrl: "https://developer.1password.com/docs/service-accounts/manage-service-accounts/",
  },
  tiers: {
    read: {
      summary: "Read secrets from the read vault only.",
      lifetime: "annual",
      vault: "aegis-read",
      bootstrapScopes: [],
      capabilities: [
        "Load read credentials for every other integration",
        "Report vault contents and expiry dates",
      ],
      scopes: [
        {
          name: "read on aegis-read",
          grants: "Read items in one vault, and write nothing anywhere.",
          why: "The runtime needs read credentials on every request; nothing else. It cannot reach the vault holding its own token.",
        },
      ],
      blueprint: {
        variables: [ACCOUNT, READ_VAULT],
        steps: [
          {
            title: "Sign in to the 1Password command line",
            why: "Everything below runs as you, in your terminal. No credential is sent anywhere until you paste it back.",
            command: `op signin --account "$OP_ACCOUNT"`,
          },
          {
            title: "Create the read vault",
            why: "A dedicated vault means a leaked read token exposes only inspection credentials.",
            command: `op vault create "$OP_READ_VAULT"`,
          },
          {
            title: "Create the read-only service account",
            why: "Service accounts carry per-vault permissions, so this one physically cannot see the write vault or its own token.",
            command: `op service-account create "aegis-read" \\
  --vault "$OP_READ_VAULT:read_items" \\
  --expires-in 365d`,
          },
        ],
        outputs: [
          "Copy the service account token printed by the last command.",
          "Paste it into the 1Password card under 'Read tier'. It is shown once.",
        ],
      },
      manual: [
        {
          title: "Create the vault",
          url: "https://start.1password.com/vaults",
          detail: "New vault named aegis-read.",
          why: "Separates inspection credentials from everything else.",
        },
        {
          title: "Create a service account",
          url: "https://start.1password.com/developer-tools/directory",
          detail:
            "Grant it Read Items on aegis-read only, and set an expiry of one year. Copy the token when it is shown.",
          why: "The runtime uses this token continuously, so it is the least powerful of the three.",
        },
      ],
    },
    write: {
      summary: "Read the write-capable provider credentials. Unsealed only with your security key.",
      lifetime: "annual",
      vault: "aegis-write",
      bootstrapScopes: [],
      capabilities: ["File newly minted credentials", "Rotate a credential in place"],
      scopes: [
        {
          name: "read on aegis-write",
          grants: "Read items in one vault.",
          why: "Its power is the provider tokens it can see, not any vault write grant — the admin identity is the only thing that files them.",
        },
      ],
      blueprint: {
        variables: [ACCOUNT, WRITE_VAULT],
        steps: [
          {
            title: "Create the write vault",
            why: "Write secrets are separated so that reading one never implies being able to change it.",
            command: `op vault create "$OP_WRITE_VAULT"`,
          },
          {
            title: "Create the write service account",
            why: "This token is stored sealed and is only unsealed after your security key is touched. It reads its vault and writes nothing.",
            command: `op service-account create "aegis-write" \\
  --vault "$OP_WRITE_VAULT:read_items" \\
  --expires-in 365d`,
          },
        ],
        outputs: [
          "Copy the token from the last command.",
          "Paste it under 'Write tier'. It is sealed immediately and never displayed again.",
        ],
      },
      manual: [
        {
          title: "Create the write vault and service account",
          url: "https://start.1password.com/developer-tools/directory",
          detail: "Vault aegis-write, service account with Read Items on that vault only.",
          why: "Bootstrap writes happen rarely, so this credential spends almost all its life sealed.",
        },
      ],
    },
    destructive: {
      summary: "File and replace provider credentials in all three tier vaults. One use per security key touch.",
      lifetime: "single-use",
      vault: "aegis-admin",
      bootstrapScopes: [],
      capabilities: ["Destroy a credential during revocation"],
      scopes: [
        {
          name: "read and write on aegis-read, aegis-write and aegis-admin",
          grants: "Create, replace and remove items in the three tier vaults. No access to aegis-seed.",
          why: "Every provider credential is filed and rotated by this one identity. Its own token lives in aegis-seed, which it cannot see, so it can never overwrite itself.",
        },
      ],
      blueprint: {
        variables: [ACCOUNT, READ_VAULT, WRITE_VAULT, ADMIN_VAULT],
        steps: [
          {
            title: "Create the destructive vault",
            why: "Deletion power is isolated in its own vault and its own identity.",
            command: `op vault create "$OP_ADMIN_VAULT"`,
          },
          {
            title: "Create the destructive service account with a short expiry",
            why: "Ninety days keeps the most dangerous token on the shortest leash of the three.",
            command: `op service-account create "aegis-admin" \\
  --vault "$OP_READ_VAULT:read_items,write_items" \\
  --vault "$OP_WRITE_VAULT:read_items,write_items" \\
  --vault "$OP_ADMIN_VAULT:read_items,write_items" \\
  --expires-in 90d`,
          },
        ],
        outputs: ["Paste the token under 'Destructive tier'. It is sealed behind your security key."],
      },
      manual: [
        {
          title: "Create the admin vault and service account",
          url: "https://start.1password.com/developer-tools/directory",
          detail:
            "Vault aegis-admin, service account with Read and Write Items on all three tier vaults and no access to aegis-seed, ninety day expiry.",
          why: "It files and removes provider credentials, and only after a hardware key touch.",
        },
      ],
    },
  },
};
