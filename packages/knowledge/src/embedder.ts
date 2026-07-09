/**
 * Embedding abstraction, mirroring the AI-provider abstraction: one interface,
 * a hermetic local implementation that always works, and cloud seams.
 */
export interface Embedder {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Deterministic, dependency-free embedder using hashed term frequencies over
 * word unigrams+bigrams, L2-normalised.
 *
 * This is honest lexical similarity, not learned semantics: texts sharing
 * vocabulary land near each other, paraphrases without shared terms won't.
 * It makes retrieval, citations, and ranking fully functional offline and in
 * CI; swap in a cloud embedder (e.g. `OpenAIEmbedder`) for true semantic
 * matching without changing any caller.
 */
export class LocalEmbedder implements Embedder {
  readonly id = "local-hash-v1";
  readonly dimensions: number;

  constructor(dimensions = 512) {
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = tokenize(text);
    for (let i = 0; i < tokens.length; i++) {
      bump(vector, tokens[i]!, this.dimensions);
      if (i + 1 < tokens.length) bump(vector, `${tokens[i]} ${tokens[i + 1]}`, this.dimensions);
    }
    return l2normalize(vector);
  }
}

export interface OpenAIEmbedderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

/** OpenAI embeddings via fetch (works with any compatible endpoint). */
export class OpenAIEmbedder implements Embedder {
  readonly id: string;
  readonly dimensions = 1536;
  private readonly baseUrl: string;

  constructor(private readonly config: OpenAIEmbedderConfig) {
    if (!config.apiKey) throw new Error("OpenAIEmbedder: apiKey is required");
    this.id = config.model ?? "text-embedding-3-small";
    this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ model: this.id, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI embeddings failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

/** Pick the best available embedder from the environment. */
export function embedderFromEnv(env: Record<string, string | undefined> = process.env): Embedder {
  if (env.OPENAI_API_KEY) return new OpenAIEmbedder({ apiKey: env.OPENAI_API_KEY });
  return new LocalEmbedder();
}

/** Cosine similarity of two same-length vectors, in [-1, 1]. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// --- internals ---------------------------------------------------------------

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "is", "are", "was", "for",
  "on", "with", "as", "by", "at", "be", "this", "that", "it", "from", "we",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/**
 * Very light stemming so trivial inflections share a vector slot
 * (refund/refunds, policy/policies). Deliberately conservative — wrong merges
 * hurt retrieval more than missed ones.
 */
function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/** FNV-1a hash of a token into a vector slot. */
function bump(vector: number[], token: string, dims: number): void {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  vector[(hash >>> 0) % dims]! += 1;
}

function l2normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((n, v) => n + v * v, 0));
  return norm === 0 ? vector : vector.map((v) => v / norm);
}
