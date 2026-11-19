CREATE TABLE "intake_contact_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"intake_id" integer NOT NULL,
	"contact_id" integer NOT NULL,
	"role" text NOT NULL,
	"source" text DEFAULT 'intake' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intake_contact_links" ADD CONSTRAINT "intake_contact_links_intake_id_client_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."client_intakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_contact_links" ADD CONSTRAINT "intake_contact_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "intake_contact_links_unique" ON "intake_contact_links" USING btree ("intake_id","contact_id","role");--> statement-breakpoint
CREATE INDEX "intake_contact_links_contact_idx" ON "intake_contact_links" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "intake_contact_links_intake_idx" ON "intake_contact_links" USING btree ("intake_id");