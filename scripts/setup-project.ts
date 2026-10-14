// One-time: create the Supabase project (Mumbai region, free plan), wait for it
// to come up, and write its URL and keys to .env.local.
//   npm run db:setup
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { mgmt } from "./mgmt.ts";

const NAME = "garment-shop";
const REGION = "ap-south-1"; // Mumbai, closest to the shop

type Org = { id: string; slug?: string; name: string };
type Project = { id: string; ref?: string; name: string; status: string; region: string };
type ApiKey = { name: string; api_key: string };

async function main() {
  const projects = await mgmt<Project[]>("/projects");
  let project = projects.find((p) => p.name === NAME);

  if (!project) {
    const orgs = await mgmt<Org[]>("/organizations");
    if (orgs.length === 0) throw new Error("No Supabase organization found. Create one at supabase.com first.");
    const org = orgs[0];
    const dbPass = randomBytes(24).toString("base64url");
    console.log(`Creating project "${NAME}" in ${REGION} under org "${org.name}"...`);
    project = await mgmt<Project>("/projects", {
      method: "POST",
      body: JSON.stringify({
        name: NAME,
        organization_id: org.slug ?? org.id,
        region: REGION,
        db_pass: dbPass,
        plan: "free",
      }),
    });
    // Keep the DB password somewhere private in case it is ever needed.
    appendFileSync(".env.supabase", `SUPABASE_DB_PASSWORD=${dbPass}\n`);
  } else {
    console.log(`Project "${NAME}" already exists.`);
  }

  const ref = project.ref ?? project.id;
  process.stdout.write("Waiting for the database to be ready");
  for (let i = 0; i < 90; i++) {
    const p = await mgmt<Project>(`/projects/${ref}`);
    if (p.status === "ACTIVE_HEALTHY") break;
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log(" ready.");

  const keys = await mgmt<ApiKey[]>(`/projects/${ref}/api-keys?reveal=true`);
  const anon = keys.find((k) => k.name === "anon")?.api_key;
  const service = keys.find((k) => k.name === "service_role")?.api_key;
  if (!anon || !service) throw new Error("Could not read the project's API keys.");

  const env = [
    `NEXT_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}`,
    `SUPABASE_SERVICE_ROLE_KEY=${service}`,
    "",
  ].join("\n");
  writeFileSync(".env.local", env);

  const supa = existsSync(".env.supabase") ? readFileSync(".env.supabase", "utf8") : "";
  if (!supa.includes("SUPABASE_PROJECT_REF=")) appendFileSync(".env.supabase", `SUPABASE_PROJECT_REF=${ref}\n`);

  // Phone + PIN login uses email/password behind the scenes. Turn off
  // self-signup so only owners (through the app) can create accounts.
  await mgmt(`/projects/${ref}/config/auth`, {
    method: "PATCH",
    body: JSON.stringify({ disable_signup: true, mailer_autoconfirm: true, password_min_length: 6 }),
  });

  console.log(`Done. Project ref ${ref}; keys written to .env.local.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
