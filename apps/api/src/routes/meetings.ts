import { Hono } from "hono";
import type { Env } from "../context.js";
import { authorize } from "../http.js";
import { buildGroundedEmployeeContext } from "../employee-context.js";

export interface MeetingUpdate {
  department: string;
  employeeId: string;
  employeeName: string;
  update: string;
}

export const meetingRoutes = new Hono<Env>();

/**
 * The executive meeting (ADR-0027): each department's lead gives a concise
 * update generated from THEIR OWN records — the activity log in their
 * grounded context — not from a script. Minutes are stored as an asset and
 * the meeting lands in the pulse. Departments without active employees are
 * honestly listed as absent.
 */
meetingRoutes.post("/meetings/executive", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const orgId = ctx.organizationId;
  const [departments, employees] = await Promise.all([
    ctx.store.departments.listByOrg(orgId),
    ctx.store.employees.listByOrg(orgId, (e) => e.status === "active"),
  ]);

  const updates: MeetingUpdate[] = [];
  const absent: string[] = [];
  for (const dept of departments) {
    const members = employees.filter((e) => e.departmentId === dept.id);
    const lead = members.find((m) => m.id === dept.headEmployeeId) ?? members[0];
    if (!lead) {
      if ((await ctx.store.employees.listByOrg(orgId, (e) => e.departmentId === dept.id)).length > 0) {
        absent.push(dept.name);
      }
      continue;
    }
    const grounded = await buildGroundedEmployeeContext(ctx.store, orgId, lead);
    const run = await ctx.runtime.complete({
      employee: lead,
      context: grounded.context,
      input:
        "Executive meeting — you have the floor for your department. In 2–3 sentences, report: what was completed, what is in flight, anything blocked, and anything you need from the CEO. Use ONLY your activity log and records; cite a timestamp where it strengthens the point.",
    });
    updates.push({ department: dept.name, employeeId: lead.id, employeeName: lead.name, update: run.text.trim() });
  }

  const now = new Date();
  const minutes = `# Executive meeting — ${now.toISOString().slice(0, 16).replace("T", " ")}\n\n${updates
    .map((u) => `## ${u.department} — ${u.employeeName}\n\n${u.update}\n`)
    .join("\n")}${absent.length ? `\n## Absent\n\n${absent.join(", ")} (no active employees)\n` : ""}\n---\nGenerated from each lead's own records (activity logs); minutes stored automatically.\n`;
  const asset = await ctx.store.assets.create({
    organizationId: orgId,
    studioId: "document",
    kind: "meeting_minutes",
    title: `Executive meeting ${now.toISOString().slice(0, 10)} ${now.toISOString().slice(11, 16)}`,
    mimeType: "text/markdown",
    content: minutes,
    version: 1,
    tags: ["meeting", "executive"],
    createdBy: { kind: "user", id: c.get("actor").user.id },
  });
  await ctx.store.audit({
    organizationId: orgId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "meeting.executive",
    targetType: "asset",
    targetId: asset.id,
    metadata: { departments: updates.length, absent: absent.length },
  });
  return c.json({ updates, absent, minutesAssetId: asset.id }, 201);
});

/** Past meetings — the minutes assets. */
meetingRoutes.get("/meetings", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const assets = await ctx.store.assets.listByOrg(ctx.organizationId, (a) => a.kind === "meeting_minutes");
  assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return c.json({ data: assets.map(({ content, ...meta }) => meta) });
});
