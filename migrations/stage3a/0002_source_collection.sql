ALTER TABLE engine_runs ADD COLUMN source_collection_status TEXT
  CHECK (source_collection_status IN ('complete', 'degraded', 'source_incomplete'));

ALTER TABLE source_fetches ADD COLUMN task_id TEXT;
ALTER TABLE source_fetches ADD COLUMN attempt_no INTEGER
  CHECK (attempt_no IS NULL OR attempt_no >= 1);
ALTER TABLE source_fetches ADD COLUMN fetch_status TEXT
  CHECK (fetch_status IN ('succeeded', 'failed', 'degraded_cached'));
ALTER TABLE source_fetches ADD COLUMN cache_status TEXT
  CHECK (cache_status IN ('none', 'fresh', 'validated_304', 'stale_fallback'));
ALTER TABLE source_fetches ADD COLUMN retryable INTEGER
  CHECK (retryable IN (0, 1));
ALTER TABLE source_fetches ADD COLUMN result_hash TEXT;
ALTER TABLE source_fetches ADD COLUMN candidate_signals_json TEXT;

CREATE UNIQUE INDEX idx_source_fetches_run_task_attempt
  ON source_fetches(run_id, task_id, attempt_no);
CREATE INDEX idx_source_fetches_run_status
  ON source_fetches(run_id, fetch_status);
