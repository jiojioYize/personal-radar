export function curatedFixture() {
  const base = {
    category: "coding workflow",
    artifactScope: "general_skill_collection",
    discovery: { type: "agent-plugins", url: "https://github.com/dmgrok/agent-plugins" },
    officialSourceVerified: true,
    sourceCheckedAt: "2026-07-14T01:00:00.000Z",
    license: "MIT",
  };
  const decisions = [
    {
      ...base,
      title: "Example Skill",
      sourceUrl: "https://github.com/example/skills/tree/main/skills/example",
      artifactPath: "skills/example",
      decision: "recommend",
      reason: "A concrete and portable workflow.",
      display: displayFixture(),
    },
    deferDecision(base, "Defer One", "defer-one", "awesome-claude-skills"),
    deferDecision(base, "Defer Two", "defer-two", "open-agent-skill"),
    rejectDecision(base, "Reject One", "reject-one", "agent-plugins"),
    rejectDecision(base, "Reject Two", "reject-two", "agent-plugins"),
    rejectDecision(base, "Reject Three", "reject-three", "awesome-claude-skills"),
    rejectDecision(base, "Reject Four", "reject-four", "awesome-claude-skills"),
    rejectDecision(base, "Reject Five", "reject-five", "open-agent-skill"),
  ];
  return {
    reportDate: "2026-07-14",
    summary: { zh: "Today's simplified test.", en: "Today's simplified test." },
    conclusion: { zh: "Only verified items are recommended.", en: "Only verified items are recommended." },
    candidateCount: 8,
    duplicateCount: 1,
    sourceCounts: { awesomeClaudeSkills: 3, agentPlugins: 3, openAgentSkill: 2 },
    decisions,
  };
}

function deferDecision(base, title, slug, type) {
  return {
    ...base,
    title,
    sourceUrl: `https://github.com/example/${slug}`,
    artifactScope: "individual_skill",
    artifactPath: null,
    discovery: { type, url: "https://example.com/directory" },
    decision: "defer",
    reason: "Useful but needs more maintenance evidence.",
  };
}

function rejectDecision(base, title, slug, type) {
  return {
    ...base,
    title,
    sourceUrl: `https://github.com/example/${slug}`,
    artifactScope: "individual_skill",
    artifactPath: null,
    discovery: { type, url: "https://example.com/directory" },
    decision: "reject",
    reason: "Not sufficiently reusable.",
  };
}

function displayFixture() {
  const display = {
    oneLiner: "Helps turn a repeated task into a reusable workflow.",
    whyNow: "The source is active.",
    bestFor: "Useful when the same agent-assisted review steps need to be applied consistently.",
    action: "Requires a skill-capable agent and a sandbox repository for the first check.",
    primaryCaution: "It can standardize the review flow, but it cannot prove that every defect was found.",
    problem: "Reduces repeated workflow setup.",
    usability: "Follow the primary-source import instructions, run it on one sandbox repository, and confirm that the expected review output is created.",
    adaptation: "The Markdown instructions are native to its documented agent and can be mapped to another skill-capable agent after checking tool names.",
    trust: "Review bundled scripts and requested repository access, keep credentials out of files, and remove the imported directory to roll back.",
  };
  return { zh: { ...display }, en: { ...display } };
}
