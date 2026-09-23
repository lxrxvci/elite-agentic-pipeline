CREATE TYPE "public"."intake_transcript_status" AS ENUM('uploaded', 'extracted', 'confirmed', 'failed');--> statement-breakpoint
CREATE TABLE "intake_transcripts" (
	"id" serial PRIMARY KEY NOT NULL,
	"intake_id" integer,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"char_count" integer NOT NULL,
	"model" text,
	"extraction" jsonb,
	"status" "intake_transcript_status" DEFAULT 'uploaded' NOT NULL,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intake_transcripts" ADD CONSTRAINT "intake_transcripts_intake_id_client_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."client_intakes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_transcripts" ADD CONSTRAINT "intake_transcripts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;