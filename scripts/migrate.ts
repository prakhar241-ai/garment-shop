// Apply any SQL files in supabase/migrations that have not run yet, in name order.
//   npm run db:migrate
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "./mgmt.ts";

const DIR = "supabase/migrations";

async function main() {
  await sql(`
    create schema if not exists ops;
    create table if not exists ops.migrations (name text primary key, applied_at timestamptz default now());
  `);
  const done = new Set((await sql<{ name: string }>("select name from ops.migrations")).map((r) => r.name));

  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    console.log(`Applying ${file}...`);
    const body = readFileSync(join(DIR, file), "utf8");
    // One request = one transaction, so a failing file leaves nothing half-done.
    await sql(`begin;\n${body}\ninsert into ops.migrations (name) values ('${file}');\ncommit;`);
  }
  console.log("Migrations up to date.");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
