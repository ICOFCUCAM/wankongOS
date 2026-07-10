import { z } from "zod";

const Id = z.string().min(1).max(80);
const Timestamp = z.string().datetime();

/**
 * Production Studios (ADR-0021): WankongOS as an orchestration layer.
 *
 * Each studio is a catalog entry with an honest availability tier:
 *   builtin    — works today, server-side, no external service
 *   connector  — declared capability that activates when a matching
 *                integration/connector is configured (never faked)
 */
export type StudioAvailability = "builtin" | "connector";

export interface StudioDef {
  id: string;
  name: string;
  tagline: string;
  capabilities: string[];
  formats: string[];
  availability: StudioAvailability;
  /** Integration kinds/providers that light this studio up (connector tier). */
  connectors?: string[];
  requiredPermission: string;
}

export const STUDIOS: StudioDef[] = [
  { id: "document", name: "Document Studio", tagline: "Contracts, proposals, reports, invoices, SOPs.", capabilities: ["invoice", "report", "meeting_minutes", "sop", "proposal", "letter"], formats: ["md", "html", "csv"], availability: "builtin", requiredPermission: "task:create" },
  { id: "design", name: "Design Studio", tagline: "Brand-driven graphics, cards, banners, monograms.", capabilities: ["business_card", "social_banner", "logo_monogram", "poster"], formats: ["svg"], availability: "builtin", requiredPermission: "task:create" },
  { id: "video", name: "Video Studio", tagline: "Commercials, explainers, shorts.", capabilities: ["commercial", "explainer", "short"], formats: ["mp4"], availability: "connector", connectors: ["runway", "veo", "pika", "kling", "luma"], requiredPermission: "task:create" },
  { id: "audio", name: "Audio Studio", tagline: "Narration, podcasts, sound.", capabilities: ["narration", "podcast", "music"], formats: ["mp3", "wav"], availability: "connector", connectors: ["elevenlabs", "openai-audio"], requiredPermission: "task:create" },
  { id: "website", name: "Website Studio", tagline: "Landing pages and sites, deploy-ready.", capabilities: ["landing_page"], formats: ["html"], availability: "builtin", requiredPermission: "task:create" },
  { id: "engineering", name: "Software Engineering Studio", tagline: "Code, tests, docs, pull requests.", capabilities: ["code_generation", "code_review"], formats: ["md"], availability: "connector", connectors: ["github", "mcp"], requiredPermission: "task:create" },
  { id: "publishing", name: "Publishing Studio", tagline: "Schedule and publish where APIs allow.", capabilities: ["schedule_post", "publish"], formats: [], availability: "connector", connectors: ["linkedin", "x", "wordpress", "ghost", "slack"], requiredPermission: "task:create" },
  { id: "printing", name: "Printing Studio", tagline: "Print-ready assets with marks.", capabilities: ["flyer", "poster", "label"], formats: ["svg", "pdf"], availability: "connector", connectors: ["print-render"], requiredPermission: "task:create" },
  { id: "cad", name: "CAD / Architecture Studio", tagline: "Floor plans and layouts, parametric.", capabilities: ["floor_plan", "warehouse_layout"], formats: ["svg"], availability: "builtin", requiredPermission: "task:create" },
  { id: "financial", name: "Financial Studio", tagline: "P&L, spend reports, forecasts from records.", capabilities: ["spend_report", "pnl_snapshot"], formats: ["md", "csv"], availability: "builtin", requiredPermission: "org:read" },
  { id: "legal", name: "Legal Studio", tagline: "Contract & policy drafts for professional review.", capabilities: ["nda", "privacy_policy", "terms_of_service"], formats: ["md"], availability: "builtin", requiredPermission: "task:create" },
  { id: "knowledge", name: "Knowledge Studio", tagline: "Ingest, embed, and search everything (RAG).", capabilities: ["ingest", "semantic_search", "citations"], formats: ["md", "html", "txt"], availability: "builtin", requiredPermission: "knowledge:read" },
  { id: "research", name: "Research Studio", tagline: "Browse and synthesize external information.", capabilities: ["competitor_research", "market_analysis"], formats: ["md"], availability: "connector", connectors: ["web-search", "mcp"], requiredPermission: "knowledge:read" },
  { id: "brand", name: "Brand Studio", tagline: "One brand kit every employee uses automatically.", capabilities: ["brand_kit", "tone_of_voice"], formats: ["json", "svg"], availability: "builtin", requiredPermission: "org:read" },
  { id: "conversion", name: "File Conversion Studio", tagline: "Markdown ↔ HTML, CSV ↔ JSON, and more.", capabilities: ["md_to_html", "html_to_md", "csv_to_json", "json_to_csv"], formats: ["md", "html", "csv", "json"], availability: "builtin", requiredPermission: "task:create" },
  { id: "assets", name: "Asset Management Studio", tagline: "Versioned, tagged, searchable company assets.", capabilities: ["store", "version", "tag", "search", "preview"], formats: ["*"], availability: "builtin", requiredPermission: "org:read" },
];

/** A produced or uploaded company asset. Content is stored inline (text formats) for the builtin tier. */
export const Asset = z.object({
  id: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  organizationId: Id,
  studioId: z.string().min(1).max(40),
  kind: z.string().min(1).max(60),
  title: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(100),
  /** Inline content for text formats (md/html/svg/csv/json). */
  content: z.string().max(500_000),
  version: z.number().int().positive().default(1),
  tags: z.array(z.string().max(40)).default([]),
  createdBy: z.object({ kind: z.enum(["user", "employee"]), id: Id }),
});
export type Asset = z.infer<typeof Asset>;

export const BrandKit = z.object({
  id: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  organizationId: Id,
  colors: z.object({
    primary: z.string().default("#6d5efc"),
    secondary: z.string().default("#12141c"),
    accent: z.string().default("#33c481"),
  }),
  font: z.string().default("Inter, system-ui, sans-serif"),
  toneOfVoice: z.string().max(2000).default("Professional, clear, and confident."),
  tagline: z.string().max(200).optional(),
  /** Asset id of the current logo, when one exists. */
  logoAssetId: Id.optional(),
});
export type BrandKit = z.infer<typeof BrandKit>;
