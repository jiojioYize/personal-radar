import {
  createCandidateSignal,
  validateCandidateSignal,
} from "./candidate-signals.js";
import { classifyArtifactPath } from "./source-parsers.js";

export async function resolveSourceCandidateSignals({
  task,
  signals,
  snapshots,
  completedRunCount,
  observedAt,
}) {
  if (!Number.isInteger(completedRunCount) || completedRunCount < 0) {
    throw new TypeError("completedRunCount must be a non-negative integer");
  }
  const ordered = [...(signals || [])];
  for (const signal of ordered) {
    const errors = validateCandidateSignal(signal, task);
    if (errors.length) throw new TypeError(errors.join("\n"));
  }
  const resolvedSignals = [];
  const trajectories = [];
  const seenArtifacts = new Set();
  const priorities = ["exact_artifact", "artifact_lead", "container_lead"];
  for (const kind of priorities) {
    for (const signal of ordered.filter((item) => item.signalKind === kind)) {
      if (resolvedSignals.length >= task.maxCandidateSignals) {
        trajectories.push(trajectory(signal, "not_resolved", "source_signal_budget_exhausted"));
        continue;
      }
      if (kind === "exact_artifact") {
        retainExact(signal, resolvedSignals, trajectories, seenArtifacts);
        continue;
      }
      const snapshot = snapshotFor(snapshots, signal.repositoryUrl);
      if (!snapshot) {
        trajectories.push(trajectory(signal, "unresolved", "github_tree_unavailable"));
        continue;
      }
      const artifacts = supportedArtifacts(snapshot);
      if (kind === "artifact_lead") {
        const slug = normalizeSlug(new URL(signal.locatorUrl).pathname.split("/").filter(Boolean).at(-1));
        const matches = artifacts.filter((artifact) => artifactSlugs(artifact.path).has(slug));
        if (matches.length === 0) {
          trajectories.push(trajectory(signal, "unresolved", "no_exact_slug_match"));
        } else if (matches.length > 1) {
          trajectories.push(trajectory(signal, "ambiguous", "multiple_exact_slug_matches", matches.map((item) => item.path)));
        } else {
          const generated = await resolvedSignal(task, signal, snapshot, matches[0], resolvedSignals.length + 1, observedAt);
          retainGenerated(signal, generated, resolvedSignals, trajectories, seenArtifacts, "exact_slug_match");
        }
        continue;
      }
      const rotated = rotate(artifacts, completedRunCount * task.maxCandidateSignals);
      const generatedIds = [];
      const matchedPaths = [];
      for (const artifact of rotated) {
        if (resolvedSignals.length >= task.maxCandidateSignals) break;
        const generated = await resolvedSignal(task, signal, snapshot, artifact, resolvedSignals.length + 1, observedAt);
        const key = artifactKey(generated);
        if (seenArtifacts.has(key)) continue;
        seenArtifacts.add(key);
        resolvedSignals.push(generated);
        generatedIds.push(generated.signalId);
        matchedPaths.push(generated.artifactPath);
      }
      trajectories.push(trajectory(
        signal,
        generatedIds.length ? "expanded" : "unresolved",
        generatedIds.length ? "deterministic_repository_rotation" : "no_supported_artifacts",
        matchedPaths,
        generatedIds,
      ));
    }
  }
  const result = {
    version: 1,
    taskId: task.taskId,
    resolvedSignals,
    trajectories,
    signalBudget: task.maxCandidateSignals,
    budgetExhausted: resolvedSignals.length >= task.maxCandidateSignals,
  };
  const errors = validateSourceCandidateResolution(result, task, ordered);
  if (errors.length) throw new TypeError(errors.join("\n"));
  return result;
}

export function validateSourceCandidateResolution(result, task, inputSignals) {
  const errors = [];
  const expectedKeys = [
    "budgetExhausted", "resolvedSignals", "signalBudget", "taskId",
    "trajectories", "version",
  ];
  if (!sameKeys(result, expectedKeys)) errors.push("resolution result contains unknown or missing fields");
  if (result?.version !== 1 || result?.taskId !== task?.taskId) errors.push("resolution result identity is invalid");
  if (result?.signalBudget !== task?.maxCandidateSignals) errors.push("resolution signal budget does not match task");
  if (!Array.isArray(result?.resolvedSignals)) errors.push("resolvedSignals must be an array");
  if (!Array.isArray(result?.trajectories)) errors.push("resolution trajectories must be an array");
  const resolved = Array.isArray(result?.resolvedSignals) ? result.resolvedSignals : [];
  if (resolved.length > task?.maxCandidateSignals) errors.push("resolution exceeds its source signal budget");
  if (result?.budgetExhausted !== (resolved.length >= task?.maxCandidateSignals)) {
    errors.push("resolution budgetExhausted is inconsistent");
  }
  const artifactKeys = new Set();
  const generatedIds = new Set();
  for (const signal of resolved) {
    const signalErrors = validateCandidateSignal(signal, task);
    if (signalErrors.length || signal.signalKind !== "exact_artifact") {
      errors.push("every resolved signal must be a valid exact artifact");
      continue;
    }
    const key = artifactKey(signal);
    if (artifactKeys.has(key)) errors.push("resolved artifact identities must be distinct");
    artifactKeys.add(key);
    generatedIds.add(signal.signalId);
  }
  const expectedInputIds = new Set((inputSignals || []).map((signal) => signal.signalId));
  const inputKinds = new Map((inputSignals || []).map((signal) => [signal.signalId, signal.signalKind]));
  const allowedStatuses = new Set([
    "retained", "resolved", "expanded", "unresolved", "ambiguous",
    "corroborated", "not_resolved",
  ]);
  const trajectoryIds = new Set();
  for (const item of Array.isArray(result?.trajectories) ? result.trajectories : []) {
    if (!sameKeys(item, ["generatedSignalIds", "matchedPaths", "reason", "signalId", "signalKind", "status"])) {
      errors.push("resolution trajectory contains unknown or missing fields");
      continue;
    }
    if (!expectedInputIds.has(item.signalId) || trajectoryIds.has(item.signalId)) {
      errors.push("every input signal must have exactly one resolution trajectory");
    }
    trajectoryIds.add(item.signalId);
    if (item.signalKind !== inputKinds.get(item.signalId) || !allowedStatuses.has(item.status)
      || typeof item.reason !== "string" || !item.reason) {
      errors.push("resolution trajectory identity or disposition is invalid");
    }
    if (!Array.isArray(item.matchedPaths) || !Array.isArray(item.generatedSignalIds)) {
      errors.push("resolution trajectory paths and generated IDs must be arrays");
    } else if (item.generatedSignalIds.some((id) => !generatedIds.has(id))) {
      errors.push("resolution trajectory references an unknown generated signal");
    }
  }
  if (trajectoryIds.size !== expectedInputIds.size
    || [...expectedInputIds].some((id) => !trajectoryIds.has(id))) {
    errors.push("resolution trajectories do not cover every input signal");
  }
  return errors;
}

function retainExact(signal, resolved, trajectories, seen) {
  const key = artifactKey(signal);
  if (seen.has(key)) {
    trajectories.push(trajectory(signal, "corroborated", "duplicate_exact_artifact"));
    return;
  }
  seen.add(key);
  resolved.push(signal);
  trajectories.push(trajectory(signal, "retained", "already_exact", [signal.artifactPath], [signal.signalId]));
}

function retainGenerated(lead, generated, resolved, trajectories, seen, reason) {
  const key = artifactKey(generated);
  if (seen.has(key)) {
    trajectories.push(trajectory(lead, "corroborated", "duplicate_exact_artifact", [generated.artifactPath]));
    return;
  }
  seen.add(key);
  resolved.push(generated);
  trajectories.push(trajectory(lead, "resolved", reason, [generated.artifactPath], [generated.signalId]));
}

async function resolvedSignal(task, lead, snapshot, artifact, sourceRank, observedAt) {
  const repositoryUrl = snapshot.repositoryUrl;
  const pathUrl = artifact.path.split("/").map(encodeURIComponent).join("/");
  return createCandidateSignal({
    task,
    signalKind: "exact_artifact",
    title: artifactTitle(artifact.path),
    locatorUrl: `${repositoryUrl}/blob/${encodeURIComponent(snapshot.defaultBranch)}/${pathUrl}`,
    repositoryUrl,
    artifactPath: artifact.path,
    artifactType: artifact.artifactType,
    evidenceText: `Resolved from ${lead.signalKind} ${lead.signalId} to exact GitHub tree path ${artifact.path}`,
    sourceRank,
    observedAt,
    parserVersion: "github-lead-resolver-v1",
  });
}

function supportedArtifacts(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !snapshot.repositoryUrl || !snapshot.defaultBranch) {
    throw new TypeError("GitHub tree snapshot is invalid");
  }
  return (snapshot.entries || [])
    .filter((entry) => entry?.type === "blob")
    .map((entry) => ({ ...entry, artifactType: classifyArtifactPath(entry.path) }))
    .filter((entry) => entry.artifactType)
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function snapshotFor(snapshots, repositoryUrl) {
  const snapshot = snapshots instanceof Map
    ? snapshots.get(repositoryUrl) || null
    : snapshots?.[repositoryUrl] || null;
  return snapshot?.repositoryUrl === repositoryUrl ? snapshot : null;
}

function artifactSlugs(path) {
  const parts = path.split("/");
  const filename = parts.at(-1);
  const values = new Set([normalizeSlug(filename.replace(/\.(md|mdc)$/i, ""))]);
  if (/^skill\.md$/i.test(filename) && parts.length > 1) values.add(normalizeSlug(parts.at(-2)));
  return values;
}

function normalizeSlug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function rotate(items, offset) {
  if (!items.length) return [];
  const start = offset % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

function artifactTitle(path) {
  const parts = path.split("/");
  const filename = parts.at(-1);
  return /^skill\.md$/i.test(filename) && parts.length > 1
    ? parts.at(-2).replace(/[-_]/g, " ")
    : filename.replace(/\.(instructions|agent)?\.md$|\.mdc$/gi, "").replace(/^\./, "").replace(/[-_]/g, " ");
}

function artifactKey(signal) {
  return `${signal.repositoryUrl}#artifact=${signal.artifactPath}`;
}

function trajectory(signal, status, reason, matchedPaths = [], generatedSignalIds = []) {
  return {
    signalId: signal.signalId,
    signalKind: signal.signalKind,
    status,
    reason,
    matchedPaths,
    generatedSignalIds,
  };
}

function sameKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}
