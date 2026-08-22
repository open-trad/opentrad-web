ALTER TABLE idempotency ADD COLUMN request_shape TEXT NOT NULL DEFAULT '{}'
  CHECK (length(request_shape) BETWEEN 2 AND 4096);

ALTER TABLE jobs ADD COLUMN result_claim_token TEXT
  CHECK (result_claim_token IS NULL OR length(result_claim_token) = 36);

ALTER TABLE jobs ADD COLUMN result_claimed_at INTEGER
  CHECK (result_claimed_at IS NULL OR result_claimed_at >= created_at);

ALTER TABLE jobs ADD COLUMN result_consumed INTEGER NOT NULL DEFAULT 0
  CHECK (result_consumed IN (0, 1));

CREATE INDEX IF NOT EXISTS jobs_result_claim ON jobs (result_claim_token)
  WHERE result_claim_token IS NOT NULL;
