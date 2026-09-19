CREATE TYPE "public"."association_relation_type" AS ENUM('contains_stop', 'same_service', 'duplicate', 'correction');--> statement-breakpoint
CREATE TYPE "public"."association_status" AS ENUM('pending', 'confirmed', 'rejected', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."journey_data_status" AS ENUM('active', 'uncertain', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."journey_claim_status" AS ENUM('active', 'disputed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."journey_claim_type" AS ENUM('route_active', 'route_inactive', 'pickup_point', 'operator', 'price', 'schedule', 'stop');--> statement-breakpoint
CREATE TYPE "public"."contribution_status" AS ENUM('published', 'needs_confirmation', 'superseded');--> statement-breakpoint
CREATE TABLE "auth_deletion_jobs" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"display_name" varchar,
	"last_name_change" timestamp with time zone,
	"terms_accepted_version" varchar(64),
	"terms_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "journey_stops" (
	"id" serial PRIMARY KEY NOT NULL,
	"journey_id" integer NOT NULL,
	"city" text NOT NULL,
	"arrival_time" text,
	"departure_time" text,
	"sequence" integer DEFAULT 0 NOT NULL,
	"source_association_id" integer
);
--> statement-breakpoint
CREATE TABLE "journeys" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_city" text NOT NULL,
	"to_city" text NOT NULL,
	"departure_time" text NOT NULL,
	"arrival_time" text NOT NULL,
	"travel_date" text NOT NULL,
	"bus_company" text NOT NULL,
	"pickup_point" text NOT NULL,
	"dropoff_point" text NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"contributed_by" varchar,
	"contributor_name" text DEFAULT 'Anonymous' NOT NULL,
	"moderation_status" text DEFAULT 'visible' NOT NULL,
	"data_status" "journey_data_status" DEFAULT 'active' NOT NULL,
	"confidence_score" integer DEFAULT 50 NOT NULL,
	"confirmation_count" integer DEFAULT 0 NOT NULL,
	"last_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposed_associations" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_journey_id" integer NOT NULL,
	"parent_journey_id" integer NOT NULL,
	"proposed_stop_city" text NOT NULL,
	"proposed_stop_time" text,
	"relation_type" "association_relation_type" DEFAULT 'contains_stop' NOT NULL,
	"confidence_score" integer DEFAULT 50 NOT NULL,
	"evidence" jsonb,
	"status" "association_status" DEFAULT 'pending' NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" varchar
);
--> statement-breakpoint
CREATE TABLE "journey_ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"journey_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"score" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journey_ratings_user_journey_unique" UNIQUE("user_id","journey_id")
);
--> statement-breakpoint
CREATE TABLE "search_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_city" text,
	"to_city" text,
	"day" text,
	"results_count" integer NOT NULL,
	"user_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journey_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"journey_id" integer NOT NULL,
	"user_id" varchar,
	"type" text NOT NULL,
	"content" text,
	"minutes_late" integer,
	"reported_price" numeric(10, 2),
	"moderation_status" text DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journey_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"journey_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"type" "journey_claim_type" NOT NULL,
	"value" jsonb NOT NULL,
	"status" "journey_claim_status" DEFAULT 'active' NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journey_claim_user_type_unique" UNIQUE("journey_id","user_id","type")
);
--> statement-breakpoint
CREATE TABLE "journey_contributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"journey_id" integer NOT NULL,
	"contributor_id" varchar NOT NULL,
	"payload" jsonb NOT NULL,
	"source" text DEFAULT 'community' NOT NULL,
	"status" "contribution_status" DEFAULT 'published' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"place_type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bus_companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bus_companies_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "abuse_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"reporter_id" varchar,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"journey_id" integer,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"moderator_notes" text,
	"reviewed_by" varchar,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journey_stops" ADD CONSTRAINT "journey_stops_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_contributed_by_users_id_fk" FOREIGN KEY ("contributed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposed_associations" ADD CONSTRAINT "proposed_associations_candidate_journey_id_journeys_id_fk" FOREIGN KEY ("candidate_journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposed_associations" ADD CONSTRAINT "proposed_associations_parent_journey_id_journeys_id_fk" FOREIGN KEY ("parent_journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposed_associations" ADD CONSTRAINT "proposed_associations_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_ratings" ADD CONSTRAINT "journey_ratings_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_ratings" ADD CONSTRAINT "journey_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_events" ADD CONSTRAINT "search_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_reports" ADD CONSTRAINT "journey_reports_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_reports" ADD CONSTRAINT "journey_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_claims" ADD CONSTRAINT "journey_claims_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_claims" ADD CONSTRAINT "journey_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_contributions" ADD CONSTRAINT "journey_contributions_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_contributions" ADD CONSTRAINT "journey_contributions_contributor_id_users_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");

-- All application data is accessed through the authenticated API, never PostgREST.
ALTER TABLE public."auth_deletion_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."journey_stops" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."journeys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."proposed_associations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."journey_ratings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."search_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."journey_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."journey_claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."journey_contributions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."cities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."bus_companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."abuse_reports" ENABLE ROW LEVEL SECURITY;
