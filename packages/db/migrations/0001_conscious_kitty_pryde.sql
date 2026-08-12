CREATE TABLE "domain_stats" (
	"domain" text NOT NULL,
	"provider" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_len" integer NOT NULL,
	"successes" integer DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"latency_hist" integer[] DEFAULT '{}' NOT NULL,
	"cost_micro_sum" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"created_by" text,
	"key_hash" text NOT NULL,
	"name" text NOT NULL,
	"environment" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "provider_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"provider" text NOT NULL,
	"ciphertext" text NOT NULL,
	"label" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "gateway_keys" ADD CONSTRAINT "gateway_keys_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_keys" ADD CONSTRAINT "gateway_keys_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_keys" ADD CONSTRAINT "provider_keys_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "domain_stats_key_idx" ON "domain_stats" USING btree ("domain","provider","window_start","window_len");--> statement-breakpoint
CREATE INDEX "domain_stats_window_idx" ON "domain_stats" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_keys_hash_idx" ON "gateway_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "gateway_keys_org_idx" ON "gateway_keys" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_keys_org_provider_idx" ON "provider_keys" USING btree ("org_id","provider","label");