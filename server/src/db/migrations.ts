export interface Migration {
  version: number;
  name: string;
  up: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "full_name" varchar(64),
        "user_name" varchar(32) NOT NULL,
        "email" varchar(100) NOT NULL,
        "password" varchar(200) NOT NULL,
        "user_role" varchar(16) DEFAULT 'standard' NOT NULL,
        "settings" jsonb DEFAULT '{}' NOT NULL,
        "created_by" uuid,
        "updated_by" uuid,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now(),
        CONSTRAINT "users_user_name_unique" UNIQUE("user_name"),
        CONSTRAINT "users_email_unique" UNIQUE("email")
      );

      CREATE TABLE "threads" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "title" varchar(150) NOT NULL,
        "current_leaf_message_id" uuid,
        "pinned" boolean DEFAULT false NOT NULL,
        "created_by" uuid,
        "updated_by" uuid,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );

      CREATE TABLE "messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "thread_id" uuid NOT NULL,
        "parent_message_id" uuid,
        "selected_child_id" uuid,
        "data" jsonb NOT NULL,
        "source" varchar(150) NOT NULL,
        "created_by" uuid,
        "updated_by" uuid,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );

      CREATE TABLE "global_settings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "settings" jsonb DEFAULT '{}' NOT NULL,
        "updated_by" uuid,
        "updated_at" timestamp DEFAULT now()
      );

      CREATE TABLE "invitation_codes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "code" uuid DEFAULT gen_random_uuid() NOT NULL,
        "user_role" varchar(16) DEFAULT 'standard' NOT NULL,
        "used" boolean DEFAULT false NOT NULL,
        "used_by" uuid,
        "created_by" uuid,
        "created_at" timestamp DEFAULT now(),
        CONSTRAINT "invitation_codes_code_unique" UNIQUE("code")
      );

      CREATE TABLE "tool_approval_rules" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL,
        "tool_name" varchar(150) NOT NULL,
        "auto_approve" boolean DEFAULT true NOT NULL,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );

      ALTER TABLE "messages"
        ADD CONSTRAINT "messages_thread_id_threads_id_fk"
        FOREIGN KEY ("thread_id") REFERENCES "threads"("id")
        ON DELETE no action ON UPDATE no action;

      ALTER TABLE "messages"
        ADD CONSTRAINT "messages_selected_child_id_fk"
        FOREIGN KEY ("selected_child_id") REFERENCES "messages"("id")
        ON DELETE set null ON UPDATE no action;

      CREATE INDEX "messages_thread_id_idx" ON "messages" USING btree ("thread_id");
      CREATE INDEX "messages_parent_message_id_idx" ON "messages" USING btree ("parent_message_id");
      CREATE INDEX "messages_created_at_idx" ON "messages" USING btree ("created_at");
      CREATE INDEX "threads_current_leaf_message_id_idx" ON "threads" USING btree ("current_leaf_message_id");
      CREATE INDEX "threads_created_at_idx" ON "threads" USING btree ("created_at");
      CREATE INDEX "tool_approval_rules_user_id_idx" ON "tool_approval_rules" USING btree ("user_id");
      CREATE INDEX "tool_approval_rules_user_id_tool_name_idx" ON "tool_approval_rules" USING btree ("user_id", "tool_name");
    `
  },
  {
    version: 2,
    name: 'add_model_to_messages',
    up: `ALTER TABLE "messages" ADD COLUMN "model" varchar(150);`
  },
  {
    version: 3,
    name: 'add_provider_to_messages',
    up: `ALTER TABLE "messages" ADD COLUMN "provider" varchar(50);`
  },
  {
    version: 4,
    name: '!test skip!_create_extension_pgcrypto',
    up: `CREATE EXTENSION IF NOT EXISTS pgcrypto;`
  },
  {
    version: 5,
    name: 'add_credential_store',
    up: `
      CREATE TABLE "credential_store" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "value" bytea NOT NULL,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );
    `
  },
  {
    version: 6,
    name: 'replace_auto_approve_with_approve',
    up: `
      DELETE FROM "tool_approval_rules";
      ALTER TABLE "tool_approval_rules" ADD COLUMN "approve" varchar(20) DEFAULT 'manual' NOT NULL;
      ALTER TABLE "tool_approval_rules" DROP COLUMN "auto_approve";
    `
  },
  {
    version: 7,
    name: 'add_pending_oauth_flows',
    up: `
      CREATE TABLE IF NOT EXISTS "pending_oauth_flows" (
        "state_id" uuid PRIMARY KEY,
        "credential_id" uuid NOT NULL REFERENCES "credential_store"("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL,
        "created_at" timestamp DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS "pending_oauth_flows_created_at_idx" ON "pending_oauth_flows" USING btree ("created_at");
    `
  },
  {
    version: 8,
    name: 'add_knowledge',
    up: `
      CREATE TABLE "knowledge" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" varchar(255) NOT NULL,
        "display_path" varchar(255) NOT NULL,
        "fs_path" varchar(1000) NOT NULL,
        "created_by" uuid,
        "updated_by" uuid,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );
      CREATE INDEX "knowledge_created_by_idx" ON "knowledge" USING btree ("created_by");
      CREATE INDEX "knowledge_name_idx" ON "knowledge" USING btree ("name");
      CREATE INDEX "knowledge_fs_path_idx" ON "knowledge" USING btree ("fs_path");
    `
  },
  {
    version: 9,
    name: 'add_image_analysis_cache',
    up: `
      CREATE TABLE "image_analysis_cache" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "image_path" varchar(500) NOT NULL,
        "model" varchar(150) NOT NULL,
        "description" text NOT NULL,
        "thread_id" uuid NOT NULL,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );
      CREATE INDEX "image_analysis_cache_image_path_idx" ON "image_analysis_cache" USING btree ("image_path");
      CREATE INDEX "image_analysis_cache_thread_id_idx" ON "image_analysis_cache" USING btree ("thread_id");
    `
  },
  {
    version: 10,
    name: 'add_generating_since_to_threads',
    up: `ALTER TABLE "threads" ADD COLUMN "generating_since" timestamp;`
  },
  {
    version: 11,
    name: 'make_users_email_nullable',
    up: `ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;`
  },
  {
    version: 12,
    name: 'add_agent_project',
    up: `
      CREATE TABLE "agent_project" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "title" varchar(150) DEFAULT '-' NOT NULL,
        "status" varchar(16) DEFAULT 'queued' NOT NULL,
        "mode" varchar(16) DEFAULT 'plan' NOT NULL,
        "pinned" boolean DEFAULT false NOT NULL,
        "model_id" varchar(150),
        "model" varchar(150),
        "provider" varchar(64),
        "model_base_url" text,
        "compaction" jsonb DEFAULT '{"summary":"","coveredCount":0}' NOT NULL,
        "queue" jsonb DEFAULT '[]' NOT NULL,
        "created_by" uuid,
        "updated_by" uuid,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );
      CREATE INDEX "agent_project_created_by_idx" ON "agent_project" USING btree ("created_by");
      CREATE INDEX "agent_project_updated_at_idx" ON "agent_project" USING btree ("updated_at");
    `
  },
  {
    version: 13,
    name: 'add_agent_message',
    up: `
      CREATE TABLE "agent_message" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "project_id" uuid NOT NULL REFERENCES "agent_project"("id") ON DELETE CASCADE,
        "seq" bigserial NOT NULL,
        "role" varchar(16) NOT NULL,
        "source" varchar(16) NOT NULL,
        "data" jsonb NOT NULL,
        "plan" jsonb,
        "model" varchar(150),
        "provider" varchar(64),
        "created_by" uuid,
        "updated_by" uuid,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );
      CREATE INDEX "agent_message_project_seq_idx" ON "agent_message" USING btree ("project_id", "seq");
    `
  },
  {
    version: 14,
    name: 'add_missing_common_columns',
    up: `
      ALTER TABLE "global_settings"
        ADD COLUMN IF NOT EXISTS "created_by" uuid,
        ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now();

      ALTER TABLE "invitation_codes"
        ADD COLUMN IF NOT EXISTS "updated_by" uuid,
        ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now();

      UPDATE "invitation_codes"
        SET "updated_by" = COALESCE("used_by", "created_by"),
            "updated_at" = COALESCE("created_at", now())
        WHERE "updated_by" IS NULL;

      ALTER TABLE "tool_approval_rules"
        ADD COLUMN IF NOT EXISTS "created_by" uuid,
        ADD COLUMN IF NOT EXISTS "updated_by" uuid;

      UPDATE "tool_approval_rules"
        SET "created_by" = COALESCE("created_by", "user_id"),
            "updated_by" = COALESCE("updated_by", "user_id");

      ALTER TABLE "credential_store"
        ADD COLUMN IF NOT EXISTS "created_by" uuid,
        ADD COLUMN IF NOT EXISTS "updated_by" uuid;

      ALTER TABLE "pending_oauth_flows"
        ADD COLUMN IF NOT EXISTS "created_by" uuid,
        ADD COLUMN IF NOT EXISTS "updated_by" uuid,
        ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now();

      UPDATE "pending_oauth_flows"
        SET "created_by" = COALESCE("created_by", "user_id"),
            "updated_by" = COALESCE("updated_by", "user_id");

      ALTER TABLE "image_analysis_cache"
        ADD COLUMN IF NOT EXISTS "created_by" uuid,
        ADD COLUMN IF NOT EXISTS "updated_by" uuid;
    `
  },
  {
    version: 15,
    name: 'add_punch_skills',
    up: `
      CREATE TABLE "punch_skills" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" varchar(64) NOT NULL,
        "description" text NOT NULL,
        "enabled" boolean DEFAULT true NOT NULL,
        "fs_path" text NOT NULL,
        "created_by" uuid,
        "updated_by" uuid,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now(),
        CONSTRAINT "punch_skills_user_name_unique" UNIQUE ("created_by", "name")
      );
      CREATE INDEX "punch_skills_created_by_idx" ON "punch_skills" USING btree ("created_by");
      CREATE INDEX "punch_skills_enabled_idx" ON "punch_skills" USING btree ("created_by", "enabled");
    `
  }
];
