-- 0049 added issue_relations_type_check outside the Drizzle schema, so the
-- snapshot never carried it and `generate` emits only the ADD below. Drop the
-- stale ('blocks') constraint first or this migration fails on every database
-- that already ran 0049.
ALTER TABLE "issue_relations" DROP CONSTRAINT IF EXISTS "issue_relations_type_check";--> statement-breakpoint
ALTER TABLE "issue_relations" ADD CONSTRAINT "issue_relations_type_check" CHECK ("issue_relations"."type" in ('blocks', 'transfer'));
