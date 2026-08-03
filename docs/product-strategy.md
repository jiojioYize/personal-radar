# Personal Radar Product Strategy

Last updated: 2026-07-16

## Purpose

Personal Radar aims to reduce information anxiety in the AI era.

It turns scattered, fast-changing information into a small number of
explainable recommendations that can be delivered on schedule, reviewed later,
and improved through feedback.

The first vertical channel is `skill-radar`, focused on reusable AI-agent
capabilities: skills, rules, modes, focused instruction packs, and concrete
skill-like artifacts distributed inside plugins or extensions.

This scope follows an ecosystem change rather than a naming change. Agent
platforms increasingly distribute reusable capabilities through plugins,
extensions, and marketplaces, while the valuable unit for a reader is still a
specific capability that can be understood, verified, and adopted. A plugin,
extension, marketplace listing, repository, or MCP server is therefore a
discovery container, not automatically a recommendation.

## Product Positioning

Personal Radar is not another general-purpose scheduler or message-push tool.
Scheduling, model calls, and message delivery are infrastructure rather than the
core product advantage.

The intended product is:

> A user-owned or hosted personal information filtering system that applies
> stable vertical evaluation criteria, explains its recommendations, remembers
> prior results, and gradually learns from user feedback.

The long-term differentiation should come from:

- vertical screening standards;
- trustworthy and traceable sources;
- cross-run history and duplicate control;
- recommendation explanations and action guidance;
- preference learning;
- an open self-hosted architecture;
- a low-friction hosted experience.

The current project has validated the delivery chain and the first vertical
channel. It has not yet established a mature product moat or a multi-user
service.

## Two Product Forms

### Hosted Personal Radar

The hosted product is for people who want useful filtered information without
deploying infrastructure.

Personal Radar operates generation, scheduling, storage, delivery, and the
website. Users begin with a strong default radar and can progressively
personalize it.

The hosted user journey is:

```text
visitor -> registered user -> subscriber -> personalized subscriber
```

These are lifecycle states inside one hosted product, not separate target-user
categories.

### Self-hosted Personal Radar

The self-hosted product is for builders who want system-level control.

They can choose their own model, prompts, sources, channels, storage, website,
and delivery provider. The public repository provides reusable mechanisms, but
each deployment keeps its reports, preferences, feedback, and secrets under its
owner's control.

The self-hosted version is not expected to match the hosted product's no-code
onboarding. Its value is ownership, transparency, and extensibility.

## Hosted Access Model

The planned hosted access model is progressive:

| State | Planned access |
| --- | --- |
| Visitor | Product explanation, card demonstrations, a current summary, and at least one complete sample report |
| Registered free user | Recent reports, initially proposed as the latest seven days, with limited product features |
| Subscriber | Full archive, scheduled delivery, preference controls, and feedback-based personalization |
| Self-hosted builder | Open-source system and full deployment control outside the hosted entitlement model |

The seven-day free window is a working product assumption, not a validated
pricing decision.

Archive access alone should not be the main subscription value. The stronger
value proposition is:

- information arrives without repeated searching;
- recommendations are ordered around the user's interests;
- the system remembers what it has already shown;
- each recommendation explains why it matters and what to do next;
- feedback improves later results.

## Default And Personalized Content

A new hosted subscriber starts with the default `skill-radar` selection and
ranking.

Personalization develops through two paths:

- **Explicit preferences:** topics, language, frequency, delivery channel,
  technical focus, and risk tolerance.
- **Behavioral feedback:** low-friction interest actions such as saving,
  dismissing, expanding details, and opening source links.

Explicit preferences set the initial direction. Feedback continuously corrects
the ranking.

User-facing feedback should stay lightweight from the start. Stage 2 local
validation uses positive interest as the normal signal and keeps explicit
disinterest optional. Missing feedback means unknown, never negative. The
product should not ask users to decide
whether a skill is already "useful", "installed", or "adapted" at first glance.
Those outcomes are better treated as optional later-stage evidence, not the
main feedback loop.

The practical hosted feedback model is:

| Signal | Product treatment | Recommendation meaning |
| --- | --- | --- |
| Save | Primary explicit positive signal; add to a saved-skills area | Strong interest, worth remembering |
| Not interested | Optional explicit negative signal for a clear mismatch; no separate user-facing list | Reduce similar future recommendations |
| Expand details | Weak interest signal, deduplicated per user and skill | User wanted more context |
| Open source link | Weak interest signal, same weight as expand details | User wanted external verification |
| Page dwell time | Product analytics only in early versions | Too noisy without skill-level focus |
| Report page revisit | Product analytics only in early versions | Not specific enough to infer skill preference |

Save is the primary personalization signal because users naturally notice what
they care about more often than they classify every irrelevant item. A saved
skills area also creates immediate user value. Not-interested remains available
for strong mismatches but is not required for every report.

In the current single-user Stage 2 implementation, the equivalent local signals
are recorded as `interested` and optional `not_interested`. They are gathered through
plain-language Codex feedback rather than website buttons because the public
site has no identity layer yet, and feedback written to Worker KV would not
automatically reach the local recommendation pipeline.

Expand-details and open-source-link events are useful but should remain weak
signals. They should not be ranked as stronger or weaker than each other because
their order is ambiguous: a user may expand then click, click then return, or
click out of curiosity. Repeated clicks on the same item should be capped or
deduplicated by user, skill, and time window.

Page-level dwell time and page revisit counts should not affect recommendation
ranking until the product has skill-level detail pages or reliable skill-level
focus tracking. Otherwise the system risks learning from idle tabs, background
windows, or generic report browsing rather than actual item interest.

The early hosted product should not run a complete AI research task separately
for every user. It should:

1. generate one high-quality shared base radar;
2. attach structured categories, evidence, scores, and risk signals;
3. filter, rank, and summarize that base content for each subscriber.

This keeps model cost controlled while still allowing meaningful
personalization.

## Content And Source Strategy

The content system separates discovery from verification.

- Discovery uses a portfolio rather than treating several directories as
  equivalent sources: usage-ranked registries reveal adoption, rotating
  first-party catalogs reveal governed capabilities, community directories
  reveal emerging work, and periodic rules/modes reviews preserve format
  breadth.
- The recommendable unit is an exact skill, rule, mode, or focused instruction
  pack. Containers such as plugins and extensions must be inspected until that
  exact artifact and its dependencies are identified.
- Cross-platform usability matters more than native support for any single
  agent. Each recommendation should distinguish directly portable guidance
  from host-specific manifests, tools, hooks, authentication, or runtime
  requirements.
- GitHub repositories and official project documentation are primary evidence.
- Web search can provide discovery signals. X remains a possible auxiliary
  discovery experiment rather than a current daily production source.
- Social engagement and creator recommendations do not count as quality
  evidence.
- A socially discovered item must include or lead to a verifiable official
  source before it can be selected.
- Xiaohongshu is not a planned automated source because reliable public
  search and compliant unattended access are insufficient for the current
  project.
- X web results may be tested as an auxiliary discovery source. Page scraping
  is not planned; an official API should only be considered after a bounded
  experiment measures source value.

The system should prefer no-update output over lowering its recommendation
threshold. One to six qualified items form a normal report. Zero qualified
items produce an explicit `no_update` result. A system failure must never be
presented as a no-update day.

## Channel Experience

Each channel has a different job:

- **Mobile push:** support fast discovery and the decision to continue reading.
- **Website:** support evidence review, comparison, archive browsing, and
  detailed research.
- **Markdown:** remain a portable local artifact and debugging fallback rather
  than define every user-facing layout.

The planned content flow is:

```text
structured report
├─ concise PushPlus HTML cards
├─ structured website summary and expandable details
└─ bilingual Markdown artifact
```

Push notifications should show all selected items concisely, emphasize the
strongest recommendation, and link to the complete report. The first version
uses HTML hierarchy without generated images.

## Website Evolution

The current website is a public MVP report archive and should remain available
during the content-quality stage.

The mature hosted website is expected to become:

```text
public product site
├─ product explanation and demonstration
├─ current summary and sample content
├─ registration and subscription entry
└─ signed-in application
   ├─ personalized feed
   ├─ report archive and search
   ├─ feedback history
   └─ preference and delivery settings
```

Hosted users share one product website. Personalization is rendered after
sign-in; the system should not create a separate website or subdomain for every
user.

Self-hosted users deploy an independent site and may use their own domain and
presentation.

## Storage Evolution

Storage should evolve with product complexity rather than migrate early.

### Current And Stage 2

- Cloudflare KV stores report content, latest-report pointers, indexes, and
  delivery deduplication state.
- Local files retain Markdown, structured report sidecars, history, and
  personal feedback.
- KV remains appropriate while writes are infrequent and the product is
  single-user and read-heavy.

### Hosted Subscription Stage

Cloudflare D1 becomes the primary relational store for:

- users and subscriptions;
- preferences;
- reports and report items;
- canonical sources;
- feedback;
- delivery jobs and delivery history.

KV remains useful for public-page caches, latest-report caches, small
configuration values, and auxiliary deduplication state.

### Media Stage

Cloudflare R2 is introduced only when the product needs durable images, report
exports, screenshots, video, or other large objects. Stage 2 HTML cards do not
require R2.

## Stage Roadmap

### Stage 1: Reliable MVP

Status: complete.

Validated scheduled generation, outbox handoff, local forwarding, Worker
ingest, KV persistence, public reports, and PushPlus delivery.

### Stage 2: Content Quality And Reading Experience

Status: complete as of 2026-07-31.

Implemented structured reports, artifact-level history and review state,
duplicate control, qualitative recommendation decisions, local interest
ordering and replay, multi-agent source verification, mobile HTML summaries,
and structured website reading.

Stage 2 remains single-user and local-first. It does not add accounts, paid
subscriptions, or multi-user hosting.

### Stage 2.5: Content Productization And Visual Experience

Status: complete as of 2026-08-03.

The current release replaces implementation-oriented report framing with a
reader-facing daily brief: a compact introduction, reader-facing topic labels,
expandable evidence, and a bilingual archive. A unified header provides
previous/next navigation and a date chooser built only from reports that
actually exist; archive and language controls use the same pattern across
report and archive pages. Internal selection statistics, priority framing, and
source-verification timestamps remain in structured data rather than the
reader-facing page. Recommendations are presented as equal-weight collapsed
rows. Interest signals may reorder qualified items, but the UI does not expose
rank numbers or imply that the first item is a top pick. Visual emphasis is
reserved for the item the reader actively expands. Official sources open in a
new tab so the report remains available for comparison. Desktop and 390px
mobile layouts are verified against a real structured report before deployment.

Recommendation details follow progressive disclosure. The first decision layer
uses plain language to explain what the skill helps accomplish, when it is
useful, and what must be available before starting. Identity-based audience
labels and dense technical cautions do not occupy this layer. Interested
readers can then inspect verified installation guidance, platform adaptation,
limitations, trust boundaries, and a copyable AI handoff task. The handoff asks
the user's own agent to evaluate compatibility and propose a plan before making
changes, connecting discovery to guarded adoption without granting automatic
installation authority.

PushPlus now acts as the discovery hook rather than a compressed copy of the
website. Its accepted dark HTML briefing shows the daily theme, each Skill's
plain-language outcome, and the situation that makes it worth opening, followed
by one link to the full report. Setup, limitations, source evidence, and AI
handoff stay on the website. The 2026-08-03 scheduled report validated the new
reader contract and both production surfaces; subsequent changes are normal
product iteration rather than unfinished Stage 2.5 scope.

Richer media and portfolio illustrations are separate follow-up work. Generated
images are not a dependency for this stage.

### Stage 3: Hosted Subscription

Begin only after the current content and reading experience demonstrates
sustained value.

Add accounts, entitlement rules, delivery subscriptions, explicit preferences,
feedback-backed personalization, D1 storage, and hosted operations.

### Later Expansion

- Add new channels only after the `skill-radar` quality loop is stable.
- Consider richer media after text and card usefulness is validated.
- Consider the X API only after a bounded auxiliary-source experiment measures
  yield.
- Produce a short product video when the end-to-end hosted experience is ready
  to demonstrate.

## Decision Principles

- Content quality before channel count.
- Verification before popularity.
- Personalization value before configuration complexity.
- Reliable delivery before additional integrations.
- Structured data before multiple presentation formats.
- Shared base research before per-user model runs.
- Mechanisms may be open; personal reports, feedback, and secrets remain local
  to their owner.
- Product decisions should be validated through real use rather than simulated
  users where practical.
