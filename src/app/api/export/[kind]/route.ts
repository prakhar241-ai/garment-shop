import { getLocale, getTranslations } from "next-intl/server";
import { toCsv, rupees, type Cell } from "@/lib/csv";
import { formatDate } from "@/lib/money";
import { localName } from "@/lib/names";
import { resolvePeriod } from "@/lib/period";
import { buildOrders, type ReorderRow } from "@/lib/reorder";
import { sizeLabel } from "@/lib/sizes";
import { createClient } from "@/lib/supabase/server";

const KINDS = ["sales", "daily", "categories", "products", "stock", "udhaar", "purchases", "closes", "reorder"] as const;
type Kind = (typeof KINDS)[number];

/**
 * Owner-only CSV downloads: /api/export/<kind>?p=7d | p=custom&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Everything goes through the owner-only report functions or views, so a
 * staff login gets a 403 here and empty results from the database anyway.
 */
export async function GET(req: Request, { params }: RouteContext<"/api/export/[kind]">) {
  const { kind } = await params;
  if (!KINDS.includes(kind as Kind)) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role, active").eq("id", user.id).single();
  if (me?.role !== "owner" || !me.active) return new Response("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const p = resolvePeriod(url.searchParams.get("p") ?? "30d", url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
  const t = await getTranslations("csv");
  const tAll = await getTranslations();
  const locale = await getLocale();
  const range = { p_from: p.from, p_to: p.to };

  let headers: string[] = [];
  let rows: Cell[][] = [];
  let ranged = true;

  switch (kind as Kind) {
    case "sales": {
      const { data } = await supabase.rpc("report_sale_lines", range);
      headers = [t("date"), t("time"), t("bill"), t("mode"), t("customer"), t("staff"), t("barcode"), t("product"), t("category"), t("size"), t("qty"), t("price"), t("lineTotal"), t("billDiscount"), t("cost")];
      const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
      rows = (data ?? []).map((r: Record<string, never>) => [
        formatDate(r.sold_at),
        time.format(new Date(r.sold_at)),
        String(r.sale_id).slice(0, 8),
        t(r.payment_mode),
        r.customer,
        r.staff,
        r.barcode,
        localName({ name: r.product, name_hi: r.product_hi, name_en: r.product_en }, locale),
        localName({ name_hi: r.category_hi, name_en: r.category_en }, locale),
        r.size ? sizeLabel(r.size, tAll) : "",
        r.qty,
        rupees(r.price),
        rupees(r.line_total),
        rupees(r.bill_discount),
        rupees(r.cost),
      ]);
      break;
    }
    case "daily": {
      const { data } = await supabase.rpc("report_sales", { ...range, p_grain: "day" });
      headers = [t("date"), t("bills"), t("gross"), t("returns"), t("discounts"), t("net"), t("cost"), t("margin")];
      rows = (data ?? []).map((r: Record<string, never>) => [
        formatDate(`${r.bucket}T12:00:00+05:30`),
        r.bills,
        rupees(r.gross),
        rupees(r.returns),
        rupees(r.discounts),
        rupees(r.net),
        rupees(r.cost),
        rupees(r.margin),
      ]);
      break;
    }
    case "categories": {
      const { data } = await supabase.rpc("report_categories", range);
      headers = [t("category"), t("qty"), t("net"), t("cost"), t("margin"), t("marginPct")];
      rows = (data ?? []).map((r: Record<string, never>) => [
        localName(r, locale),
        r.qty,
        rupees(r.net),
        rupees(r.cost),
        rupees(r.margin),
        Number(r.net) > 0 ? ((Number(r.margin) / Number(r.net)) * 100).toFixed(1) : "",
      ]);
      break;
    }
    case "products": {
      const { data } = await supabase.rpc("report_products", range);
      headers = [t("product"), t("sold"), t("net"), t("stock"), t("lastSold")];
      rows = (data ?? [])
        .toSorted((a: { sold: number }, b: { sold: number }) => b.sold - a.sold)
        .map((r: Record<string, never>) => [localName(r, locale), r.sold, rupees(r.net), r.stock, r.last_sold ? formatDate(`${r.last_sold}T12:00:00+05:30`) : ""]);
      break;
    }
    case "stock": {
      ranged = false;
      const { data } = await supabase.rpc("report_stock");
      headers = [t("barcode"), t("product"), t("category"), t("size"), t("stock"), t("minStock"), t("price"), t("cost"), t("costValue"), t("saleValue")];
      rows = (data ?? []).map((r: Record<string, never>) => [
        r.barcode,
        localName({ name: r.product, name_hi: r.name_hi, name_en: r.name_en }, locale),
        localName({ name_hi: r.category_hi, name_en: r.category_en }, locale),
        sizeLabel(r.size, tAll),
        r.stock,
        r.min_stock,
        rupees(r.selling_price),
        rupees(r.cost_price),
        rupees(r.cost_value),
        rupees(r.sale_value),
      ]);
      break;
    }
    case "udhaar": {
      ranged = false;
      const { data } = await supabase
        .from("customer_aging")
        .select("name, phone, outstanding, oldest_unpaid, last_payment")
        .order("outstanding", { ascending: false });
      headers = [t("customer"), t("phone"), t("outstanding"), t("since"), t("lastPayment")];
      rows = (data ?? []).map((r) => [
        r.name,
        r.phone,
        rupees(r.outstanding),
        r.oldest_unpaid ? formatDate(r.oldest_unpaid) : "",
        r.last_payment ? formatDate(r.last_payment) : "",
      ]);
      break;
    }
    case "purchases": {
      const [{ data }, { data: sups }] = await Promise.all([
        supabase
          .from("owner_purchases")
          .select("bill_date, bill_number, supplier_id, total, amount_paid, payment_mode")
          .gte("bill_date", p.from)
          .lte("bill_date", p.to)
          .is("deleted_at", null)
          .order("bill_date"),
        supabase.from("suppliers").select("id, name"),
      ]);
      const name = new Map((sups ?? []).map((s) => [s.id, s.name]));
      headers = [t("date"), t("supplier"), t("billNumber"), t("total"), t("paid"), t("due")];
      rows = (data ?? []).map((r) => [
        formatDate(`${r.bill_date}T12:00:00+05:30`),
        name.get(r.supplier_id),
        r.bill_number,
        rupees(r.total),
        rupees(r.amount_paid),
        rupees(r.total - r.amount_paid),
      ]);
      break;
    }
    case "reorder": {
      ranged = false;
      const days = [14, 30, 60].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
      const { data } = await supabase.rpc("reorder_rows", { p_days: days });
      headers = [t("supplier"), t("phone"), t("product"), t("size"), t("orderQty"), t("sold"), t("stock"), t("minStock")];
      rows = buildOrders((data ?? []) as ReorderRow[]).flatMap((o) =>
        o.items.flatMap((item) =>
          item.lines.map((l) => [
            o.supplier ?? "",
            o.phone ?? "",
            localName({ name: item.row.product, name_hi: item.row.product_hi, name_en: item.row.product_en }, locale),
            sizeLabel(l.size, tAll),
            l.qty,
            l.sold,
            l.stock,
            l.min,
          ]),
        ),
      );
      break;
    }
    case "closes": {
      const { data } = await supabase
        .from("daily_closes")
        .select("close_date, opening_cash, cash_out, expected_cash, counted_cash, difference, left_in_drawer, summary, notes")
        .gte("close_date", p.from)
        .lte("close_date", p.to)
        .order("close_date");
      headers = [t("date"), t("cash"), t("upi"), t("udhaar"), t("udhaarCash"), t("udhaarUpi"), t("discounts"), t("opening"), t("cashOut"), t("expected"), t("counted"), t("difference"), t("left"), t("notes")];
      rows = (data ?? []).map((r) => [
        formatDate(`${r.close_date}T12:00:00+05:30`),
        rupees(r.summary.cash),
        rupees(r.summary.upi),
        rupees(r.summary.udhaar_sales),
        rupees(r.summary.udhaar_collected_cash),
        rupees(r.summary.udhaar_collected_upi),
        rupees(r.summary.discounts),
        rupees(r.opening_cash),
        rupees(r.cash_out),
        rupees(r.expected_cash),
        rupees(r.counted_cash),
        rupees(r.difference),
        rupees(r.left_in_drawer),
        r.notes,
      ]);
      break;
    }
  }

  const name = ranged ? `${kind}_${p.from}_${p.to}.csv` : `${kind}_${p.to}.csv`;
  return new Response(toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
