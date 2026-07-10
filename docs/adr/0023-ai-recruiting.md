# ADR-0023: AI recruiting — the AI interviews, a human hires

- Status: Accepted
- Date: 2026-07-10

## Context

An AI recruiter can conduct live interviews with video, voice, screen share,
and coding exercises — but it doesn't "do" those things itself; it
orchestrates a real-time stack and evaluates what it observes. The directive
also set two ethical constraints we adopt as structure, not policy text.

## Decision

**Honest stack tiers.** `GET /v1/recruiting/stack` lists the architecture:
scheduler, adaptive question engine, resume verification, rubric evaluation,
and the human-decision handoff run today (builtin); live video (WebRTC),
TTS/STT, screen sharing, coding sandbox, and whiteboard are connector-tier
and show as inactive until a matching integration exists.

**Adaptive, deterministic interviewing.** The question engine walks
intro → resume verification (one question per CV claim) → technical (one per
competency, built from its rubric) → behavioral → closing, and probes once
whenever an answer is thin — replayable and testable, no hidden prompts.

**Evidence-linked evaluation.** Hiring managers define competencies as
rubric points. score = points evidenced ÷ total × 100, and every covered
point cites the candidate's verbatim sentence. Resume claims answered with
one-liners surface as `unverifiedClaims`. The method string ships in every
report.

**Culture fit is not scored.** Structurally absent from the report schema.

**The decision is a human approval.** Completing an interview files the
report and creates a pending approval ("review the evidence-linked report
before deciding") in the existing governance system — the AI recommends
(`proceed` / `hold` / `insufficient_evidence`), a human decides.

## Consequences

- Interviews work end-to-end today over text; wiring WebRTC/STT/TTS
  connectors upgrades the channel without touching the engine or reports.
- Rubric scoring is deliberately literal (keyword evidence); it under-scores
  paraphrase — acceptable, because scores are labeled preliminary and every
  score is one click from its evidence.
- Accessibility (captions, keyboard flows) rides on the text-first design.
