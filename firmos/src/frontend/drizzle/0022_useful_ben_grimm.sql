CREATE TABLE "sop_videos" (
	"id" serial PRIMARY KEY NOT NULL,
	"sop_template_id" integer NOT NULL,
	"uploaded_by_id" integer,
	"title" text NOT NULL,
	"stored_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"duration_secs" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sop_videos" ADD CONSTRAINT "sop_videos_sop_template_id_sop_templates_id_fk" FOREIGN KEY ("sop_template_id") REFERENCES "public"."sop_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_videos" ADD CONSTRAINT "sop_videos_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sop_videos_sop_idx" ON "sop_videos" USING btree ("sop_template_id");