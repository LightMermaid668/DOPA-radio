CREATE TYPE "public"."pitch_variant_status" AS ENUM('processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "track_pitch_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"semitones" integer NOT NULL,
	"status" "pitch_variant_status" DEFAULT 'processing' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "track_pitch_variants" ADD CONSTRAINT "track_pitch_variants_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "track_pitch_variants_unique" ON "track_pitch_variants" USING btree ("track_id","semitones");