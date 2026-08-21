CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN (
    'office.to.pdf',
    'spreadsheet.to.csv',
    'structured.convert',
    'ocr.pdf',
    'ocr.image',
    'image.convert.hq',
    'pdf.repair',
    'pdf.text-to-docx',
    'bid.assemble'
  )),
  input_format TEXT NOT NULL CHECK (length(input_format) BETWEEN 1 AND 32),
  output_format TEXT NOT NULL CHECK (length(output_format) BETWEEN 1 AND 32),
  quality TEXT NOT NULL CHECK (
    quality = CASE operation
      WHEN 'image.convert.hq' THEN 'A'
      WHEN 'pdf.text-to-docx' THEN 'C'
      ELSE 'B'
    END
  ),
  status TEXT NOT NULL CHECK (status IN (
    'queued',
    'running',
    'succeeded',
    'failed',
    'cancelling',
    'cancelled'
  )),
  input_bytes INTEGER NOT NULL CHECK (input_bytes > 0 AND input_bytes <= 54525952),
  page_count INTEGER CHECK (page_count BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  started_at INTEGER CHECK (started_at >= created_at),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  queue_position INTEGER CHECK (queue_position IN (0, 1)),
  progress_phase TEXT CHECK (progress_phase IN ('admission', 'queued', 'converting', 'finalizing')),
  progress_completed INTEGER CHECK (progress_completed >= 0),
  progress_total INTEGER CHECK (progress_total > 0),
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
  error_code TEXT CHECK (error_code IN (
    'AUTH_REQUIRED',
    'ORIGIN_REJECTED',
    'PROCESSING_CONSENT_REQUIRED',
    'INVALID_REQUEST',
    'UNSUPPORTED_OPERATION',
    'UNSUPPORTED_FORMAT',
    'FILE_TOO_LARGE',
    'PAGE_LIMIT_EXCEEDED',
    'ENCRYPTED_INPUT',
    'MALWARE_DETECTED',
    'JOB_ALREADY_ACTIVE',
    'QUEUE_FULL',
    'DAILY_QUOTA_EXCEEDED',
    'IDEMPOTENCY_CONFLICT',
    'JOB_NOT_READY',
    'SCANNER_UNAVAILABLE',
    'CONVERSION_TIMEOUT',
    'CONVERSION_FAILED'
  )),
  error_retryable INTEGER CHECK (error_retryable IN (0, 1)),
  result_media_type TEXT CHECK (length(result_media_type) BETWEEN 1 AND 100),
  result_bytes INTEGER CHECK (result_bytes >= 0),
  CHECK (
    (progress_phase IS NULL AND progress_completed IS NULL AND progress_total IS NULL)
    OR (
      progress_phase IS NOT NULL
      AND progress_completed IS NOT NULL
      AND progress_total IS NOT NULL
      AND progress_completed <= progress_total
      AND (
        (status = 'queued' AND progress_phase IN ('admission', 'queued'))
        OR (status = 'running' AND progress_phase IN ('converting', 'finalizing'))
        OR (status = 'cancelling' AND progress_phase IN ('queued', 'converting', 'finalizing'))
      )
    )
  ),
  CHECK (
    (status = 'succeeded' AND result_media_type IS NOT NULL AND result_bytes IS NOT NULL)
    OR (status <> 'succeeded' AND result_media_type IS NULL AND result_bytes IS NULL)
  ),
  CHECK (
    (status = 'failed' AND error_code IS NOT NULL AND error_retryable IS NOT NULL)
    OR (status <> 'failed' AND error_code IS NULL AND error_retryable IS NULL)
  ),
  CHECK (
    result_media_type IS NULL
    OR CASE operation
      WHEN 'office.to.pdf' THEN result_media_type = 'application/pdf'
      WHEN 'spreadsheet.to.csv' THEN result_media_type = 'text/csv'
      WHEN 'structured.convert' THEN result_media_type IN (
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.oasis.opendocument.text',
        'application/rtf',
        'text/html',
        'text/markdown'
      )
      WHEN 'ocr.pdf' THEN result_media_type IN ('application/pdf', 'text/plain')
      WHEN 'ocr.image' THEN result_media_type IN ('application/pdf', 'text/plain')
      WHEN 'image.convert.hq' THEN result_media_type IN (
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/avif'
      )
      WHEN 'pdf.repair' THEN result_media_type = 'application/pdf'
      WHEN 'pdf.text-to-docx' THEN result_media_type =
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      WHEN 'bid.assemble' THEN result_media_type IN (
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
      ELSE 0
    END
  )
) STRICT;

CREATE INDEX IF NOT EXISTS jobs_owner_status ON jobs (owner_id, status);
CREATE INDEX IF NOT EXISTS jobs_expires ON jobs (expires_at);

CREATE TABLE IF NOT EXISTS daily_usage (
  owner_id TEXT NOT NULL,
  utc_day TEXT NOT NULL CHECK (utc_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  accepted_count INTEGER NOT NULL CHECK (accepted_count BETWEEN 0 AND 10),
  PRIMARY KEY (owner_id, utc_day)
) STRICT;

CREATE TABLE IF NOT EXISTS idempotency (
  owner_id TEXT NOT NULL,
  key_hmac TEXT NOT NULL CHECK (length(key_hmac) = 43),
  operation TEXT NOT NULL CHECK (operation IN (
    'office.to.pdf',
    'spreadsheet.to.csv',
    'structured.convert',
    'ocr.pdf',
    'ocr.image',
    'image.convert.hq',
    'pdf.repair',
    'pdf.text-to-docx',
    'bid.assemble'
  )),
  input_format TEXT NOT NULL CHECK (length(input_format) BETWEEN 1 AND 32),
  output_format TEXT NOT NULL CHECK (length(output_format) BETWEEN 1 AND 32),
  input_bytes INTEGER NOT NULL CHECK (input_bytes > 0 AND input_bytes <= 54525952),
  job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL CHECK (expires_at >= 0),
  PRIMARY KEY (owner_id, key_hmac)
) STRICT;

CREATE INDEX IF NOT EXISTS idempotency_expires ON idempotency (expires_at);
