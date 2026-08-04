PRAGMA foreign_keys = ON;

CREATE TABLE engine_runs (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  report_date TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode = 'shadow'),
  contract_version TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  model_policy_hash TEXT NOT NULL,
  source_policy_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'scheduled', 'claimed', 'collecting', 'filtering', 'verifying',
    'editing', 'validating', 'shadow_ready', 'comparing', 'compared',
    'valid_no_update', 'failed_retry_exhausted', 'failed_contract',
    'failed_source_system', 'failed_model_provider', 'failed_budget',
    'cancelled_operator'
  )),
  content_outcome TEXT CHECK (content_outcome IN ('published', 'no_update')),
  coverage_status TEXT CHECK (coverage_status IN (
    'target_met', 'exhausted_below_target', 'source_incomplete'
  )),
  publication_state TEXT NOT NULL DEFAULT 'blocked_shadow'
    CHECK (publication_state = 'blocked_shadow'),
  budget_soft_usd_micros INTEGER NOT NULL CHECK (budget_soft_usd_micros >= 0),
  budget_hard_usd_micros INTEGER NOT NULL CHECK (
    budget_hard_usd_micros >= budget_soft_usd_micros
  ),
  candidate_total INTEGER NOT NULL DEFAULT 0 CHECK (candidate_total BETWEEN 0 AND 20),
  eligible_total INTEGER NOT NULL DEFAULT 0 CHECK (eligible_total BETWEEN 0 AND 20),
  search_call_total INTEGER NOT NULL DEFAULT 0 CHECK (search_call_total >= 0),
  input_token_total INTEGER NOT NULL DEFAULT 0 CHECK (input_token_total >= 0),
  output_token_total INTEGER NOT NULL DEFAULT 0 CHECK (output_token_total >= 0),
  estimated_cost_usd_micros INTEGER NOT NULL DEFAULT 0
    CHECK (estimated_cost_usd_micros >= 0),
  failure_class TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (channel, report_date, mode, contract_version)
);

CREATE TABLE workflow_attempts (
  workflow_instance_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES engine_runs(id),
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
  status TEXT NOT NULL CHECK (status IN ('claimed', 'running', 'completed', 'failed', 'superseded')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (run_id, attempt_no)
);

CREATE TABLE source_plans (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES engine_runs(id),
  plan_version TEXT NOT NULL,
  registry_focus TEXT NOT NULL,
  assigned_sources_json TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE source_rotation_entries (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES engine_runs(id),
  lane TEXT NOT NULL,
  source_id TEXT NOT NULL,
  rotation_position INTEGER NOT NULL CHECK (rotation_position >= 0),
  completed_report_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, lane, source_id)
);

CREATE TABLE source_fetches (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES engine_runs(id),
  request_key TEXT NOT NULL UNIQUE,
  normalized_url TEXT NOT NULL,
  purpose TEXT NOT NULL,
  provenance_class TEXT NOT NULL,
  request_policy_json TEXT NOT NULL,
  http_status INTEGER CHECK (http_status BETWEEN 100 AND 599),
  redirect_target TEXT,
  etag TEXT,
  last_modified TEXT,
  fetched_at TEXT,
  content_hash TEXT,
  bounded_excerpt TEXT CHECK (bounded_excerpt IS NULL OR length(bounded_excerpt) <= 32768),
  error_class TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  artifact_key TEXT NOT NULL UNIQUE,
  canonical_repository_url TEXT NOT NULL,
  artifact_path TEXT,
  artifact_type TEXT NOT NULL,
  container_type TEXT NOT NULL,
  provenance TEXT NOT NULL,
  predecessor_artifact_id TEXT REFERENCES artifacts(id),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE run_candidates (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES engine_runs(id),
  candidate_id TEXT NOT NULL,
  artifact_id TEXT REFERENCES artifacts(id),
  lane TEXT NOT NULL,
  source_id TEXT NOT NULL,
  filter_pass INTEGER NOT NULL CHECK (filter_pass BETWEEN 1 AND 3),
  snapshot_json TEXT NOT NULL,
  eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
  exclusion_reason TEXT,
  material_change_json TEXT,
  final_disposition TEXT NOT NULL CHECK (final_disposition IN (
    'pending', 'eligible', 'filtered', 'removed_verification', 'decided'
  )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id, candidate_id)
);

CREATE TABLE verification_cases (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES engine_runs(id),
  candidate_id TEXT NOT NULL,
  original_identity_json TEXT NOT NULL,
  current_identity_json TEXT,
  specialist_required INTEGER NOT NULL DEFAULT 0 CHECK (specialist_required IN (0, 1)),
  adjudication_required INTEGER NOT NULL DEFAULT 0 CHECK (adjudication_required IN (0, 1)),
  disagreement_fields_json TEXT NOT NULL DEFAULT '[]',
  disposition TEXT NOT NULL CHECK (disposition IN ('pending', 'retained', 'removed')),
  removal_reason TEXT,
  requires_followup INTEGER NOT NULL DEFAULT 0 CHECK (requires_followup IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id, candidate_id)
);

CREATE TABLE model_invocations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES engine_runs(id),
  verification_case_id TEXT REFERENCES verification_cases(id),
  candidate_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('primary', 'specialist', 'adjudicator', 'editor', 'repair')),
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
  request_hash TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  model_policy TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'sent', 'completed', 'invalid', 'failed', 'ambiguous')),
  provider_request_id TEXT,
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  search_calls INTEGER NOT NULL DEFAULT 0 CHECK (search_calls >= 0),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  estimated_cost_usd_micros INTEGER CHECK (
    estimated_cost_usd_micros IS NULL OR estimated_cost_usd_micros >= 0
  ),
  ambiguous_delivery INTEGER NOT NULL DEFAULT 0 CHECK (ambiguous_delivery IN (0, 1)),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE verification_outputs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES verification_cases(id),
  invocation_id TEXT NOT NULL UNIQUE REFERENCES model_invocations(id),
  role TEXT NOT NULL CHECK (role IN ('primary', 'specialist', 'adjudicator')),
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
  prompt_version TEXT NOT NULL,
  model_policy TEXT NOT NULL,
  response_hash TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (length(evidence_json) <= 262144),
  semantic_valid INTEGER NOT NULL CHECK (semantic_valid IN (0, 1)),
  validation_errors_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE (case_id, role, attempt_no)
);

CREATE TABLE quality_decisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES engine_runs(id),
  candidate_id TEXT NOT NULL,
  editor_invocation_id TEXT REFERENCES model_invocations(id),
  decision TEXT NOT NULL CHECK (decision IN ('recommend', 'defer', 'reject')),
  reason TEXT NOT NULL,
  preference_effect TEXT NOT NULL CHECK (preference_effect IN ('boosted', 'neutral', 'deprioritized')),
  matched_feedback_ids_json TEXT NOT NULL DEFAULT '[]',
  deterministic_valid INTEGER NOT NULL CHECK (deterministic_valid IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, candidate_id)
);

CREATE TABLE report_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES engine_runs(id),
  format TEXT NOT NULL CHECK (format IN ('engine_shadow_v1', 'public_v3', 'markdown')),
  body TEXT NOT NULL CHECK (length(body) <= 1048576),
  content_hash TEXT NOT NULL,
  schema_version TEXT,
  reader_contract_version INTEGER,
  coverage_status TEXT NOT NULL CHECK (coverage_status IN (
    'target_met', 'exhausted_below_target', 'source_incomplete'
  )),
  content_status TEXT CHECK (content_status IN ('published', 'no_update')),
  publication_state TEXT NOT NULL CHECK (publication_state = 'blocked_shadow'),
  validated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, format)
);

CREATE TABLE artifact_history (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  run_id TEXT REFERENCES engine_runs(id),
  report_date TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('recommended', 'seeded_production')),
  seed_origin TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (artifact_id, report_date, outcome)
);

CREATE TABLE review_state (
  artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id),
  latest_decision TEXT NOT NULL CHECK (latest_decision IN ('defer', 'reject')),
  decided_at TEXT NOT NULL,
  review_after TEXT NOT NULL,
  source_run_id TEXT NOT NULL REFERENCES engine_runs(id),
  reason TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE preference_signals (
  id TEXT PRIMARY KEY,
  external_signal_id TEXT NOT NULL UNIQUE,
  artifact_id TEXT REFERENCES artifacts(id),
  signal TEXT NOT NULL CHECK (signal IN ('interested', 'not_interested')),
  sanitized_payload_json TEXT NOT NULL,
  import_provenance TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE production_baselines (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  report_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('published', 'no_update', 'missing', 'failed')),
  selected_items_json TEXT NOT NULL,
  source_hash TEXT NOT NULL UNIQUE,
  captured_at TEXT NOT NULL,
  UNIQUE (channel, report_date)
);

CREATE TABLE shadow_comparisons (
  id TEXT PRIMARY KEY,
  shadow_run_id TEXT NOT NULL REFERENCES engine_runs(id),
  production_baseline_id TEXT NOT NULL REFERENCES production_baselines(id),
  production_baseline_hash TEXT NOT NULL,
  comparison_version TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  findings_json TEXT NOT NULL,
  reviewer_conclusion TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (shadow_run_id, production_baseline_hash, comparison_version)
);

CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES engine_runs(id),
  failure_class TEXT NOT NULL,
  scope TEXT NOT NULL,
  retryable INTEGER NOT NULL CHECK (retryable IN (0, 1)),
  affected_step TEXT,
  candidate_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'accepted')),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  first_occurred_at TEXT NOT NULL,
  last_occurred_at TEXT NOT NULL,
  resolution TEXT,
  no_backfill INTEGER NOT NULL DEFAULT 1 CHECK (no_backfill = 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_engine_runs_date_status
  ON engine_runs(report_date, status);
CREATE INDEX idx_workflow_attempts_run_status
  ON workflow_attempts(run_id, status);
CREATE INDEX idx_source_rotation_lane_date
  ON source_rotation_entries(lane, completed_report_date);
CREATE INDEX idx_source_fetches_run_url
  ON source_fetches(run_id, normalized_url);
CREATE INDEX idx_artifacts_repository_seen
  ON artifacts(canonical_repository_url, last_seen_at);
CREATE INDEX idx_run_candidates_run_disposition
  ON run_candidates(run_id, final_disposition);
CREATE INDEX idx_verification_cases_run_disposition
  ON verification_cases(run_id, disposition);
CREATE INDEX idx_model_invocations_run_role
  ON model_invocations(run_id, role, status);
CREATE INDEX idx_quality_decisions_run_decision
  ON quality_decisions(run_id, decision);
CREATE INDEX idx_artifact_history_artifact_date
  ON artifact_history(artifact_id, report_date);
CREATE INDEX idx_review_state_review_after
  ON review_state(review_after);
CREATE INDEX idx_report_artifacts_run_format
  ON report_artifacts(run_id, format);
CREATE INDEX idx_incidents_status_last
  ON incidents(status, last_occurred_at);
