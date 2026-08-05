CREATE TABLE evidence_bundles (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES engine_runs(id),
  candidate_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  source_discovery_id TEXT NOT NULL REFERENCES candidate_discoveries(id),
  contract_version TEXT NOT NULL CHECK (contract_version = 'artifact-evidence-bundle-v1'),
  repository_url TEXT NOT NULL,
  artifact_path TEXT NOT NULL,
  blob_sha TEXT NOT NULL CHECK (length(blob_sha) = 40),
  api_url TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source_byte_count INTEGER NOT NULL CHECK (source_byte_count BETWEEN 1 AND 131072),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  content_text TEXT NOT NULL CHECK (length(content_text) BETWEEN 1 AND 131072),
  metadata_json TEXT NOT NULL CHECK (length(metadata_json) <= 65536),
  evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, candidate_id)
);

ALTER TABLE verification_cases ADD COLUMN evidence_bundle_id TEXT
  REFERENCES evidence_bundles(id);

CREATE INDEX idx_evidence_bundles_run_candidate
  ON evidence_bundles(run_id, candidate_id);
CREATE UNIQUE INDEX idx_verification_cases_evidence_bundle
  ON verification_cases(evidence_bundle_id)
  WHERE evidence_bundle_id IS NOT NULL;
