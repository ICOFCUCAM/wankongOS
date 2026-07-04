import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { output, ZodTypeAny } from "zod";
import type { Permission } from "@wankong/core";
import type { Env } from "./context.js";

/** Assert the current actor holds a permission, else 403. */
export function authorize(c: Context<Env>, permission: Permission): void {
  const actor = c.get("actor");
  if (!actor.permissions.has(permission)) {
    throw new HTTPException(403, { message: `Missing permission: ${permission}` });
  }
}

/** Parse and validate a JSON body against a schema, else 400 with details. */
export async function parseBody<S extends ZodTypeAny>(
  c: Context<Env>,
  schema: S,
): Promise<output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON body" });
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HTTPException(400, {
      message: "Validation failed",
      cause: result.error.flatten(),
    });
  }
  return result.data;
}

/** Fetch an entity scoped to the actor's organization, else 404. */
export async function findScoped<T extends { organizationId: string }>(
  c: Context<Env>,
  loader: (id: string) => Promise<T | null>,
  id: string,
): Promise<T> {
  const entity = await loader(id);
  const orgId = c.get("ctx").organizationId;
  if (!entity || entity.organizationId !== orgId) {
    throw new HTTPException(404, { message: "Not found" });
  }
  return entity;
}
