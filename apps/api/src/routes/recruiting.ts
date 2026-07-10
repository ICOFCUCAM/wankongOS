import { Hono } from "hono";
import { z } from "zod";
import {
  Competency,
  evaluateInterview,
  nextQuestion,
  RECRUITING_SAFEGUARD,
  type TranscriptTurn,
} from "@wankong/core";
import type { Env } from "../context.js";
import { authorize, findScoped, parseBody } from "../http.js";
import { notify } from "../notify.js";

/** The interview stack: what runs today vs. what a connector activates. */
const STACK = [
  { component: "Scheduler", tier: "builtin" },
  { component: "Adaptive question engine", tier: "builtin" },
  { component: "Resume verification", tier: "builtin" },
  { component: "Rubric evaluation + explainable report", tier: "builtin" },
  { component: "Human hiring decision (approvals)", tier: "builtin" },
  { component: "Live video (WebRTC)", tier: "connector", connectors: ["webrtc", "livekit", "daily"] },
  { component: "Voice engine (TTS)", tier: "connector", connectors: ["elevenlabs", "openai-audio"] },
  { component: "Speech recognition (STT)", tier: "connector", connectors: ["whisper", "deepgram"] },
  { component: "Screen sharing", tier: "connector", connectors: ["webrtc", "livekit"] },
  { component: "Coding sandbox", tier: "connector", connectors: ["code-sandbox", "mcp"] },
  { component: "Shared whiteboard", tier: "connector", connectors: ["whiteboard"] },
] as const;

const Schedule = z.object({
  candidateName: z.string().min(1).max(160),
  roleTitle: z.string().min(1).max(160),
  language: z.string().max(40).optional(),
  resumeClaims: z.array(z.string().max(300)).max(10).optional(),
  competencies: z.array(Competency).min(1).max(8),
  interviewerEmployeeId: z.string().max(80).optional(),
});

export const recruitingRoutes = new Hono<Env>();

recruitingRoutes.get("/recruiting/stack", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const integrations = await ctx.store.integrations.list((i) => i.organizationId === ctx.organizationId);
  const connected = new Set(integrations.map((i) => i.kind.toLowerCase()));
  return c.json({
    data: STACK.map((s) => ({
      ...s,
      active: s.tier === "builtin" || (s as { connectors?: readonly string[] }).connectors?.some((k) => connected.has(k)) === true,
    })),
    safeguard: RECRUITING_SAFEGUARD,
  });
});

/** Schedule an interview; returns the invitation text. */
recruitingRoutes.post("/recruiting/interviews", async (c) => {
  authorize(c, "employee:manage");
  const ctx = c.get("ctx");
  const input = await parseBody(c, Schedule);
  const interviewer =
    input.interviewerEmployeeId ??
    (await ctx.store.employees.list((e) => e.organizationId === ctx.organizationId && /recruit/i.test(e.title)))[0]?.id;
  if (!interviewer) return c.json({ error: "No recruiter employee found to conduct the interview." }, 422);
  const iv = await ctx.store.interviews.create({
    organizationId: ctx.organizationId,
    candidateName: input.candidateName,
    roleTitle: input.roleTitle,
    language: input.language ?? "English",
    interviewerEmployeeId: interviewer,
    status: "scheduled",
    resumeClaims: input.resumeClaims ?? [],
    competencies: input.competencies,
    transcript: [],
  });
  await ctx.store.audit({ organizationId: ctx.organizationId, actor: { kind: "user", id: c.get("actor").user.id }, action: "recruiting.interview.schedule", targetType: "interview", targetId: iv.id, metadata: { candidate: iv.candidateName, role: iv.roleTitle } });
  return c.json({
    interview: iv,
    invitation: `Hello ${iv.candidateName},\n\nYour interview for ${iv.roleTitle} is scheduled. It runs ~45 minutes and covers experience, technical skills, and problem solving. Scoring is rubric-based and reviewed by a human hiring manager.\n\nJoin when ready: POST /v1/recruiting/interviews/${iv.id}/start`,
  }, 201);
});

recruitingRoutes.get("/recruiting/interviews", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  const data = await ctx.store.interviews.list((i) => i.organizationId === ctx.organizationId);
  data.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return c.json({ data });
});

recruitingRoutes.get("/recruiting/interviews/:id", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  return c.json(await findScoped(c, (id) => ctx.store.interviews.get(id), c.req.param("id")));
});

/** Start: the interviewer opens with the first question. */
recruitingRoutes.post("/recruiting/interviews/:id/start", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  const iv = await findScoped(c, (id) => ctx.store.interviews.get(id), c.req.param("id"));
  if (iv.status !== "scheduled") return c.json({ error: `Interview is ${iv.status}` }, 409);
  const q = nextQuestion(iv)!;
  const turn: TranscriptTurn = { role: "interviewer", phase: q.phase, text: q.text, at: new Date().toISOString() };
  const updated = await ctx.store.interviews.update(iv.id, { status: "live", transcript: [turn] });
  return c.json({ interview: updated, question: q });
});

/** Candidate answers; the engine adapts and asks the next question — or completes. */
recruitingRoutes.post("/recruiting/interviews/:id/answer", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  const iv = await findScoped(c, (id) => ctx.store.interviews.get(id), c.req.param("id"));
  if (iv.status !== "live") return c.json({ error: `Interview is ${iv.status}` }, 409);
  const { text } = await parseBody(c, z.object({ text: z.string().min(1).max(20000) }));
  const lastQ = [...iv.transcript].reverse().find((t) => t.role === "interviewer")!;
  const now = new Date().toISOString();
  const withAnswer = { ...iv, transcript: [...iv.transcript, { role: "candidate" as const, phase: lastQ.phase, text, at: now }] };

  const q = nextQuestion(withAnswer);
  if (q) {
    const updated = await ctx.store.interviews.update(iv.id, {
      transcript: [...withAnswer.transcript, { role: "interviewer" as const, phase: q.phase, text: q.text, at: now }],
    });
    return c.json({ interview: updated, question: q, done: false });
  }

  // Interview exhausted: evaluate, file the report, and hand the DECISION to a human.
  const report = evaluateInterview(withAnswer);
  const approval = await ctx.store.approvals.create({
    organizationId: ctx.organizationId,
    requestedBy: { kind: "employee", id: iv.interviewerEmployeeId },
    summary: `Hiring decision for ${iv.candidateName} (${iv.roleTitle}): AI recommends "${report.recommendation}" — review the evidence-linked report before deciding.`,
    requiredPermission: "task:approve",
    status: "pending",
  });
  await notify(ctx.store, ctx.organizationId, {
    kind: "approval.pending",
    title: `Hiring decision needed: ${iv.candidateName} (${iv.roleTitle})`,
    body: `AI recommends "${report.recommendation}" — review the evidence-linked report.`,
    link: "/tasks",
  });
  const updated = await ctx.store.interviews.update(iv.id, {
    status: "completed",
    transcript: withAnswer.transcript,
    report,
    approvalId: approval.id,
  });
  await ctx.store.audit({ organizationId: ctx.organizationId, actor: { kind: "employee", id: iv.interviewerEmployeeId }, action: "recruiting.interview.complete", targetType: "interview", targetId: iv.id, metadata: { recommendation: report.recommendation, approvalId: approval.id } });
  return c.json({ interview: updated, done: true, report, approvalId: approval.id });
});
