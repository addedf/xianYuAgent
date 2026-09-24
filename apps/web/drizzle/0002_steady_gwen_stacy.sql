CREATE UNIQUE INDEX "assessments_listing_input_unique" ON "assessments" USING btree ("listing_id","input_fingerprint");
