CREATE TABLE candidate_resolution_batches (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES engine_runs(id),
  task_id TEXT NOT NULL,
  source_fetch_id TEXT NOT NULL REFERENCES source_fetches(id),
  filter_pass INTEGER NOT NULL CHECK (filter_pass BETWEEN 1 AND 3),
  contract_version TEXT NOT NULL CHECK (contract_version = 'candidate-resolution-v1'),
  input_signal_count INTEGER NOT NULL CHECK (input_signal_count BETWEEN 0 AND 4),
  resolved_signal_count INTEGER NOT NULL CHECK (resolved_signal_count BETWEEN 0 AND 4),
  unresolved_signal_count INTEGER NOT NULL CHECK (unresolved_signal_count BETWEEN 0 AND 4),
  signal_budget INTEGER NOT NULL CHECK (signal_budget BETWEEN 1 AND 4),
  budget_exhausted INTEGER NOT NULL CHECK (budget_exhausted IN (0, 1)),
  resolution_hash TEXT NOT NULL CHECK (length(resolution_hash) = 64),
  result_json TEXT NOT NULL CHECK (length(result_json) <= 262144),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, task_id, filter_pass)
);

CREATE TABLE candidate_resolution_trajectories (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES candidate_resolution_batches(id),
  run_id TEXT NOT NULL REFERENCES engine_runs(id),
  input_signal_id TEXT NOT NULL,
  signal_kind TEXT NOT NULL CHECK (signal_kind IN (
    'exact_artifact', 'artifact_lead', 'container_lead'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'retained', 'resolved', 'expanded', 'unresolved', 'ambiguous',
    'corroborated', 'not_resolved'
  )),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 200),
  matched_paths_json TEXT NOT NULL CHECK (length(matched_paths_json) <= 65536),
  generated_signal_ids_json TEXT NOT NULL CHECK (length(generated_signal_ids_json) <= 65536),
  trajectory_hash TEXT NOT NULL CHECK (length(trajectory_hash) = 64),
  created_at TEXT NOT NULL,
  UNIQUE (batch_id, input_signal_id)
);

CREATE TABLE candidate_discoveries (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES candidate_resolution_batches(id),
  run_id TEXT NOT NULL REFERENCES engine_runs(id),
  candidate_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  exact_signal_id TEXT NOT NULL,
  lane TEXT NOT NULL CHECK (lane IN ('registryPulse', 'officialRotation', 'communityTrend')),
  source_id TEXT NOT NULL,
  source_rank INTEGER CHECK (source_rank IS NULL OR source_rank BETWEEN 1 AND 10000),
  candidate_snapshot_json TEXT NOT NULL CHECK (length(candidate_snapshot_json) <= 65536),
  evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
  created_at TEXT NOT NULL,
  UNIQUE (batch_id, exact_signal_id)
);

CREATE INDEX idx_resolution_batches_run_pass
  ON candidate_resolution_batches(run_id, filter_pass, task_id);
CREATE INDEX idx_resolution_batches_source_fetch
  ON candidate_resolution_batches(source_fetch_id);
CREATE INDEX idx_resolution_trajectories_run_status
  ON candidate_resolution_trajectories(run_id, status);
CREATE INDEX idx_candidate_discoveries_run_candidate
  ON candidate_discoveries(run_id, candidate_id);
