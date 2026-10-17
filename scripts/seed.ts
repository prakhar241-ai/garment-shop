// Create the demo shop with an owner, one staff member, 5 categories and 30
// products with sizes. Safe to re-run: it does nothing if the demo shop exists.
//   npm run db:seed
import { createClient } from "@supabase/supabase-js";
import { suggestSellingPrice } from "../src/lib/pricing.ts";
import { SIZES } from "../src/lib/sizes.ts";
import { DEMO_CATEGORIES, demoStock } from "./seed-data.ts";

export const DEMO = {
  shopCode: "S1",
  shopName: { hi: "डेमो गारमेंट्स", en: "Demo Garments" },
  owner: { name: { hi: "मालिक (डेमो)", en: "Owner (Demo)" }, phone: "9000000001", pin: "123456" },
  staff: { name: { hi: "स्टाफ (डेमो)", en: "Staff (Demo)" }, phone: "9000000002", pin: "654321" },
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const email = (phone: string) => `p${phone}@phone-login.example.com`;

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>, what: string): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${JSON.stringify(error)}`);
  return data as NonNullable<T>;
}

async function createUser(phone: string, pin: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(phone),
    password: pin,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`create user ${phone}: ${error?.message}`);
  return data.user.id;
}

async function main() {
  const { data: existing } = await admin.from("shops").select("id").eq("code", DEMO.shopCode).maybeSingle();
  if (existing) {
    console.log("Demo shop already exists, nothing to do.");
    return;
  }

  const ownerId = await createUser(DEMO.owner.phone, DEMO.owner.pin);
  const staffId = await createUser(DEMO.staff.phone, DEMO.staff.pin);

  const shop = await must(
    admin
      .from("shops")
      .insert({
        name: DEMO.shopName.hi,
        name_hi: DEMO.shopName.hi,
        name_en: DEMO.shopName.en,
        code: DEMO.shopCode, owner_id: ownerId, created_by: ownerId })
      .select("id")
      .single(),
    "create shop",
  );

  await must(
    admin.from("profiles").insert([
      { id: ownerId, shop_id: shop.id, ...pick(DEMO.owner), role: "owner", created_by: ownerId },
      { id: staffId, shop_id: shop.id, ...pick(DEMO.staff), role: "staff", created_by: ownerId },
    ]),
    "create profiles",
  );

  let seq = 0;
  let productIndex = 0;
  for (const [sortOrder, cat] of DEMO_CATEGORIES.entries()) {
    const category = await must(
      admin
        .from("categories")
        .insert({
          shop_id: shop.id,
          name_hi: cat.name_hi,
          name_en: cat.name_en,
          size_type: cat.size_type,
          default_markup_percent: cat.markup,
          default_min_stock: cat.min_stock,
          sort_order: sortOrder,
          created_by: ownerId,
        })
        .select("id")
        .single(),
      `category ${cat.key}`,
    );

    for (const p of cat.products) {
      const product = await must(
        admin
          .from("products")
          .insert({
            shop_id: shop.id,
            category_id: category.id,
            name: p.name_hi,
            name_hi: p.name_hi,
            name_en: p.name_en,
            color: p.color,
            created_by: ownerId,
          })
          .select("id")
          .single(),
        `product ${p.name_en}`,
      );

      const cost = p.cost * 100;
      const price = suggestSellingPrice(cost, cat.markup, "49_99");
      const variants = SIZES[cat.size_type].map((size, i) => ({
        shop_id: shop.id,
        product_id: product.id,
        size,
        barcode: `${DEMO.shopCode}-${String(++seq).padStart(5, "0")}`,
        cost_price: cost,
        selling_price: price,
        stock_qty: demoStock(productIndex * 4 + i),
        min_stock: cat.min_stock,
        created_by: ownerId,
      }));
      await must(admin.from("variants").insert(variants), `variants ${p.name_en}`);
      productIndex++;
    }
  }

  await must(admin.from("shops").update({ barcode_seq: seq }).eq("id", shop.id), "barcode seq");
  console.log(`Demo shop created: ${productIndex} products, ${seq} variants.`);
  console.log(`  Owner: ${DEMO.owner.phone} / PIN ${DEMO.owner.pin}`);
  console.log(`  Staff: ${DEMO.staff.phone} / PIN ${DEMO.staff.pin}`);
}

function pick(u: { name: { hi: string; en: string }; phone: string }) {
  return { name: u.name.hi, name_hi: u.name.hi, name_en: u.name.en, phone: u.phone, language: "hi" };
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
