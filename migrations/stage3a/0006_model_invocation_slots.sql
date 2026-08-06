CREATE UNIQUE INDEX idx_model_invocations_case_role_attempt
  ON model_invocations(verification_case_id, role, attempt_no)
  WHERE verification_case_id IS NOT NULL;
