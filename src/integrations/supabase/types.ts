export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      access_events: {
        Row: {
          action: string
          actor: string | null
          actor_email: string | null
          created_at: string
          expires_at: string | null
          id: string
          mode: string | null
          reason: string | null
        }
        Insert: {
          action: string
          actor?: string | null
          actor_email?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          mode?: string | null
          reason?: string | null
        }
        Update: {
          action?: string
          actor?: string | null
          actor_email?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          mode?: string | null
          reason?: string | null
        }
        Relationships: []
      }
      access_policy: {
        Row: {
          breakglass_until: string | null
          id: string
          mode: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          breakglass_until?: string | null
          id?: string
          mode?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          breakglass_until?: string | null
          id?: string
          mode?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      access_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          label: string
          last_used_at: string | null
          revoked_at: string | null
          server_id: string
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
          server_id: string
          token_hash: string
          token_prefix: string
          user_id?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
          server_id?: string
          token_hash?: string
          token_prefix?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_tokens_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          args: Json
          created_at: string
          decided_at: string | null
          expires_at: string
          id: string
          server_id: string
          status: string
          tool_name: string
          user_id: string
        }
        Insert: {
          args?: Json
          created_at?: string
          decided_at?: string | null
          expires_at?: string
          id?: string
          server_id: string
          status?: string
          tool_name: string
          user_id: string
        }
        Update: {
          args?: Json
          created_at?: string
          decided_at?: string | null
          expires_at?: string
          id?: string
          server_id?: string
          status?: string
          tool_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      attestations: {
        Row: {
          created_at: string
          deploy_digest: string
          id: string
          key_thumbprint: string
          note: string
          trusted: boolean
        }
        Insert: {
          created_at?: string
          deploy_digest?: string
          id?: string
          key_thumbprint: string
          note?: string
          trusted?: boolean
        }
        Update: {
          created_at?: string
          deploy_digest?: string
          id?: string
          key_thumbprint?: string
          note?: string
          trusted?: boolean
        }
        Relationships: []
      }
      audit_archive: {
        Row: {
          batch: Json
          created_at: string
          day: string
          event_count: number
          id: string
          server_id: string
          user_id: string
        }
        Insert: {
          batch?: Json
          created_at?: string
          day: string
          event_count?: number
          id?: string
          server_id: string
          user_id: string
        }
        Update: {
          batch?: Json
          created_at?: string
          day?: string
          event_count?: number
          id?: string
          server_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_archive_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          created_at: string
          duration_ms: number | null
          event: string
          id: string
          level: string
          message: string
          meta: Json
          server_id: string | null
          status_code: number | null
          tool_name: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          event: string
          id?: string
          level?: string
          message?: string
          meta?: Json
          server_id?: string | null
          status_code?: number | null
          tool_name?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          event?: string
          id?: string
          level?: string
          message?: string
          meta?: Json
          server_id?: string | null
          status_code?: number | null
          tool_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_rollups: {
        Row: {
          calls: number
          created_at: string
          day: string
          errors: number
          id: string
          p50_ms: number
          p95_ms: number
          server_id: string
          tool_name: string
          user_id: string
          warnings: number
        }
        Insert: {
          calls?: number
          created_at?: string
          day: string
          errors?: number
          id?: string
          p50_ms?: number
          p95_ms?: number
          server_id: string
          tool_name?: string
          user_id: string
          warnings?: number
        }
        Update: {
          calls?: number
          created_at?: string
          day?: string
          errors?: number
          id?: string
          p50_ms?: number
          p95_ms?: number
          server_id?: string
          tool_name?: string
          user_id?: string
          warnings?: number
        }
        Relationships: [
          {
            foreignKeyName: "audit_rollups_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      breakglass_codes: {
        Row: {
          code_hash: string
          created_at: string
          created_by: string | null
          id: string
          label: string
          revoked_at: string | null
          used_at: string | null
        }
        Insert: {
          code_hash: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          revoked_at?: string | null
          used_at?: string | null
        }
        Update: {
          code_hash?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          revoked_at?: string | null
          used_at?: string | null
        }
        Relationships: []
      }
      credentials: {
        Row: {
          created_at: string
          encrypted_value: string
          expires_at: string | null
          header_name: string
          id: string
          kind: Database["public"]["Enums"]["auth_kind"]
          label: string
          rotated_at: string
          server_id: string
          updated_at: string
          user_id: string
          value_template: string
        }
        Insert: {
          created_at?: string
          encrypted_value: string
          expires_at?: string | null
          header_name?: string
          id?: string
          kind?: Database["public"]["Enums"]["auth_kind"]
          label?: string
          rotated_at?: string
          server_id: string
          updated_at?: string
          user_id?: string
          value_template?: string
        }
        Update: {
          created_at?: string
          encrypted_value?: string
          expires_at?: string | null
          header_name?: string
          id?: string
          kind?: Database["public"]["Enums"]["auth_kind"]
          label?: string
          rotated_at?: string
          server_id?: string
          updated_at?: string
          user_id?: string
          value_template?: string
        }
        Relationships: [
          {
            foreignKeyName: "credentials_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      deploy_events: {
        Row: {
          action: string
          created_at: string
          deployment_id: string | null
          detail: string
          id: string
          server_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          deployment_id?: string | null
          detail?: string
          id?: string
          server_id?: string | null
          status: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          deployment_id?: string | null
          detail?: string
          id?: string
          server_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deploy_events_deployment_id_fkey"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "deployments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deploy_events_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      deployment_stage: {
        Row: {
          acknowledgements: Json
          id: string
          stage: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          acknowledgements?: Json
          id?: string
          stage?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          acknowledgements?: Json
          id?: string
          stage?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      deployments: {
        Row: {
          created_at: string
          id: string
          last_error: string | null
          last_reconciled_at: string | null
          route_url: string | null
          server_id: string
          spec_digest: string | null
          status: string
          target: string
          updated_at: string
          user_id: string
          version: number
          worker_name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_error?: string | null
          last_reconciled_at?: string | null
          route_url?: string | null
          server_id: string
          spec_digest?: string | null
          status?: string
          target?: string
          updated_at?: string
          user_id: string
          version?: number
          worker_name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_error?: string | null
          last_reconciled_at?: string | null
          route_url?: string | null
          server_id?: string
          spec_digest?: string | null
          status?: string
          target?: string
          updated_at?: string
          user_id?: string
          version?: number
          worker_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deployments_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: true
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_claims: {
        Row: {
          claimed_by: string | null
          claimed_email: string | null
          created_at: string
          domain: string
          id: string
          sso_kind: string | null
          sso_metadata_url: string | null
          sso_provider_id: string | null
          sso_rotated_at: string | null
          status: string
          txt_token: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          claimed_by?: string | null
          claimed_email?: string | null
          created_at?: string
          domain: string
          id?: string
          sso_kind?: string | null
          sso_metadata_url?: string | null
          sso_provider_id?: string | null
          sso_rotated_at?: string | null
          status?: string
          txt_token: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          claimed_by?: string | null
          claimed_email?: string | null
          created_at?: string
          domain?: string
          id?: string
          sso_kind?: string | null
          sso_metadata_url?: string | null
          sso_provider_id?: string | null
          sso_rotated_at?: string | null
          status?: string
          txt_token?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      dpop_proofs: {
        Row: {
          created_at: string
          expires_at: string
          jkt: string
          jti: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          jkt: string
          jti: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          jkt?: string
          jti?: string
        }
        Relationships: []
      }
      identity_verifications: {
        Row: {
          attempts: number
          code_hash: string | null
          consumed_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          method: string
          session_hash: string
          user_id: string | null
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          code_hash?: string | null
          consumed_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          method: string
          session_hash: string
          user_id?: string | null
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          code_hash?: string | null
          consumed_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          method?: string
          session_hash?: string
          user_id?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      ingest_sources: {
        Row: {
          auth_mode: string
          created_at: string
          created_by: string | null
          disabled: boolean
          enroll_expires_at: string | null
          enroll_hash: string | null
          enrolled_at: string | null
          event_count: number
          id: string
          jkt: string | null
          key_hash: string | null
          key_prefix: string | null
          kind: string
          last_seen_at: string | null
          name: string
          public_jwk: Json | null
          redact_keys: string[]
          server_id: string | null
          updated_at: string
        }
        Insert: {
          auth_mode?: string
          created_at?: string
          created_by?: string | null
          disabled?: boolean
          enroll_expires_at?: string | null
          enroll_hash?: string | null
          enrolled_at?: string | null
          event_count?: number
          id?: string
          jkt?: string | null
          key_hash?: string | null
          key_prefix?: string | null
          kind?: string
          last_seen_at?: string | null
          name: string
          public_jwk?: Json | null
          redact_keys?: string[]
          server_id?: string | null
          updated_at?: string
        }
        Update: {
          auth_mode?: string
          created_at?: string
          created_by?: string | null
          disabled?: boolean
          enroll_expires_at?: string | null
          enroll_hash?: string | null
          enrolled_at?: string | null
          event_count?: number
          id?: string
          jkt?: string | null
          key_hash?: string | null
          key_prefix?: string | null
          kind?: string
          last_seen_at?: string | null
          name?: string
          public_jwk?: Json | null
          redact_keys?: string[]
          server_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingest_sources_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      instance_claim: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          claimed_email: string | null
          created_at: string
          id: boolean
          recovery_hash: string | null
          recovery_used_at: string | null
          updated_at: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          claimed_email?: string | null
          created_at?: string
          id?: boolean
          recovery_hash?: string | null
          recovery_used_at?: string | null
          updated_at?: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          claimed_email?: string | null
          created_at?: string
          id?: boolean
          recovery_hash?: string | null
          recovery_used_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      integration_events: {
        Row: {
          actor: string | null
          created_at: string
          id: string
          level: string
          message: string
          meta: Json
          provider: string
          step: string
          tier: string | null
        }
        Insert: {
          actor?: string | null
          created_at?: string
          id?: string
          level?: string
          message: string
          meta?: Json
          provider: string
          step: string
          tier?: string | null
        }
        Update: {
          actor?: string | null
          created_at?: string
          id?: string
          level?: string
          message?: string
          meta?: Json
          provider?: string
          step?: string
          tier?: string | null
        }
        Relationships: []
      }
      integration_sessions: {
        Row: {
          actor: string | null
          code_verifier: string
          created_at: string
          expires_at: string
          id: string
          provider: string
          redirect_uri: string
          state: string
          tier: string
        }
        Insert: {
          actor?: string | null
          code_verifier: string
          created_at?: string
          expires_at: string
          id?: string
          provider: string
          redirect_uri: string
          state: string
          tier: string
        }
        Update: {
          actor?: string | null
          code_verifier?: string
          created_at?: string
          expires_at?: string
          id?: string
          provider?: string
          redirect_uri?: string
          state?: string
          tier?: string
        }
        Relationships: []
      }
      integrations: {
        Row: {
          account_label: string | null
          created_at: string
          expires_at: string | null
          id: string
          installed_via: string | null
          last_verified_at: string | null
          provider: string
          revoked_at: string | null
          status: string
          tiers: Json
          updated_at: string
        }
        Insert: {
          account_label?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          installed_via?: string | null
          last_verified_at?: string | null
          provider: string
          revoked_at?: string | null
          status?: string
          tiers?: Json
          updated_at?: string
        }
        Update: {
          account_label?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          installed_via?: string | null
          last_verified_at?: string | null
          provider?: string
          revoked_at?: string | null
          status?: string
          tiers?: Json
          updated_at?: string
        }
        Relationships: []
      }
      mfa_factors: {
        Row: {
          created_at: string
          id: string
          kind: string
          label: string | null
          reference: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          label?: string | null
          reference: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          label?: string | null
          reference?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      mfa_recovery_codes: {
        Row: {
          code_hash: string
          created_at: string
          id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          id?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      model_prices: {
        Row: {
          cached_per_mtok: number
          created_at: string
          effective_from: string
          id: string
          input_per_mtok: number
          model: string
          output_per_mtok: number
          provider: string
        }
        Insert: {
          cached_per_mtok?: number
          created_at?: string
          effective_from?: string
          id?: string
          input_per_mtok?: number
          model: string
          output_per_mtok?: number
          provider: string
        }
        Update: {
          cached_per_mtok?: number
          created_at?: string
          effective_from?: string
          id?: string
          input_per_mtok?: number
          model?: string
          output_per_mtok?: number
          provider?: string
        }
        Relationships: []
      }
      oauth_clients: {
        Row: {
          client_id: string
          client_secret_hash: string | null
          created_at: string
          disabled: boolean
          dpop_mode: string
          dpop_observed: boolean
          id: string
          last_seen_at: string | null
          name: string
          redirect_uris: string[]
          registration_kind: string
          server_id: string
          user_id: string | null
        }
        Insert: {
          client_id: string
          client_secret_hash?: string | null
          created_at?: string
          disabled?: boolean
          dpop_mode?: string
          dpop_observed?: boolean
          id?: string
          last_seen_at?: string | null
          name?: string
          redirect_uris?: string[]
          registration_kind?: string
          server_id: string
          user_id?: string | null
        }
        Update: {
          client_id?: string
          client_secret_hash?: string | null
          created_at?: string
          disabled?: boolean
          dpop_mode?: string
          dpop_observed?: boolean
          id?: string
          last_seen_at?: string | null
          name?: string
          redirect_uris?: string[]
          registration_kind?: string
          server_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oauth_clients_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_grants: {
        Row: {
          access_expires_at: string
          access_token_hash: string
          call_count: number
          client_id: string
          client_name: string
          cnf_jkt: string | null
          created_at: string
          grant_expires_at: string
          id: string
          last_used_at: string | null
          max_calls: number | null
          rate_limit_per_min: number | null
          refresh_generation: number
          refresh_token_hash: string | null
          retired_refresh_hash: string | null
          revoked_at: string | null
          scopes: string[]
          server_id: string
          user_id: string
          webauthn_credential_id: string | null
        }
        Insert: {
          access_expires_at: string
          access_token_hash: string
          call_count?: number
          client_id: string
          client_name?: string
          cnf_jkt?: string | null
          created_at?: string
          grant_expires_at: string
          id?: string
          last_used_at?: string | null
          max_calls?: number | null
          rate_limit_per_min?: number | null
          refresh_generation?: number
          refresh_token_hash?: string | null
          retired_refresh_hash?: string | null
          revoked_at?: string | null
          scopes?: string[]
          server_id: string
          user_id: string
          webauthn_credential_id?: string | null
        }
        Update: {
          access_expires_at?: string
          access_token_hash?: string
          call_count?: number
          client_id?: string
          client_name?: string
          cnf_jkt?: string | null
          created_at?: string
          grant_expires_at?: string
          id?: string
          last_used_at?: string | null
          max_calls?: number | null
          rate_limit_per_min?: number | null
          refresh_generation?: number
          refresh_token_hash?: string | null
          retired_refresh_hash?: string | null
          revoked_at?: string | null
          scopes?: string[]
          server_id?: string
          user_id?: string
          webauthn_credential_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oauth_grants_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_requests: {
        Row: {
          client_id: string
          code_challenge: string
          code_challenge_method: string
          code_hash: string | null
          consumed_at: string | null
          created_at: string
          expires_at: string
          grant_ttl_minutes: number
          granted_scopes: string[]
          id: string
          max_calls: number | null
          redirect_uri: string
          requested_scopes: string[]
          resource: string | null
          server_id: string
          state: string | null
          status: string
          user_id: string | null
          webauthn_credential_id: string | null
        }
        Insert: {
          client_id: string
          code_challenge: string
          code_challenge_method?: string
          code_hash?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          grant_ttl_minutes?: number
          granted_scopes?: string[]
          id?: string
          max_calls?: number | null
          redirect_uri: string
          requested_scopes?: string[]
          resource?: string | null
          server_id: string
          state?: string | null
          status?: string
          user_id?: string | null
          webauthn_credential_id?: string | null
        }
        Update: {
          client_id?: string
          code_challenge?: string
          code_challenge_method?: string
          code_hash?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          grant_ttl_minutes?: number
          granted_scopes?: string[]
          id?: string
          max_calls?: number | null
          redirect_uri?: string
          requested_scopes?: string[]
          resource?: string | null
          server_id?: string
          state?: string | null
          status?: string
          user_id?: string | null
          webauthn_credential_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oauth_requests_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_requests_webauthn_credential_id_fkey"
            columns: ["webauthn_credential_id"]
            isOneToOne: false
            referencedRelation: "webauthn_credentials"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_invites: {
        Row: {
          created_at: string
          created_by: string
          email: string
          id: string
          role: Database["public"]["Enums"]["operator_role"]
        }
        Insert: {
          created_at?: string
          created_by: string
          email: string
          id?: string
          role?: Database["public"]["Enums"]["operator_role"]
        }
        Update: {
          created_at?: string
          created_by?: string
          email?: string
          id?: string
          role?: Database["public"]["Enums"]["operator_role"]
        }
        Relationships: []
      }
      operators: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          role: Database["public"]["Enums"]["operator_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          role?: Database["public"]["Enums"]["operator_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          role?: Database["public"]["Enums"]["operator_role"]
          user_id?: string
        }
        Relationships: []
      }
      rate_counters: {
        Row: {
          count: number
          subject: string
          window_start: string
        }
        Insert: {
          count?: number
          subject: string
          window_start: string
        }
        Update: {
          count?: number
          subject?: string
          window_start?: string
        }
        Relationships: []
      }
      servers: {
        Row: {
          auth_type: Database["public"]["Enums"]["auth_kind"]
          base_url: string
          created_at: string
          description: string
          dpop_mode: string
          enabled: boolean
          health: Database["public"]["Enums"]["health_state"]
          id: string
          instructions: string
          kind: Database["public"]["Enums"]["server_kind"]
          last_health_check: string | null
          name: string
          rate_limit_per_min: number
          retention_days: number
          runtime_target: string
          slug: string
          updated_at: string
          user_id: string
          webauthn_authenticator: string
          webauthn_policy: string
          webauthn_sso_fallback: boolean
        }
        Insert: {
          auth_type?: Database["public"]["Enums"]["auth_kind"]
          base_url?: string
          created_at?: string
          description?: string
          dpop_mode?: string
          enabled?: boolean
          health?: Database["public"]["Enums"]["health_state"]
          id?: string
          instructions?: string
          kind?: Database["public"]["Enums"]["server_kind"]
          last_health_check?: string | null
          name: string
          rate_limit_per_min?: number
          retention_days?: number
          runtime_target?: string
          slug: string
          updated_at?: string
          user_id?: string
          webauthn_authenticator?: string
          webauthn_policy?: string
          webauthn_sso_fallback?: boolean
        }
        Update: {
          auth_type?: Database["public"]["Enums"]["auth_kind"]
          base_url?: string
          created_at?: string
          description?: string
          dpop_mode?: string
          enabled?: boolean
          health?: Database["public"]["Enums"]["health_state"]
          id?: string
          instructions?: string
          kind?: Database["public"]["Enums"]["server_kind"]
          last_health_check?: string | null
          name?: string
          rate_limit_per_min?: number
          retention_days?: number
          runtime_target?: string
          slug?: string
          updated_at?: string
          user_id?: string
          webauthn_authenticator?: string
          webauthn_policy?: string
          webauthn_sso_fallback?: boolean
        }
        Relationships: []
      }
      signing_keys: {
        Row: {
          active: boolean
          created_at: string
          id: string
          kid: string
          private_jwk_encrypted: string
          public_jwk: Json
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          kid: string
          private_jwk_encrypted: string
          public_jwk: Json
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          kid?: string
          private_jwk_encrypted?: string
          public_jwk?: Json
        }
        Relationships: []
      }
      span_costs: {
        Row: {
          cached_price: number
          cached_tokens: number
          cost_usd: number
          input_price: number
          input_tokens: number
          model: string
          occurred_at: string
          output_price: number
          output_tokens: number
          provider: string
          reasoning_tokens: number
          span_id: string
          trace_id: string
        }
        Insert: {
          cached_price?: number
          cached_tokens?: number
          cost_usd?: number
          input_price?: number
          input_tokens?: number
          model?: string
          occurred_at?: string
          output_price?: number
          output_tokens?: number
          provider?: string
          reasoning_tokens?: number
          span_id: string
          trace_id: string
        }
        Update: {
          cached_price?: number
          cached_tokens?: number
          cost_usd?: number
          input_price?: number
          input_tokens?: number
          model?: string
          occurred_at?: string
          output_price?: number
          output_tokens?: number
          provider?: string
          reasoning_tokens?: number
          span_id?: string
          trace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "span_costs_span_id_fkey"
            columns: ["span_id"]
            isOneToOne: true
            referencedRelation: "spans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "span_costs_trace_id_fkey"
            columns: ["trace_id"]
            isOneToOne: false
            referencedRelation: "traces"
            referencedColumns: ["id"]
          },
        ]
      }
      span_payloads: {
        Row: {
          archived_at: string | null
          args: Json | null
          bytes: number
          context_window: Json | null
          created_at: string
          input: string | null
          output: string | null
          result: Json | null
          span_id: string
          system_prompt: string | null
        }
        Insert: {
          archived_at?: string | null
          args?: Json | null
          bytes?: number
          context_window?: Json | null
          created_at?: string
          input?: string | null
          output?: string | null
          result?: Json | null
          span_id: string
          system_prompt?: string | null
        }
        Update: {
          archived_at?: string | null
          args?: Json | null
          bytes?: number
          context_window?: Json | null
          created_at?: string
          input?: string | null
          output?: string | null
          result?: Json | null
          span_id?: string
          system_prompt?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "span_payloads_span_id_fkey"
            columns: ["span_id"]
            isOneToOne: true
            referencedRelation: "spans"
            referencedColumns: ["id"]
          },
        ]
      }
      spans: {
        Row: {
          attributes: Json
          created_at: string
          duration_ms: number
          error: string | null
          external_id: string
          id: string
          kind: string
          model: string
          name: string
          normalized: boolean
          parent_external_id: string | null
          provider: string
          raw: Json
          skill: string | null
          source_id: string
          started_at: string
          status: string
          status_code: number | null
          tool_name: string | null
          trace_id: string
        }
        Insert: {
          attributes?: Json
          created_at?: string
          duration_ms?: number
          error?: string | null
          external_id: string
          id?: string
          kind?: string
          model?: string
          name?: string
          normalized?: boolean
          parent_external_id?: string | null
          provider?: string
          raw?: Json
          skill?: string | null
          source_id: string
          started_at?: string
          status?: string
          status_code?: number | null
          tool_name?: string | null
          trace_id: string
        }
        Update: {
          attributes?: Json
          created_at?: string
          duration_ms?: number
          error?: string | null
          external_id?: string
          id?: string
          kind?: string
          model?: string
          name?: string
          normalized?: boolean
          parent_external_id?: string | null
          provider?: string
          raw?: Json
          skill?: string | null
          source_id?: string
          started_at?: string
          status?: string
          status_code?: number | null
          tool_name?: string | null
          trace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spans_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "ingest_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spans_trace_id_fkey"
            columns: ["trace_id"]
            isOneToOne: false
            referencedRelation: "traces"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_events: {
        Row: {
          actor: string | null
          actor_email: string | null
          created_at: string
          detail: string
          dry_run: boolean
          id: string
          stage: string
          status: string
          step: string
        }
        Insert: {
          actor?: string | null
          actor_email?: string | null
          created_at?: string
          detail?: string
          dry_run?: boolean
          id?: string
          stage: string
          status: string
          step: string
        }
        Update: {
          actor?: string | null
          actor_email?: string | null
          created_at?: string
          detail?: string
          dry_run?: boolean
          id?: string
          stage?: string
          status?: string
          step?: string
        }
        Relationships: []
      }
      telemetry_archive: {
        Row: {
          batch: Json | null
          bytes: number
          content_hash: string
          created_at: string
          day: string
          event_count: number
          id: string
          object_key: string
          source_id: string | null
          stored_in: string
        }
        Insert: {
          batch?: Json | null
          bytes?: number
          content_hash: string
          created_at?: string
          day: string
          event_count?: number
          id?: string
          object_key: string
          source_id?: string | null
          stored_in?: string
        }
        Update: {
          batch?: Json | null
          bytes?: number
          content_hash?: string
          created_at?: string
          day?: string
          event_count?: number
          id?: string
          object_key?: string
          source_id?: string | null
          stored_in?: string
        }
        Relationships: [
          {
            foreignKeyName: "telemetry_archive_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "ingest_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      tools: {
        Row: {
          approval: Database["public"]["Enums"]["approval_mode"]
          body_template: Json | null
          created_at: string
          description: string
          enabled: boolean
          header_template: Json
          id: string
          input_schema: Json
          method: string
          name: string
          path: string
          scopes: string[]
          server_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approval?: Database["public"]["Enums"]["approval_mode"]
          body_template?: Json | null
          created_at?: string
          description?: string
          enabled?: boolean
          header_template?: Json
          id?: string
          input_schema?: Json
          method?: string
          name: string
          path?: string
          scopes?: string[]
          server_id: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          approval?: Database["public"]["Enums"]["approval_mode"]
          body_template?: Json | null
          created_at?: string
          description?: string
          enabled?: boolean
          header_template?: Json
          id?: string
          input_schema?: Json
          method?: string
          name?: string
          path?: string
          scopes?: string[]
          server_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tools_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      traces: {
        Row: {
          actor: string
          attributes: Json
          client: string
          created_at: string
          ended_at: string | null
          environment: string
          error_count: number
          external_id: string
          id: string
          intent: string
          name: string
          source_id: string
          span_count: number
          started_at: string
          status: string
          total_cost_usd: number
          total_tokens: number
          updated_at: string
        }
        Insert: {
          actor?: string
          attributes?: Json
          client?: string
          created_at?: string
          ended_at?: string | null
          environment?: string
          error_count?: number
          external_id: string
          id?: string
          intent?: string
          name?: string
          source_id: string
          span_count?: number
          started_at?: string
          status?: string
          total_cost_usd?: number
          total_tokens?: number
          updated_at?: string
        }
        Update: {
          actor?: string
          attributes?: Json
          client?: string
          created_at?: string
          ended_at?: string | null
          environment?: string
          error_count?: number
          external_id?: string
          id?: string
          intent?: string
          name?: string
          source_id?: string
          span_count?: number
          started_at?: string
          status?: string
          total_cost_usd?: number
          total_tokens?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "traces_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "ingest_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      tunnels: {
        Row: {
          access_app_id: string | null
          access_aud: string | null
          connector_token: string | null
          connectors: number
          created_at: string
          dns_record_id: string | null
          hostname: string
          id: string
          last_checked_at: string | null
          last_error: string | null
          server_id: string
          status: string
          tunnel_id: string
          tunnel_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_app_id?: string | null
          access_aud?: string | null
          connector_token?: string | null
          connectors?: number
          created_at?: string
          dns_record_id?: string | null
          hostname: string
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          server_id: string
          status?: string
          tunnel_id?: string
          tunnel_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_app_id?: string | null
          access_aud?: string | null
          connector_token?: string | null
          connectors?: number
          created_at?: string
          dns_record_id?: string | null
          hostname?: string
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          server_id?: string
          status?: string
          tunnel_id?: string
          tunnel_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tunnels_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: true
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      upstream_grants: {
        Row: {
          created_at: string
          expires_at: string | null
          grant_kind: string
          id: string
          key_ref: string | null
          rotated_at: string
          rotations: number
          scope: string
          sealed_grant: string | null
          server_id: string
          subject: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          grant_kind?: string
          id?: string
          key_ref?: string | null
          rotated_at?: string
          rotations?: number
          scope?: string
          sealed_grant?: string | null
          server_id: string
          subject?: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          grant_kind?: string
          id?: string
          key_ref?: string | null
          rotated_at?: string
          rotations?: number
          scope?: string
          sealed_grant?: string | null
          server_id?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "upstream_tokens_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      upstream_oauth: {
        Row: {
          audience: string | null
          authorize_url: string
          aws_service: string | null
          client_id: string
          created_at: string
          encrypted_client_secret: string | null
          grant_kind: string
          header_name: string
          id: string
          key_ref: string | null
          provider: string
          scopes: string[]
          server_id: string
          token_url: string
          updated_at: string
          user_id: string
          value_template: string
        }
        Insert: {
          audience?: string | null
          authorize_url: string
          aws_service?: string | null
          client_id: string
          created_at?: string
          encrypted_client_secret?: string | null
          grant_kind?: string
          header_name?: string
          id?: string
          key_ref?: string | null
          provider?: string
          scopes?: string[]
          server_id: string
          token_url: string
          updated_at?: string
          user_id: string
          value_template?: string
        }
        Update: {
          audience?: string | null
          authorize_url?: string
          aws_service?: string | null
          client_id?: string
          created_at?: string
          encrypted_client_secret?: string | null
          grant_kind?: string
          header_name?: string
          id?: string
          key_ref?: string | null
          provider?: string
          scopes?: string[]
          server_id?: string
          token_url?: string
          updated_at?: string
          user_id?: string
          value_template?: string
        }
        Relationships: [
          {
            foreignKeyName: "upstream_oauth_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: true
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      upstream_sessions: {
        Row: {
          code_verifier: string
          created_at: string
          expires_at: string
          id: string
          redirect_uri: string
          server_id: string
          state: string
          subject: string
        }
        Insert: {
          code_verifier: string
          created_at?: string
          expires_at: string
          id?: string
          redirect_uri: string
          server_id: string
          state: string
          subject?: string
        }
        Update: {
          code_verifier?: string
          created_at?: string
          expires_at?: string
          id?: string
          redirect_uri?: string
          server_id?: string
          state?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "upstream_sessions_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      webauthn_challenges: {
        Row: {
          challenge: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          purpose: string
          request_id: string | null
          user_id: string | null
        }
        Insert: {
          challenge: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          purpose: string
          request_id?: string | null
          user_id?: string | null
        }
        Update: {
          challenge?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          purpose?: string
          request_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      webauthn_credentials: {
        Row: {
          aaguid: string | null
          attachment: string
          backed_up: boolean
          counter: number
          created_at: string
          credential_id: string
          id: string
          label: string
          last_used_at: string | null
          public_key: string
          transports: string[]
          user_id: string
        }
        Insert: {
          aaguid?: string | null
          attachment?: string
          backed_up?: boolean
          counter?: number
          created_at?: string
          credential_id: string
          id?: string
          label?: string
          last_used_at?: string | null
          public_key: string
          transports?: string[]
          user_id: string
        }
        Update: {
          aaguid?: string | null
          attachment?: string
          backed_up?: boolean
          counter?: number
          created_at?: string
          credential_id?: string
          id?: string
          label?: string
          last_used_at?: string | null
          public_key?: string
          transports?: string[]
          user_id?: string
        }
        Relationships: []
      }
      wire_logs: {
        Row: {
          client_name: string
          country: string
          created_at: string
          duration_ms: number
          grant_id: string | null
          id: string
          inbound_tokens: number
          ip: string
          outbound_tokens: number
          outcome: string
          request_body: Json
          request_bytes: number
          request_headers: Json
          response_body: string
          response_bytes: number
          rpc_method: string
          server_id: string
          session_kind: string
          status_code: number
          tool_name: string | null
          total_tokens: number
          upstream_duration_ms: number | null
          upstream_method: string | null
          upstream_request: Json | null
          upstream_response: string | null
          upstream_status: number | null
          upstream_tokens: number
          upstream_url: string | null
          user_agent: string
          user_id: string
        }
        Insert: {
          client_name?: string
          country?: string
          created_at?: string
          duration_ms?: number
          grant_id?: string | null
          id?: string
          inbound_tokens?: number
          ip?: string
          outbound_tokens?: number
          outcome?: string
          request_body?: Json
          request_bytes?: number
          request_headers?: Json
          response_body?: string
          response_bytes?: number
          rpc_method?: string
          server_id: string
          session_kind?: string
          status_code?: number
          tool_name?: string | null
          total_tokens?: number
          upstream_duration_ms?: number | null
          upstream_method?: string | null
          upstream_request?: Json | null
          upstream_response?: string | null
          upstream_status?: number | null
          upstream_tokens?: number
          upstream_url?: string | null
          user_agent?: string
          user_id: string
        }
        Update: {
          client_name?: string
          country?: string
          created_at?: string
          duration_ms?: number
          grant_id?: string | null
          id?: string
          inbound_tokens?: number
          ip?: string
          outbound_tokens?: number
          outcome?: string
          request_body?: Json
          request_bytes?: number
          request_headers?: Json
          response_body?: string
          response_bytes?: number
          rpc_method?: string
          server_id?: string
          session_kind?: string
          status_code?: number
          tool_name?: string | null
          total_tokens?: number
          upstream_duration_ms?: number | null
          upstream_method?: string | null
          upstream_request?: Json | null
          upstream_response?: string | null
          upstream_status?: number | null
          upstream_tokens?: number
          upstream_url?: string | null
          user_agent?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wire_logs_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      owns_server: { Args: { _server_id: string }; Returns: boolean }
      rate_hit: {
        Args: { _subject: string; _window_seconds: number }
        Returns: number
      }
    }
    Enums: {
      approval_mode: "always_ask" | "always_allow"
      auth_kind: "none" | "api_key" | "bearer" | "basic" | "oauth2"
      health_state: "unknown" | "healthy" | "degraded" | "down"
      operator_role: "owner" | "admin" | "viewer"
      server_kind: "mcp" | "connector"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      approval_mode: ["always_ask", "always_allow"],
      auth_kind: ["none", "api_key", "bearer", "basic", "oauth2"],
      health_state: ["unknown", "healthy", "degraded", "down"],
      operator_role: ["owner", "admin", "viewer"],
      server_kind: ["mcp", "connector"],
    },
  },
} as const
