import { z } from "zod";

const Id = z.string().min(1).max(80);
const Timestamp = z.string().datetime();

/**
 * AI Recruiting (ADR-0023): the AI is the interviewer; the real-time stack
 * (video, voice, screen share, coding sandbox) is a communication layer that
 * activates via connectors. The interview logic, adaptive questioning,
 * rubric evaluation, and explainable reports work today over text.
 *
 * Two structural guardrails:
 *  - Culture fit is NEVER scored (bias risk; not objectively measurable).
 *  - The AI recommends; the hiring decision is a human approval.
 */
export const RECRUITING_SAFEGUARD =
  "Scores are preliminary, rubric-based, and evidence-linked for recruiter review. Culture fit is not scored. The final hiring decision remains with a human recruiter or hiring manager.";

/** One rubric dimension: competency + the points a strong answer covers. */
export const Competency = z.object({
  name: z.string().min(1).max(80),
  /** Rubric points (keywords/phrases) provided by the hiring manager. */
  rubric: z.array(z.string().min(1).max(120)).min(1),
});
export type Competency = z.infer<typeof Competency>;

export const TranscriptTurn = z.object({
  role: z.enum(["interviewer", "candidate"]),
  phase: z.enum(["intro", "resume_verification", "technical", "behavioral", "closing"]),
  text: z.string().max(20000),
  at: Timestamp,
});
export type TranscriptTurn = z.infer<typeof TranscriptTurn>;

export const CompetencyScore = z.object({
  competency: z.string(),
  /** 0–100: share of rubric points evidenced in answers (formula disclosed). */
  score: z.number().min(0).max(100),
  /** Verbatim quotes that evidence each covered rubric point. */
  evidence: z.array(z.object({ rubricPoint: z.string(), quote: z.string().max(400) })),
  uncovered: z.array(z.string()),
});
export type CompetencyScore = z.infer<typeof CompetencyScore>;

export const InterviewReport = z.object({
  competencies: z.array(CompetencyScore),
  /** Resume claims never substantively discussed — for recruiter follow-up. */
  unverifiedClaims: z.array(z.string()),
  recommendation: z.enum(["proceed", "hold", "insufficient_evidence"]),
  method: z.string(),
  safeguard: z.string(),
});
export type InterviewReport = z.infer<typeof InterviewReport>;

export const Interview = z.object({
  id: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  organizationId: Id,
  candidateName: z.string().min(1).max(160),
  roleTitle: z.string().min(1).max(160),
  interviewerEmployeeId: Id,
  language: z.string().max(40).default("English"),
  status: z.enum(["scheduled", "live", "completed"]).default("scheduled"),
  /** Claims from the CV the interview should verify. */
  resumeClaims: z.array(z.string().max(300)).default([]),
  competencies: z.array(Competency).min(1),
  transcript: z.array(TranscriptTurn).default([]),
  report: InterviewReport.optional(),
  /** Approval carrying the human hiring decision, once completed. */
  approvalId: Id.optional(),
});
export type Interview = z.infer<typeof Interview>;

/** Adaptive next question: deterministic phase flow with claim-driven and follow-up logic. */
export function nextQuestion(iv: Interview): { phase: TranscriptTurn["phase"]; text: string } | null {
  const asked = iv.transcript.filter((t) => t.role === "interviewer");
  const answers = iv.transcript.filter((t) => t.role === "candidate");
  const phaseCount = (p: TranscriptTurn["phase"]) => asked.filter((t) => t.phase === p).length;

  // Follow-up: if the last answer was thin, probe once before moving on.
  const last = iv.transcript[iv.transcript.length - 1];
  if (last?.role === "candidate" && last.text.trim().split(/\s+/).length < 12 && last.phase !== "closing") {
    const probed = asked.filter((t) => t.phase === last.phase && t.text.startsWith("Could you go deeper")).length;
    if (probed === 0) {
      return { phase: last.phase, text: "Could you go deeper on that? Walk me through a concrete example, step by step." };
    }
  }

  if (phaseCount("intro") === 0) {
    return { phase: "intro", text: `Good day ${iv.candidateName}. I'm your AI interviewer for the ${iv.roleTitle} role. We'll cover your experience, technical depth, and problem solving; scoring is rubric-based and a human makes the final decision. Ready when you are — tell me briefly about your current work.` };
  }
  const claimIdx = phaseCount("resume_verification");
  if (claimIdx < iv.resumeClaims.length) {
    return { phase: "resume_verification", text: `Your CV says: “${iv.resumeClaims[claimIdx]}”. Describe the largest real example of that — scope, the hardest incident, and how you diagnosed it.` };
  }
  const techIdx = phaseCount("technical");
  const techQuestions = iv.competencies.map((c) => `Let's test ${c.name}. Talk me through, concretely, how you handle: ${c.rubric.slice(0, 3).join(", ")} — with real examples from your work.`);
  if (techIdx < techQuestions.length) return { phase: "technical", text: techQuestions[techIdx]! };
  if (phaseCount("behavioral") === 0) {
    return { phase: "behavioral", text: "Tell me about a disagreement with a colleague: what happened, what did you do, and what did you learn?" };
  }
  if (phaseCount("closing") === 0) {
    return { phase: "closing", text: "Thank you. Anything you'd like to ask or add before I compile the report for the hiring manager?" };
  }
  return null;
}

/**
 * Evidence-linked evaluation: a rubric point counts as covered when the
 * candidate's answers mention it; the matching sentence is quoted as
 * evidence. score = covered/total × 100. Transparent, reviewable — and
 * deliberately humble (see RECRUITING_SAFEGUARD).
 */
export function evaluateInterview(iv: Interview): InterviewReport {
  const answers = iv.transcript.filter((t) => t.role === "candidate");
  const corpus = answers.map((a) => a.text).join("\n");
  const sentences = corpus.split(/(?<=[.!?])\s+/);

  const competencies: CompetencyScore[] = iv.competencies.map((c) => {
    const evidence: { rubricPoint: string; quote: string }[] = [];
    const uncovered: string[] = [];
    for (const point of c.rubric) {
      const needle = point.toLowerCase();
      const hit = sentences.find((s) => s.toLowerCase().includes(needle));
      if (hit) evidence.push({ rubricPoint: point, quote: hit.slice(0, 400) });
      else uncovered.push(point);
    }
    return {
      competency: c.name,
      score: Math.round((evidence.length / c.rubric.length) * 100),
      evidence,
      uncovered,
    };
  });

  const unverifiedClaims = iv.resumeClaims.filter((claim) => {
    const idx = iv.transcript.findIndex((t) => t.role === "interviewer" && t.text.includes(claim));
    const reply = iv.transcript[idx + 1];
    return !(reply && reply.role === "candidate" && reply.text.trim().split(/\s+/).length >= 12);
  });

  const totalAnswerWords = answers.reduce((n, a) => n + a.text.trim().split(/\s+/).length, 0);
  const avg = competencies.reduce((n, c) => n + c.score, 0) / Math.max(1, competencies.length);
  const recommendation =
    totalAnswerWords < 60 ? "insufficient_evidence" : avg >= 60 && unverifiedClaims.length === 0 ? "proceed" : "hold";

  return {
    competencies,
    unverifiedClaims,
    recommendation,
    method:
      "score = rubric points evidenced in the candidate's answers ÷ total rubric points × 100; each covered point cites the matching quote. No sentiment, no culture-fit scoring.",
    safeguard: RECRUITING_SAFEGUARD,
  };
}
