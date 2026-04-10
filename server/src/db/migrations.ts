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
  }
];
