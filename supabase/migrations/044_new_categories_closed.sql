BEGIN;
-- Creating a category is not authorization to launch it publicly.
ALTER TABLE app_categories ALTER COLUMN release_mode SET DEFAULT 'closed';
ALTER TABLE app_categories ALTER COLUMN is_active SET DEFAULT false;
COMMIT;
