import { BrandKit } from "@wankong/core";
import type { Store } from "@wankong/store";

/** Structural slice of AppContext the generators need — tools can call in too. */
export interface StudioCtx {
  store: Store;
  organizationId: string;
}

export interface GenerateResult {
  kind: string;
  title: string;
  mimeType: string;
  content: string;
  tags: string[];
}

interface Input {
  kind: string;
  title?: string;
  /** Free-form structured input; each generator documents what it reads. */
  data?: Record<string, unknown>;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v.filter((r) => r && typeof r === "object") as Record<string, unknown>[]) : [];

async function brandOf(ctx: StudioCtx): Promise<BrandKit> {
  const kits = await ctx.store.brandKits.list((b) => b.organizationId === ctx.organizationId);
  if (kits[0]) return kits[0];
  return ctx.store.brandKits.create(
    BrandKit.omit({ id: true, createdAt: true, updatedAt: true }).parse({
      organizationId: ctx.organizationId,
      colors: {},
    }),
  );
}

/**
 * Builtin studio generators: deterministic, server-side, zero external
 * services. Every generator returns real file content (markdown, HTML,
 * SVG, CSV) derived from its input and the org's records/brand kit.
 */
export async function generate(
  ctx: StudioCtx,
  studioId: string,
  input: Input,
): Promise<GenerateResult> {
  const org = await ctx.store.organizations.get(ctx.organizationId);
  const orgName = org?.name ?? "Company";
  const today = new Date().toISOString().slice(0, 10);
  const title = input.title ?? `${studioId} ${input.kind}`;
  const d = input.data ?? {};

  switch (`${studioId}/${input.kind}`) {
    case "document/invoice": {
      const items = rows(d.items);
      const total = items.reduce(
        (n, r) => n + Number(r.qty ?? 1) * Number(r.unitPrice ?? 0),
        0,
      );
      const lines = items
        .map(
          (r) =>
            `| ${str(r.description, "Item")} | ${Number(r.qty ?? 1)} | $${Number(r.unitPrice ?? 0).toFixed(2)} | $${(Number(r.qty ?? 1) * Number(r.unitPrice ?? 0)).toFixed(2)} |`,
        )
        .join("\n");
      return {
        kind: input.kind,
        title,
        mimeType: "text/markdown",
        tags: ["invoice", "finance"],
        content: `# Invoice — ${orgName}\n\nDate: ${today}\nBill to: ${str(d.billTo, "—")}\nInvoice #: ${str(d.number, "INV-0001")}\n\n| Description | Qty | Unit | Amount |\n|---|---|---|---|\n${lines}\n\n**Total: $${total.toFixed(2)}**\n`,
      };
    }
    case "document/meeting_minutes":
      return {
        kind: input.kind,
        title,
        mimeType: "text/markdown",
        tags: ["minutes"],
        content: `# Meeting minutes — ${title}\n\nDate: ${today}\nAttendees: ${str(d.attendees, "—")}\n\n## Notes\n${str(d.notes, "—")}\n\n## Decisions\n${str(d.decisions, "—")}\n\n## Action items\n${str(d.actions, "—")}\n`,
      };
    case "document/sop":
      return {
        kind: input.kind,
        title,
        mimeType: "text/markdown",
        tags: ["sop"],
        content: `# SOP — ${title}\n\nOwner: ${str(d.owner, orgName)}\nEffective: ${today}\n\n## Purpose\n${str(d.purpose, "—")}\n\n## Procedure\n${str(d.steps, "—")}\n\n## Escalation\n${str(d.escalation, "Escalate to your manager.")}\n`,
      };
    case "financial/spend_report": {
      const { perEmployeeUsage, round6 } = await import("../metrics.js");
      const [employees, usage] = await Promise.all([
        ctx.store.employees.list((e) => e.organizationId === ctx.organizationId),
        perEmployeeUsage(ctx.store, ctx.organizationId),
      ]);
      const body = employees
        .map((e) => {
          const u = usage.get(e.id);
          return `| ${e.name} | ${e.title} | ${u?.requests ?? 0} | $${round6(u?.estCostUsd ?? 0)} |`;
        })
        .join("\n");
      const total = round6([...usage.values()].reduce((n, u) => n + u.estCostUsd, 0));
      return {
        kind: input.kind,
        title: input.title ?? `AI spend report ${today}`,
        mimeType: "text/markdown",
        tags: ["finance", "report"],
        content: `# AI spend report — ${orgName}\n\nGenerated ${today} from recorded usage. Costs are list-price estimates.\n\n| Employee | Role | Requests | Est. cost |\n|---|---|---|---|\n${body}\n\n**Total estimated spend: $${total}**\n`,
      };
    }
    case "financial/vat_return": {
      const { engineFor, trialBalance, ACCOUNTING_SAFEGUARD } = await import("@wankong/core");
      const engine = engineFor(str(d.jurisdiction) || (org?.settings.jurisdiction ?? "US")) ?? engineFor("US")!;
      const entries = await ctx.store.journalEntries.list((e) => e.organizationId === ctx.organizationId);
      const tb = trialBalance(engine, entries);
      const revenue = tb.filter((a) => a.type === "revenue").reduce((n, a) => n + a.balance, 0);
      const vatPayable = tb.find((a) => a.code === "2200")?.balance ?? 0;
      if (engine.vatRate === null) {
        return { kind: input.kind, title, mimeType: "text/markdown", tags: ["accounting", "tax"], content: `# ${engine.vatName} note — ${orgName}

${engine.country} has no national VAT; indirect tax is sub-national. Consult the engine notes:
${engine.notes.map((n) => `- ${n}`).join("\n")}

> ${ACCOUNTING_SAFEGUARD}
` };
      }
      return {
        kind: input.kind,
        title: input.title ?? `${engine.vatName} return — ${today}`,
        mimeType: "text/markdown",
        tags: ["accounting", "tax", engine.code.toLowerCase()],
        content: `# ${engine.vatName} return — ${orgName}

Jurisdiction: ${engine.country} (${engine.standard})
Official filing language: ${engine.language} · Currency: ${engine.currency}
Period generated: ${today}

| Line | Amount (${engine.currency}) |
|---|---|
| Taxable revenue (recorded) | ${revenue.toFixed(2)} |
| ${engine.vatName} at ${(engine.vatRate * 100).toFixed(0)}% (expected) | ${(revenue * engine.vatRate).toFixed(2)} |
| ${engine.vatName} payable (ledger 2200) | ${Math.abs(vatPayable).toFixed(2)} |

${Math.abs(Math.abs(vatPayable) - revenue * engine.vatRate) > 0.5 ? "**⚠ Ledger VAT differs from the expected rate — review before filing.**\n\n" : ""}> ${ACCOUNTING_SAFEGUARD}
`,
      };
    }
    case "financial/trial_balance": {
      const { engineFor, trialBalance, ACCOUNTING_SAFEGUARD } = await import("@wankong/core");
      const engine = engineFor(org?.settings.jurisdiction ?? "US") ?? engineFor("US")!;
      const entries = await ctx.store.journalEntries.list((e) => e.organizationId === ctx.organizationId);
      const tb = trialBalance(engine, entries).filter((a) => a.debit !== 0 || a.credit !== 0);
      const body = tb.map((a) => `| ${a.code} | ${a.name} | ${a.debit.toFixed(2)} | ${a.credit.toFixed(2)} |`).join("\n");
      return { kind: input.kind, title: input.title ?? `Trial balance ${today}`, mimeType: "text/markdown", tags: ["accounting"], content: `# Trial balance — ${orgName} (${engine.currency}, ${engine.standard})

| Code | Account | Debit | Credit |
|---|---|---|---|
${body}

> ${ACCOUNTING_SAFEGUARD}
` };
    }
    case "legal/nda":
      return {
        kind: input.kind,
        title,
        mimeType: "text/markdown",
        tags: ["legal", "draft"],
        content: `# Mutual Non-Disclosure Agreement (DRAFT)\n\n> DRAFT for review by a qualified legal professional in ${str(d.jurisdiction, "your jurisdiction")}. Not legal advice.\n\nBetween **${orgName}** and **${str(d.counterparty, "Counterparty")}**, effective ${today}.\n\n1. **Confidential Information.** Non-public information disclosed by either party.\n2. **Obligations.** Use only for ${str(d.purpose, "the evaluated business relationship")}; protect with reasonable care; no disclosure to third parties.\n3. **Exclusions.** Information that is public, independently developed, or lawfully received.\n4. **Term.** ${str(d.termYears, "3")} years from the effective date.\n5. **Governing law.** ${str(d.jurisdiction, "[jurisdiction]")}.\n`,
      };
    case "design/business_card":
    case "design/social_banner":
    case "design/logo_monogram": {
      const brand = await brandOf(ctx);
      const name = str(d.name, orgName);
      const sub = str(d.subtitle, brand.tagline ?? "");
      const [w, h] =
        input.kind === "business_card" ? [350, 200] : input.kind === "social_banner" ? [1200, 630] : [240, 240];
      const monogram = name
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("");
      const inner =
        input.kind === "logo_monogram"
          ? `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2 - 8}" fill="${brand.colors.primary}"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="${esc(brand.font)}" font-size="${w / 3}" font-weight="700" fill="#fff">${esc(monogram)}</text>`
          : `<rect width="100%" height="100%" fill="${brand.colors.secondary}"/><rect x="0" y="0" width="10" height="100%" fill="${brand.colors.primary}"/><text x="${w * 0.08}" y="${h * 0.45}" font-family="${esc(brand.font)}" font-size="${h * 0.12}" font-weight="700" fill="#fff">${esc(name)}</text><text x="${w * 0.08}" y="${h * 0.62}" font-family="${esc(brand.font)}" font-size="${h * 0.07}" fill="${brand.colors.accent}">${esc(sub)}</text>`;
      return {
        kind: input.kind,
        title,
        mimeType: "image/svg+xml",
        tags: ["design", "brand"],
        content: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`,
      };
    }
    case "cad/floor_plan": {
      const spaces = rows(d.rooms);
      const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, spaces.length))));
      const cell = 160;
      const width = cols * cell + 40;
      const height = Math.ceil(Math.max(1, spaces.length) / cols) * cell + 40;
      const roomsSvg = spaces
        .map((r, i) => {
          const x = 20 + (i % cols) * cell;
          const y = 20 + Math.floor(i / cols) * cell;
          return `<g><rect x="${x}" y="${y}" width="${cell - 10}" height="${cell - 10}" fill="none" stroke="#333" stroke-width="2"/><text x="${x + 10}" y="${y + 24}" font-size="13" font-family="sans-serif">${esc(str(r.name, `Room ${i + 1}`))}</text><text x="${x + 10}" y="${y + 42}" font-size="11" fill="#666" font-family="sans-serif">${esc(str(r.size, ""))}</text></g>`;
        })
        .join("");
      return {
        kind: input.kind,
        title,
        mimeType: "image/svg+xml",
        tags: ["cad", "plan"],
        content: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/>${roomsSvg}</svg>`,
      };
    }
    case "website/landing_page": {
      const brand = await brandOf(ctx);
      const headline = str(d.headline, orgName);
      const subline = str(d.subline, brand.tagline ?? "");
      const cta = str(d.cta, "Get started");
      return {
        kind: input.kind,
        title,
        mimeType: "text/html",
        tags: ["website"],
        content: `<section style="font-family:${esc(brand.font)};background:${brand.colors.secondary};color:#fff;padding:80px 24px;text-align:center"><h1 style="font-size:44px;margin:0">${esc(headline)}</h1><p style="font-size:18px;color:${brand.colors.accent}">${esc(subline)}</p><a href="#" style="display:inline-block;margin-top:24px;background:${brand.colors.primary};color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none">${esc(cta)}</a></section>`,
      };
    }
    case "conversion/md_to_html": {
      const md = str(d.source);
      const html = md
        .replace(/^### (.*)$/gm, "<h3>$1</h3>")
        .replace(/^## (.*)$/gm, "<h2>$1</h2>")
        .replace(/^# (.*)$/gm, "<h1>$1</h1>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n{2,}/g, "\n<br/>\n");
      return { kind: input.kind, title, mimeType: "text/html", tags: ["conversion"], content: html };
    }
    case "conversion/csv_to_json": {
      const [head, ...body] = str(d.source).trim().split(/\r?\n/);
      const keys = (head ?? "").split(",").map((k) => k.trim());
      const json = body.map((line) => {
        const vals = line.split(",");
        return Object.fromEntries(keys.map((k, i) => [k, (vals[i] ?? "").trim()]));
      });
      return {
        kind: input.kind,
        title,
        mimeType: "application/json",
        tags: ["conversion"],
        content: JSON.stringify(json, null, 2),
      };
    }
    default:
      throw new StudioError(
        `Studio "${studioId}" has no builtin generator for kind "${input.kind}". Connector-tier capabilities activate via the Integration Hub.`,
      );
  }
}

export class StudioError extends Error {}
