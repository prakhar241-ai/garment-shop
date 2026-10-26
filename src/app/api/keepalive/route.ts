import { createAdminClient } from "@/lib/supabase/admin";

// Called once a day by Vercel Cron (vercel.json). The free Supabase plan pauses
// a database after about a week without activity, which takes the app down;
// one tiny query a day prevents that. Only Vercel's cron, which sends
// CRON_SECRET, may call it.
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { error } = await createAdminClient().from("shops").select("id", { head: true, count: "exact" });
  return Response.json({ ok: !error, at: new Date().toISOString() }, { status: error ? 500 : 200 });
}
