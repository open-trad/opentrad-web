ALTER TABLE jobs ADD COLUMN cleanup_kind TEXT
  CHECK (cleanup_kind IS NULL OR cleanup_kind IN ('expiry', 'cancel', 'consume'));

ALTER TABLE jobs ADD COLUMN cleanup_token TEXT
  CHECK (cleanup_token IS NULL OR length(cleanup_token) = 36);

ALTER TABLE jobs ADD COLUMN cleanup_claimed_at INTEGER
  CHECK (cleanup_claimed_at IS NULL OR cleanup_claimed_at >= created_at);

CREATE INDEX IF NOT EXISTS jobs_cleanup_pending
  ON jobs (cleanup_kind, cleanup_claimed_at)
  WHERE cleanup_kind IS NOT NULL;
