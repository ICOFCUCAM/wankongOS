import { Workflow } from "@wankong/core";

const TS = "2026-01-01T00:00:00.000Z";

/**
 * A realistic seeded workflow: **Inbound Lead Handling**.
 *
 *   start → Research Analyst enriches the account
 *         → decision on lead score
 *             ≥70 → Sales Director drafts outreach → human approval
 *                     approved  → CRM upsert (connector) → notify → done
 *                     rejected  → add to nurture → done
 *             <70 → add to nurture → done
 *
 * It references the seeded employees (Research Analyst, Sales Director) and runs
 * end-to-end on the local provider, pausing for a real human approval.
 */
export function buildSeedWorkflow(organizationId: string): Workflow {
  return Workflow.parse({
    id: "wf_inbound_lead",
    organizationId,
    createdAt: TS,
    updatedAt: TS,
    name: "Inbound Lead Handling",
    description:
      "Enrich a new lead, decide by score, draft outreach with human approval, and update the CRM.",
    trigger: { kind: "event", event: "lead.created" },
    active: true,
    entryNodeId: "n_start",
    nodes: [
      { id: "n_start", type: "start", next: "n_research" },
      {
        id: "n_research",
        type: "employee",
        name: "Enrich account",
        employeeId: "emp_research",
        prompt:
          "Research the account {{lead.company}} and summarise in 3 bullets why they may fit our ICP.",
        outputKey: "brief",
        retry: { maxAttempts: 2, backoffMs: 0 },
        timeoutMs: 30000,
        next: "n_decision",
      },
      {
        id: "n_decision",
        type: "decision",
        name: "Qualify by score",
        branches: [{ when: { path: "lead.score", op: "gte", value: 70 }, to: "n_draft" }],
        else: "n_nurture",
      },
      {
        id: "n_draft",
        type: "employee",
        name: "Draft outreach",
        employeeId: "emp_sales_director",
        prompt:
          "Draft a short first-touch outreach email to {{lead.name}} at {{lead.company}}. Context: {{brief}}",
        outputKey: "draft",
        next: "n_approval",
      },
      {
        id: "n_approval",
        type: "approval",
        name: "Approve outreach",
        summary: "Approve first-touch outreach to {{lead.company}}",
        requiredPermission: "task:approve",
        onApprove: "n_crm",
        onReject: "n_nurture",
      },
      {
        id: "n_crm",
        type: "integration",
        name: "Update CRM",
        integration: "hubspot",
        action: "upsert_contact",
        params: { company: "{{lead.company}}", stage: "engaged" },
        outputKey: "crm",
        next: "n_notify",
      },
      {
        id: "n_notify",
        type: "notification",
        name: "Notify team",
        channel: "inapp",
        message: "Outreach to {{lead.company}} approved and queued.",
        next: "n_done",
      },
      { id: "n_done", type: "end", status: "completed" },
      {
        id: "n_nurture",
        type: "notification",
        name: "Add to nurture",
        channel: "inapp",
        message: "Lead {{lead.company}} added to the nurture track.",
        next: "n_nurture_done",
      },
      { id: "n_nurture_done", type: "end", status: "completed" },
    ],
  });
}
