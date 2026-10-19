ALTER TABLE bookmarks ADD COLUMN pin_order INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_bookmarks_pin_order ON bookmarks(user_id, is_pinned, pin_order);
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0105');
