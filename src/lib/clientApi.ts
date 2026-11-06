export class ApiError extends Error {
  code: string;
  hint: string | null;
  constructor(message: string, code = "INTERNAL", hint: string | null = null) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

export async function api<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Network error. Check your connection and try again.", "NETWORK");
  }
  const json = (await res.json().catch(() => null)) as
    | { error?: { code?: string; message?: string; hint?: string | null } }
    | null;
  if (!res.ok) {
    throw new ApiError(json?.error?.message ?? "Request failed.", json?.error?.code, json?.error?.hint ?? null);
  }
  return json as T;
}
