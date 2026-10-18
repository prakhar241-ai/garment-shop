// Create (or re-PIN) the master user who runs the master panel.
//   npm run admin:create -- 9876543210
// Prints a new random 6-digit PIN once. Run it again to set a fresh PIN.
import { randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { normalizePhone, phoneToAuthEmail } from "../src/lib/phone.ts";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function main() {
  const phone = normalizePhone(process.argv[2] ?? "");
  if (!phone) throw new Error("Usage: npm run admin:create -- <10-digit mobile number>");

  const { data: shopUser } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle();
  if (shopUser) throw new Error("This number already logs in to a shop. Use a different number for the master login.");

  const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const email = phoneToAuthEmail(phone);
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let id = list?.users.find((u) => u.email === email)?.id;
  if (id) {
    const { error } = await admin.auth.admin.updateUserById(id, { password: pin });
    if (error) throw error;
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, password: pin, email_confirm: true });
    if (error) throw error;
    id = data.user.id;
  }
  const { error } = await admin.from("platform_admins").upsert({ user_id: id, name: "Master" });
  if (error) throw error;
  console.log(`Master login ready.\n  Phone: ${phone}\n  PIN:   ${pin}\n(Shown once. Change it in the master panel.)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
