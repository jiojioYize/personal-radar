CREATE TABLE candidate_pool_passes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES engine_runs(id),
  filter_pass INTEGER NOT NULL CHECK (filter_pass BETWEEN 1 AND 3),
  contract_version TEXT NOT NULL CHECK (contract_version = 'candidate-pool-v1'),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
  result_hash TEXT NOT NULL CHECK (length(result_hash) = 64),
  result_json TEXT NOT NULL CHECK (length(result_json) <= 262144),
  selected_count INTEGER NOT NULL CHECK (selected_count BETWEEN 0 AND 20),
  eligible_total INTEGER NOT NULL CHECK (eligible_total BETWEEN 0 AND 20),
  cumulative_total INTEGER NOT NULL CHECK (cumulative_total BETWEEN 0 AND 20),
  next_action TEXT NOT NULL CHECK (next_action IN (
    'verify', 'replenish', 'verify_below_target'
  )),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, filter_pass)
);

CREATE TABLE candidate_filter_events (
  id TEXT PRIMARY KEY,
  pool_pass_id TEXT NOT NULL REFERENCES candidate_pool_passes(id),
  run_id TEXT NOT NULL REFERENCES engine_runs(id),
  candidate_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  disposition TEXT NOT NULL CHECK (disposition IN (
    'eligible', 'filtered_history', 'duplicate_existing',
    'deferred_initial_limit', 'deferred_candidate_limit', 'deferred_target_met'
  )),
  exclusion_reason TEXT,
  primary_discovery_id TEXT NOT NULL REFERENCES candidate_discoveries(id),
  corroborating_discovery_ids_json TEXT NOT NULL
    CHECK (length(corroborating_discovery_ids_json) <= 65536),
  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64),
  created_at TEXT NOT NULL,
  UNIQUE (pool_pass_id, candidate_id)
);

CREATE INDEX idx_candidate_pool_passes_run_pass
  ON candidate_pool_passes(run_id, filter_pass);
CREATE INDEX idx_candidate_filter_events_run_disposition
  ON candidate_filter_events(run_id, disposition);
