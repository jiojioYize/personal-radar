# Skill Radar Source Audit

Last updated: 2026-07-16

## Status

The source landscape review is complete. After two successful isolated shadow
dates, `portfolio-v1` was approved for controlled production on 2026-07-16.
The original three-source flow remains available only as a short-term rollback
reference while the first three production dates are observed.

The promotion deliberately accepts one residual test gap: the bounded model
recovery path was covered by code-level boundary tests but was not naturally
triggered in an Automation shadow run. Waiting for that uncommon condition was
not considered proportionate for a single-user rollout because a failed
recovery stops report generation instead of publishing invalid content.

## Decision Summary

The current three-source flow was valuable because it made Automation bounded
and repeatable. It should not become the permanent source strategy:

- the three sources have different meanings and quality boundaries;
- one is Claude-focused, one is a plugin catalog, and one mixes concrete
  skills with ordinary tools and broad frameworks;
- the ecosystem is moving toward plugins and extensions that contain skills,
  so searching only standalone skill directories will miss useful artifacts;
- no single directory provides sufficient coverage, trust, freshness, and
  artifact-level precision.

The recommended direction is a layered source portfolio:

```text
usage-ranked skill registry
  + rotating first-party skill/plugin catalogs
  + bounded community trend sources
  + periodic rules/modes lane
  -> exact skill/rule artifact verification
```

The recommendation target remains a concrete skill, rule, mode, or focused
instruction pack. A plugin, extension, marketplace, or directory is a discovery
container, not automatically a recommendation unit.

## Object Model

The source flow should distinguish four levels:

| Level | Meaning | Example |
| --- | --- | --- |
| Discovery source | Where candidates are found | skills.sh, Cursor Marketplace |
| Distribution package | Installable container | Codex plugin, Gemini extension |
| Recommendable artifact | Concrete reusable capability | one `SKILL.md`, rule, or Roo mode |
| Supporting dependency | Tool needed by the artifact | MCP server, CLI, API, hook |

This distinction prevents two recurring errors:

1. recommending an entire plugin because one useful skill exists inside it;
2. treating a popular ordinary tool as a skill because a directory labels it
   as agent-compatible.

## Audit Criteria

Sources were reviewed against the following practical criteria:

- **Channel fit**: proportion of listings likely to contain real skills,
  rules, modes, or instruction packs;
- **Artifact precision**: ability to reach the exact reusable artifact rather
  than only a repository or product page;
- **Provenance**: first-party ownership, canonical repository links, and clear
  license or maintenance responsibility;
- **Freshness signals**: recent updates, installs, trend data, or change hashes;
- **Trust signals**: permissions, audits, dependencies, and source visibility;
- **Platform breadth**: coverage beyond one coding agent;
- **Automation fit**: stable pages, structured catalogs, APIs, or predictable
  repository layouts;
- **Noise risk**: likelihood of ordinary tools, generic MCP servers, broad
  frameworks, or duplicated copies entering the candidate pool.

## Current Production Sources

| Source | Audit finding | Decision |
| --- | --- | --- |
| [Awesome Claude Skills](https://awesomeclaudeskills.com/) | Useful trend page with frequent refreshes, but Claude-focused and explicitly mixes skills, MCP servers, and tools. The observed catalog was small enough to saturate quickly. | **Retain as an auxiliary trend source**, not a complete core source. |
| [Agent Plugins](https://github.com/dmgrok/agent-plugins) | Large catalog of installable Claude plugins. A plugin may contain useful skills, but the listing unit is a plugin and may also be MCP- or tool-led. Every candidate requires package inspection. | **Remove from the primary skill lane after shadow validation**; keep as an occasional plugin-discovery source. |
| [OpenAgentSkill](https://www.openagentskill.com/skills) | Strong public API and task-oriented metadata, but observed listings include ordinary tools and broad frameworks alongside real skills. Its own scores cannot establish channel fit. | **Keep as an auxiliary API source** with strict artifact verification; do not trust directory labels as proof. |

## Candidate Source Landscape

### Cross-platform registry

| Source | Strengths | Limitations | Proposed role |
| --- | --- | --- | --- |
| [skills.sh](https://www.skills.sh/) | Stable artifact IDs, install telemetry, official/trending views, duplicate flags, full skill file trees, and partner security audits. Covers many agent platforms. | Programmatic API authentication currently uses Vercel OIDC; install count measures adoption, not task quality. | **Primary registry pulse** using public Official/Trending pages first; evaluate API integration separately. |
| [SkillMD](https://skillmd.com/) | Large SKILL.md-focused catalog, official publisher labels, capability flags, and broad platform coverage. | Public claims and verification rules require deeper independent validation; catalog scale increases copy and low-quality risk. | **Watch and sample**, not initial production core. |

### First-party and governed catalogs

| Source | Strengths | Limitations | Proposed role |
| --- | --- | --- | --- |
| [Anthropic Skills](https://github.com/anthropics/skills) | Canonical examples, exact skill directories, specification and templates; includes production-used document skills with explicit licensing caveats. | Narrower vendor perspective and some skills are reference/demo material. | **Official rotation: high priority.** |
| [OpenAI Plugins](https://github.com/openai/plugins) | Current official Codex examples. Plugin layouts expose contained `skills/` alongside MCP, apps, hooks, commands, and assets. | Plugin-level listing is not artifact-level; extraction must identify the contained skill and dependency boundary. | **Official rotation: high priority.** |
| [GitHub Awesome Copilot](https://github.com/github/awesome-copilot) | Typed directories for skills, instructions, agents, plugins, hooks, and workflows; exact reusable files and broad contributor activity. | Community-contributed content under an official organization is not the same as first-party-authored content. | **Official-governed rotation and primary rules source.** |
| [Cursor Marketplace](https://cursor.com/marketplace) | Curated partner plugins across the development lifecycle; many bundles explicitly include skills and rules. | Marketplace unit is a plugin and often includes MCP access or authentication; exact skill files may require repository inspection. | **Official plugin-discovery rotation.** |
| [Gemini CLI Extensions](https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/index.md) | Official extension format supports a predictable `skills/<name>/SKILL.md` layout plus hooks, commands, and subagents. | The gallery is extension-oriented and ecosystem naming is evolving; not every extension contains a skill. | **Official extension-discovery rotation.** |
| [NVIDIA Skills](https://github.com/NVIDIA/skills) | First-party verified skills, daily mirrored catalog, exact skill list, cross-agent installation, and explicit governance. | Domain concentration in NVIDIA products; too narrow for daily general discovery. | **Domain rotation**, especially data, AI infrastructure, and scientific workflows. |
| [Hugging Face Skills](https://github.com/huggingface/skills) | Exact first-party SKILL.md artifacts for datasets, training, evaluation, Spaces, and Hub workflows; multiple platform manifests. | Concentrated in the Hugging Face ecosystem. | **Domain rotation**, especially data analysis and AI development. |
| [Microsoft Agent Skills](https://github.com/MicrosoftDocs/agent-skills) | Large exact-skill catalog derived from Microsoft Learn, plugin manifests for major agents, explicit classification records and licenses. | Strong Azure concentration; many skills depend on current documentation access. | **Domain rotation**, not an unrestricted daily source. |

### Rules and modes

| Source | Finding | Proposed role |
| --- | --- | --- |
| [GitHub Awesome Copilot](https://github.com/github/awesome-copilot) | Contains reusable instructions and agent configurations in separately typed directories. | Primary source for a periodic rules/instructions lane. |
| [Roo Code Marketplace](https://roocodeinc.github.io/Roo-Code/features/marketplace/) | Roo Modes are reusable instruction and rule bundles, while the same market also contains MCPs. | Periodic mode discovery with type filtering; do not ingest the MCP tab. |
| [Cline Rules documentation](https://docs.cline.bot/customization/cline-rules) | Defines portable `.clinerules/`, Cursor rules, Windsurf rules, and `AGENTS.md` compatibility, but is not itself a public rule catalog. | Use as a format and portability reference, not a candidate source. |

## Recommended Source Portfolio

The next production design should replace a fixed list of three equal sources
with lanes that serve different discovery jobs.

### Daily lanes

1. **Registry pulse: 3-4 candidates**
   - skills.sh Official, Trending, or Hot pages;
   - prefer original artifacts and direct GitHub sources;
   - install counts and audits are discovery evidence only.

2. **Official rotation: 3-4 candidates**
   - rotate Anthropic, OpenAI, GitHub, Cursor, Gemini, NVIDIA, Hugging Face,
     and Microsoft catalogs;
   - inspect a plugin or extension until an exact child skill is identified;
   - rotate rather than open every catalog every day.

3. **Community trend: 2-4 candidates**
   - Awesome Claude Skills as the first trend source;
   - OpenAgentSkill as a structured auxiliary source;
   - require a canonical exact artifact before code eligibility.

These counts shape discovery effort only. Recommendation decisions remain
quality-based and do not preserve source quotas.

### Periodic lane

Run a rules/modes review weekly rather than forcing rules into every daily
report. Start with GitHub Awesome Copilot instructions and Roo Code Modes.

## Required Data Model Changes

Production still treats discovery type as one of three fixed values. The
isolated shadow profile now separates:

- `sourceId`: the directory, marketplace, or official catalog;
- `containerType`: registry entry, repository, plugin, or extension;
- `artifactType`: skill, rule, mode, or focused instruction pack;
- `artifactUrl`: canonical exact artifact URL;
- `containerUrl`: plugin or repository URL when different;
- `provenance`: first-party, officially governed community, or independent;
- `discoverySignals`: installs, trend, audit, or directory metadata;
- `dependencies`: MCP, CLI, API, hooks, authentication, or none.

These fields are validated and retained in shadow candidate and decision data.
Migrating the production prompt and public report contract remains deferred
until the source portfolio passes shadow validation.

## Shadow Validation Plan

The original plan called for three isolated test dates. The promotion decision
was made after two successful dates because both exercised complete daily
flows, different registry views, different official rotations, history
filtering, exact-artifact verification, and final report generation. The third
run was waived rather than waiting for a recovery condition that might not
occur naturally.

For each run, compare:

- exact-artifact yield after boundary filtering;
- unique candidates not found by the current three sources;
- overlap and copy/fork duplication;
- first-party and platform coverage across the full test window;
- source-link accessibility and verification time;
- ordinary-tool or generic-framework false positives;
- final recommend/defer/reject distribution.

The portfolio was promoted against these criteria:

1. all eligible candidates resolve to exact reusable artifacts;
2. consecutive runs complete without source-access or candidate-shortage
   failure, with the remaining recovery branch recorded as a production risk;
3. the new portfolio contributes credible unique candidates rather than only
   duplicating the current pool;
4. plugin and extension dependencies are surfaced before recommendation;
5. the added discovery breadth does not make Automation unstable again.

## Shadow Validation Progress

| Date | Result | Candidate coverage | Decisions | Main finding |
| --- | --- | --- | --- | --- |
| 2026-07-15 | Pass 1 of 3 | 9 candidates; registry, official, and community lanes each contributed 3 | 7 recommend, 2 defer, 0 reject | Six selected artifacts came from the new registry/official lanes and all selected artifacts were distinct from the same-day production report. Exact primary-source paths were reachable. Community discovery remained useful but required stronger dependency review: CodeQL and Playwright candidates were deferred for CLI, runtime, installation, or broad execution boundaries. |
| 2026-07-16 | Pass 2 of 3 | 10 candidates: 4 registry, 3 official, and 3 community; code retained 5 after history filtering | 4 recommend, 1 defer, 0 reject | The code-owned plan changed the registry view from All Time to Trending and assigned Cursor, Gemini, and NVIDIA. Gemini and NVIDIA supplied the required two official sources; Cursor yielded no selected candidate. Four recommendations covered frontend review, extension authoring, GPU data work, and design communication. CUDA-Q was deferred because its installed artifact did not include referenced local documentation. |

The first run used all-time leaderboard signals for all three `skills.sh`
candidates. The next run should deliberately sample Trending or Hot results
and rotate the official lane away from the same OpenAI, Microsoft, and GitHub
catalog combination. This tests freshness and replenishment rather than merely
repeating mature catalog leaders.

Source rotation is code-owned after the first run. The shadow `prepare`
command writes an authoritative daily plan and maintains a local rotation
record. Candidate filtering rejects a skills.sh view that does not match the
plan and official candidates outside the assigned source set. The plan is
stable for same-date retries and advances only on a later test date.

Model recovery remains bounded but intentionally permissive during shadow
validation. A code rejection triggers up to three evidence-backed correction
attempts. The model may fix candidate metadata, retry an equivalent canonical
page, or replenish from the same planned lane. It may use any two of the three
assigned official sources, but it may not edit the plan, override history, or
turn an access failure into `no_update`. Pass 2 retained exactly five eligible
candidates, so this recovery path was not exercised and remains an explicit
residual test gap.

## Security Notes

- Registry popularity, publisher badges, and automated audits are supporting
  signals, not permission to install or execute a skill.
- Plugin-level trust does not automatically apply to every contained skill,
  and skill-level usefulness does not make all plugin permissions acceptable.
- Review the canonical repository, exact artifact, scripts, hooks, network
  access, secret usage, license, and external dependencies.
- Treat copied skills and forks as separate supply-chain risks unless their
  provenance and changes are understood.

## Sources Consulted

- [OpenAI: Build plugins](https://developers.openai.com/codex/plugins/build)
- [OpenAI Plugins repository](https://github.com/openai/plugins)
- [Anthropic Skills repository](https://github.com/anthropics/skills)
- [skills.sh documentation and API](https://www.skills.sh/docs/api)
- [Cursor Marketplace](https://cursor.com/marketplace)
- [Gemini CLI extension reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md)
- [GitHub Awesome Copilot](https://github.com/github/awesome-copilot)
- [NVIDIA Skills](https://github.com/NVIDIA/skills)
- [Hugging Face Skills](https://github.com/huggingface/skills)
- [Microsoft Agent Skills](https://github.com/MicrosoftDocs/agent-skills)
- [Roo Code Marketplace](https://roocodeinc.github.io/Roo-Code/features/marketplace/)
- [Cline Rules](https://docs.cline.bot/customization/cline-rules)
