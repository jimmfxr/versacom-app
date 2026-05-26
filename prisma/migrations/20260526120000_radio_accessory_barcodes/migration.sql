-- Optional barcodes for each accessory paired with a radio. Captured
-- by the radio scanner when the operator toggles a chip ON in the
-- assignment modal (a sub-prompt asks for the accessory's barcode).
-- All nullable so existing radios stay unaffected.
ALTER TABLE "Radio" ADD COLUMN "fistMicBarcode" TEXT;
ALTER TABLE "Radio" ADD COLUMN "surveillanceBarcode" TEXT;
ALTER TABLE "Radio" ADD COLUMN "doubleMuffBarcode" TEXT;
ALTER TABLE "Radio" ADD COLUMN "lightweightBarcode" TEXT;
