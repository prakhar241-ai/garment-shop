// Tiny client for the Supabase Management API, used by the setup and migrate
// scripts. Needs SUPABASE_ACCESS_TOKEN (in .env.supabase, never committed).

const API = "https://api.supabase.com/v1";

export async function mgmt<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is missing (put it in .env.supabase)");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

export function projectRef(): string {
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!ref) throw new Error("SUPABASE_PROJECT_REF is missing (run npm run db:setup first)");
  return ref;
}

/** Run SQL as the database owner. */
export async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  return mgmt<T[]>(`/projects/${projectRef()}/database/query`, {
    method: "POST",
    body: JSON.stringify({ query }),
  });
}
