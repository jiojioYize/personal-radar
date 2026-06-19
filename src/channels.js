export const CHANNELS = [
  {
    id: "skill-radar",
    title: "Skill Radar",
    enabled: true,
    maxItems: 10,
    sources: [
      {
        type: "github-search",
        label: "Codex native skills",
        categoryHint: "Codex Skill",
        query: "codex skill SKILL.md OR .codex/skills OR codex skills OR codex plugin skill",
      },
      {
        type: "github-search",
        label: "Claude skills",
        categoryHint: "Other Agent Skill",
        query: "claude skill OR claude skills OR claude code skill OR CLAUDE.md",
      },
      {
        type: "github-search",
        label: "Cursor rules",
        categoryHint: "Other Agent Skill",
        query: "cursor rules OR .cursorrules OR cursor agent rules OR cursor workflow rules",
      },
      {
        type: "github-search",
        label: "Cline and Roo rules",
        categoryHint: "Other Agent Skill",
        query: "cline rules OR roo code rules OR roocode rules OR .clinerules OR .roo",
      },
      {
        type: "github-search",
        label: "Agent skill packs",
        categoryHint: "Other Agent Skill",
        query: "agent skill pack OR ai agent skills OR reusable agent rules OR coding agent rules",
      },
    ],
  },
];
