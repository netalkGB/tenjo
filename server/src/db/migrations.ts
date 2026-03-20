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
  }
];
