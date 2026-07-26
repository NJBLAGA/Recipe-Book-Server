ALTER TABLE pantry_item ADD COLUMN stock_status text NOT NULL DEFAULT 'in_stock';

UPDATE pantry_item SET stock_status = 'out_of_stock' WHERE in_stock = false;

ALTER TABLE pantry_item DROP COLUMN in_stock;

ALTER TABLE pantry_item ADD CONSTRAINT pantry_item_stock_status_check
  CHECK (stock_status IN ('in_stock', 'low_stock', 'out_of_stock'));
