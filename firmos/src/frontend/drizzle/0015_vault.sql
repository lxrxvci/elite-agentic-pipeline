CREATE TABLE "client_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"account_id" integer,
	"label" text NOT NULL,
	"institution" text,
	"login_url" text,
	"username" text,
	"secret_packed" text,
	"created_by_id" integer NOT NULL,
	"created_via" text DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "credential_access_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"credential_id" integer NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_credentials" ADD CONSTRAINT "client_credentials_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_credentials" ADD CONSTRAINT "client_credentials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_credentials" ADD CONSTRAINT "client_credentials_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_access_events" ADD CONSTRAINT "credential_access_events_credential_id_client_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."client_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_access_events" ADD CONSTRAINT "credential_access_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_credentials_client_idx" ON "client_credentials" USING btree ("client_id","archived_at");--> statement-breakpoint
CREATE INDEX "client_credentials_account_idx" ON "client_credentials" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "credential_access_events_credential_idx" ON "credential_access_events" USING btree ("credential_id","created_at");--> statement-breakpoint
CREATE INDEX "credential_access_events_user_idx" ON "credential_access_events" USING btree ("user_id","action","created_at");