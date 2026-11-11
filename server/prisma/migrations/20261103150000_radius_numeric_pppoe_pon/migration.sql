-- New fields
ALTER TABLE "Customer" ADD COLUMN "pppoeUsername" TEXT;
ALTER TABLE "Customer" ADD COLUMN "ponId" INTEGER;

-- radiusId previously held the PPPoE/RADIUS username: keep it as the PPPoE username.
UPDATE "Customer" SET "pppoeUsername" = "radiusId" WHERE "radiusId" IS NOT NULL;

-- radiusId becomes a numeric customer ID; non-numeric values are cleared.
ALTER TABLE "Customer"
  ALTER COLUMN "radiusId" TYPE INTEGER
  USING (CASE WHEN "radiusId" ~ '^\s*\d{1,9}\s*$' THEN trim("radiusId")::INTEGER ELSE NULL END);

CREATE UNIQUE INDEX "Customer_pppoeUsername_key" ON "Customer"("pppoeUsername");
