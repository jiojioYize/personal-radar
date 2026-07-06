# Personal Radar Product Strategy

Last updated: 2026-07-06

## Purpose

Personal Radar aims to reduce information anxiety in the AI era.

It turns scattered, fast-changing information into a small number of
explainable recommendations that can be delivered on schedule, reviewed later,
and improved through feedback.

The first vertical channel is `skill-radar`, focused on reusable AI-agent
skills, rules, and instruction packs.

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
- **Behavioral feedback:** useful, not useful, opened, installed, adapted, and
  optional reasons.

Explicit preferences set the initial direction. Feedback continuously corrects
the ranking.

The early hosted product should not run a complete AI research task separately
for every user. It should:

1. generate one high-quality shared base radar;
2. attach structured categories, evidence, scores, and risk signals;
3. filter, rank, and summarize that base content for each subscriber.

This keeps model cost controlled while still allowing meaningful
personalization.

## Content And Source Strategy

The content system separates discovery from verification.

- GitHub repositories and official project documentation are primary evidence.
- Web search and X can provide discovery signals.
- Social engagement and creator recommendations do not count as quality
  evidence.
- A socially discovered item must include or lead to a verifiable official
  source before it can be selected.
- Xiaohongshu is not a planned automated source because reliable public
  search and compliant unattended access are insufficient for the current
  project.
- X web results can be used as an auxiliary discovery source. Page scraping is
  not planned; an official API should only be considered after source value has
  been measured.

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

Status: planned.

Build structured reports, cross-run history, duplicate control, consistent
evaluation, local feedback learning, auxiliary X discovery, mobile HTML
summaries, and structured website reading.

Stage 2 remains single-user and local-first. It does not add accounts, paid
subscriptions, or multi-user hosting.

### Stage 3: Hosted Subscription

Begin only after Stage 2 demonstrates sustained content value.

Add accounts, entitlement rules, delivery subscriptions, explicit preferences,
feedback-backed personalization, D1 storage, and hosted operations.

### Later Expansion

- Add new channels only after the `skill-radar` quality loop is stable.
- Consider richer media after text and card usefulness is validated.
- Consider the X API only after auxiliary-source yield is measured.
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
