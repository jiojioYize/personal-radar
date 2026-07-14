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
      recommendation: "adapt",
      reason: "A concrete and portable workflow.",
      display: displayFixture(),
    },
    watchDecision(base, "Watch One", "watch-one", "awesome-claude-skills"),
    watchDecision(base, "Watch Two", "watch-two", "open-agent-skill"),
    rejectDecision(base, "Reject One", "reject-one"),
    rejectDecision(base, "Reject Two", "reject-two"),
  ];
  return {
    reportDate: "2026-07-14",
    summary: { zh: "Today's simplified test.", en: "Today's simplified test." },
    conclusion: { zh: "Only verified items are recommended.", en: "Only verified items are recommended." },
    candidateCount: 10,
    duplicateCount: 1,
    sourceCounts: { awesomeClaudeSkills: 3, agentPlugins: 4, openAgentSkill: 3 },
    decisions,
  };
}

function watchDecision(base, title, slug, type) {
  return {
    ...base,
    title,
    sourceUrl: `https://github.com/example/${slug}`,
    artifactScope: "individual_skill",
    artifactPath: null,
    discovery: { type, url: "https://example.com/directory" },
    decision: "watch",
    reason: "Useful but needs more maintenance evidence.",
  };
}

function rejectDecision(base, title, slug) {
  return {
    ...base,
    title,
    sourceUrl: `https://github.com/example/${slug}`,
    artifactScope: "individual_skill",
    artifactPath: null,
    decision: "reject",
    reason: "Not sufficiently reusable.",
  };
}

function displayFixture() {
  const display = {
    oneLiner: "A concrete reusable workflow.",
    whyNow: "The source is active.",
    bestFor: "Coding-agent users.",
    action: "Adapt it in a sandbox.",
    primaryCaution: "Review permissions first.",
    problem: "Reduces repeated workflow setup.",
    usability: "Documented on its native platform.",
    adaptation: "The Markdown instructions are portable.",
    trust: "Use the official repository and review scripts.",
  };
  return { zh: { ...display }, en: { ...display } };
}
