-- Package speed replaces package name. Backfill missing speeds from the old name first.
UPDATE "Customer" SET "packageSpeed" = "packageName" WHERE "packageSpeed" IS NULL OR btrim("packageSpeed") = '';
ALTER TABLE "Customer" ALTER COLUMN "packageSpeed" SET NOT NULL;
ALTER TABLE "Customer" DROP COLUMN "packageName";
