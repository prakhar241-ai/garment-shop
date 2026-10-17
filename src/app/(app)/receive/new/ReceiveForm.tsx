"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { formatPaise, rupeesToPaise } from "@/lib/money";
import { localName } from "@/lib/names";
import { suggestSellingPrice, type RoundingRule } from "@/lib/pricing";
import { sizeLabel, sizesFor } from "@/lib/sizes";
import { receiveBill, type ReceiveError, type ReceivePayload } from "../actions";

export type FormProduct = {
  id: string;
  name: string;
  name_hi: string | null;
  name_en: string | null;
  deleted_at: string | null;
  variants: { size: string; selling_price: number; deleted_at: string | null }[];
};

export type FormCategory = {
  id: string;
  name_hi: string;
  name_en: string;
  size_type: string;
  default_markup_percent: number;
  products: FormProduct[];
};

type Supplier = { id: string; name: string; phone: string | null };

type Draft = {
  key: number;
  categoryId: string;
  productId: string | null; // null = new item
  newName: string;
  newNameOther: string;
  cost: string; // rupees as typed
  qty: Record<string, string>;
  price: string; // rupees as typed (owner only)
  priceTouched: boolean;
};

const input =
  "min-h-12 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg focus:border-brand focus:outline-none";
const bigButton = "min-h-12 rounded-xl border-2 px-3 text-base font-semibold";

export function ReceiveForm({
  suppliers,
  categories,
  rule,
  isOwner,
  locale,
  today,
}: {
  suppliers: Supplier[];
  categories: FormCategory[];
  rule: RoundingRule;
  isOwner: boolean;
  locale: string;
  today: string;
}) {
  const t = useTranslations();
  const [supplierId, setSupplierId] = useState<string>(suppliers.length ? "" : "new");
  const [newSupplier, setNewSupplier] = useState({ name: "", phone: "" });
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(today);
  const [items, setItems] = useState<Draft[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [mode, setMode] = useState<"bill" | "cash" | "mixed">("bill");
  const [paid, setPaid] = useState("");
  const [error, setError] = useState<ReceiveError | null>(null);
  const [pending, startTransition] = useTransition();
  const [nextKey, setNextKey] = useState(1);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const productById = useMemo(
    () => new Map(categories.flatMap((c) => c.products.map((p) => [p.id, p] as const))),
    [categories],
  );

  const pieces = (d: Draft) => Object.values(d.qty).reduce((s, q) => s + (parseInt(q) || 0), 0);
  const lineTotal = (d: Draft) => (rupeesToPaise(d.cost) ?? 0) * pieces(d);
  const billTotal = items.reduce((s, d) => s + lineTotal(d), 0);
  const paidPaise = mode === "cash" ? billTotal : mode === "bill" ? 0 : (rupeesToPaise(paid) ?? 0);

  function draftName(d: Draft) {
    const p = d.productId ? productById.get(d.productId) : null;
    return p ? localName(p, locale) : d.newName;
  }

  function suggestion(d: Draft): number | null {
    const cost = rupeesToPaise(d.cost);
    const cat = catById.get(d.categoryId);
    if (!cost || !cat) return null;
    return suggestSellingPrice(cost, Number(cat.default_markup_percent), rule);
  }

  function currentPrice(d: Draft): number | null {
    const p = d.productId ? productById.get(d.productId) : null;
    const live = p?.variants.filter((v) => !v.deleted_at) ?? [];
    return live.length ? live[0].selling_price : null;
  }

  function startItem() {
    setDraft({
      key: nextKey,
      categoryId: "",
      productId: null,
      newName: "",
      newNameOther: "",
      cost: "",
      qty: {},
      price: "",
      priceTouched: false,
    });
    setNextKey(nextKey + 1);
  }

  function updateDraft(patch: Partial<Draft>) {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, ...patch };
      // Owner's price box follows the current price, or the suggestion for a
      // new item, until the owner types their own.
      if (isOwner && !next.priceTouched) {
        const price = currentPrice(next) ?? suggestion(next);
        next.price = price ? String(price / 100) : "";
      }
      return next;
    });
  }

  function saveDraft() {
    if (!draft) return;
    setItems((list) => {
      const i = list.findIndex((x) => x.key === draft.key);
      return i === -1 ? [...list, draft] : list.map((x) => (x.key === draft.key ? draft : x));
    });
    setDraft(null);
  }

  function submit() {
    setError(null);
    const payload: ReceivePayload = {
      ...(supplierId && supplierId !== "new"
        ? { supplier_id: supplierId }
        : { new_supplier: { name: newSupplier.name.trim(), phone: newSupplier.phone.trim() } }),
      bill_number: billNumber,
      bill_date: billDate,
      payment_mode: mode,
      amount_paid: mode === "mixed" ? paidPaise : undefined,
      items: items.map((d) => {
        const sizes = Object.entries(d.qty)
          .map(([size, q]) => ({ size, qty: parseInt(q) || 0 }))
          .filter((s) => s.qty > 0);
        const price = isOwner ? rupeesToPaise(d.price) : null;
        return {
          ...(d.productId
            ? { product_id: d.productId }
            : {
                new_product: {
                  category_id: d.categoryId,
                  name: d.newName.trim(),
                  ...(locale === "en"
                    ? { name_en: d.newName.trim(), name_hi: d.newNameOther.trim() }
                    : { name_hi: d.newName.trim(), name_en: d.newNameOther.trim() }),
                },
              }),
          cost_price: rupeesToPaise(d.cost) ?? -1,
          ...(price !== null ? { selling_price: price } : {}),
          sizes,
        };
      }),
    };
    startTransition(async () => {
      const res = await receiveBill(payload);
      if (res?.error) setError(res.error);
    });
  }

  // ---- Item editor ---------------------------------------------------------
  if (draft) {
    const cat = catById.get(draft.categoryId);
    const sizes = cat
      ? Array.from(
          new Set([
            ...sizesFor(cat.size_type),
            ...(draft.productId ? (productById.get(draft.productId)?.variants.map((v) => v.size) ?? []) : []),
          ]),
        )
      : [];
    const sugg = suggestion(draft);
    const curr = currentPrice(draft);
    const canAdd =
      cat && (draft.productId || draft.newName.trim()) && rupeesToPaise(draft.cost) !== null && pieces(draft) > 0;

    return (
      <section className="flex flex-col gap-4 rounded-2xl border-2 border-brand bg-surface p-4">
        <Field label={t("receive.category")}>
          <div className="grid grid-cols-2 gap-2">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => updateDraft({ categoryId: c.id, productId: null, qty: {} })}
                className={`${bigButton} ${c.id === draft.categoryId ? "border-brand bg-brand text-brand-ink" : "border-border"}`}
              >
                {localName(c, locale)}
              </button>
            ))}
          </div>
        </Field>

        {cat && (
          <ProductPicker
            key={cat.id}
            products={cat.products}
            locale={locale}
            selected={draft.productId}
            onPick={(id) => updateDraft({ productId: id, qty: {} })}
            newName={draft.newName}
            newNameOther={draft.newNameOther}
            onNewName={(newName, newNameOther) => updateDraft({ productId: null, newName, newNameOther })}
          />
        )}

        {cat && (draft.productId || draft.newName) && (
          <>
            <Field label={t("receive.costPrice")}>
              <MoneyInput value={draft.cost} onChange={(cost) => updateDraft({ cost })} />
            </Field>

            <Field label={t("receive.qtyPerSize")}>
              <div className="grid grid-cols-4 gap-2">
                {sizes.map((size) => (
                  <label key={size} className="flex flex-col items-center gap-1">
                    <span className="text-center text-sm leading-tight font-semibold">{sizeLabel(size, t)}</span>
                    <input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={draft.qty[size] ?? ""}
                      onChange={(e) =>
                        updateDraft({ qty: { ...draft.qty, [size]: e.target.value.replace(/\D/g, "").slice(0, 4) } })
                      }
                      className="min-h-12 w-full rounded-xl border-2 border-border bg-surface text-center text-xl focus:border-brand focus:outline-none"
                    />
                  </label>
                ))}
              </div>
            </Field>

            {isOwner ? (
              <Field label={t("receive.sellingPrice")}>
                <MoneyInput
                  value={draft.price}
                  onChange={(price) => updateDraft({ price, priceTouched: true })}
                />
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                  {curr !== null && <span>{t("receive.currentPrice", { price: formatPaise(curr) })}</span>}
                  {sugg !== null && <span>{t("receive.suggested", { price: formatPaise(sugg) })}</span>}
                  {sugg !== null && rupeesToPaise(draft.price) !== sugg && (
                    <button
                      type="button"
                      className="font-semibold text-brand underline"
                      onClick={() => updateDraft({ price: String(sugg / 100), priceTouched: true })}
                    >
                      {t("receive.useSuggested")}
                    </button>
                  )}
                </div>
              </Field>
            ) : (
              <p className="rounded-xl bg-background p-3 text-base">
                {curr !== null
                  ? t("receive.currentPrice", { price: formatPaise(curr) })
                  : sugg !== null
                    ? t("receive.suggested", { price: formatPaise(sugg) })
                    : t("receive.priceAuto")}
              </p>
            )}
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setDraft(null)} className={`${bigButton} border-border`}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={!canAdd}
            onClick={saveDraft}
            className={`${bigButton} border-brand bg-brand text-brand-ink disabled:opacity-40`}
          >
            {t("receive.addToBill")}
          </button>
        </div>
      </section>
    );
  }

  // ---- The bill ------------------------------------------------------------
  return (
    <div className="flex flex-col gap-5">
      <Field label={t("receive.supplier")}>
        <select
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          className={input}
          aria-label={t("receive.chooseSupplier")}
        >
          <option value="" disabled>
            {t("receive.chooseSupplier")}
          </option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.phone ? ` · ${s.phone}` : ""}
            </option>
          ))}
          <option value="new">{t("receive.newSupplier")}</option>
        </select>
        {supplierId === "new" && (
          <div className="mt-2 flex flex-col gap-2">
            <input
              placeholder={t("receive.supplierName")}
              value={newSupplier.name}
              onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })}
              className={input}
            />
            <input
              placeholder={t("receive.supplierPhone")}
              type="tel"
              inputMode="numeric"
              value={newSupplier.phone}
              onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })}
              className={input}
            />
          </div>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label={t("receive.billNumber")}>
          <input value={billNumber} onChange={(e) => setBillNumber(e.target.value)} className={input} />
        </Field>
        <Field label={t("receive.billDate")}>
          <input type="date" value={billDate} max={today} onChange={(e) => setBillDate(e.target.value)} className={input} />
        </Field>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">{t("receive.items")}</h2>
        {items.map((d) => (
          <article key={d.key} className="rounded-xl border border-border bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-lg font-semibold">{draftName(d)}</p>
                <p className="text-sm text-muted">
                  {Object.entries(d.qty)
                    .filter(([, q]) => parseInt(q) > 0)
                    .map(([s, q]) => `${sizeLabel(s, t)} × ${q}`)
                    .join(", ")}
                </p>
                <p className="text-sm">
                  {t("receive.pieces", { count: pieces(d) })} × {formatPaise(rupeesToPaise(d.cost) ?? 0)} ={" "}
                  <b>{formatPaise(lineTotal(d))}</b>
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <button type="button" className="min-h-10 px-2 font-semibold text-brand underline" onClick={() => setDraft(d)}>
                  {t("receive.edit")}
                </button>
                <button
                  type="button"
                  className="min-h-10 px-2 font-semibold text-danger underline"
                  onClick={() => setItems(items.filter((x) => x.key !== d.key))}
                >
                  {t("receive.remove")}
                </button>
              </div>
            </div>
          </article>
        ))}
        <button
          type="button"
          onClick={startItem}
          className="min-h-14 rounded-xl border-2 border-dashed border-brand text-lg font-bold text-brand"
        >
          {t("receive.addItem")}
        </button>
      </section>

      {items.length > 0 && (
        <section className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-lg">{t("receive.billTotal")}</span>
            <span className="text-2xl font-bold">{formatPaise(billTotal)}</span>
          </div>
          <Field label={t("receive.payment")}>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["bill", t("receive.payBill")],
                  ["cash", t("receive.payCash")],
                  ["mixed", t("receive.payMixed")],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`min-h-14 rounded-xl border-2 px-1 text-sm leading-tight font-semibold ${
                    mode === value ? "border-brand bg-brand text-brand-ink" : "border-border"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
          {mode === "mixed" && (
            <Field label={t("receive.amountPaid")}>
              <MoneyInput value={paid} onChange={setPaid} />
            </Field>
          )}
          <p className="text-base font-semibold">
            {t("receive.balanceDue", { amount: formatPaise(Math.max(billTotal - paidPaise, 0)) })}
          </p>
        </section>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-base font-semibold text-danger">
          {t(`receive.err.${error}`)}
        </p>
      )}

      <button
        type="button"
        disabled={pending || items.length === 0 || (supplierId === "new" ? !newSupplier.name.trim() : !supplierId)}
        onClick={submit}
        className="min-h-14 rounded-xl bg-brand text-lg font-bold text-brand-ink disabled:opacity-40"
      >
        {pending ? t("receive.saving") : t("receive.save")}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-semibold">{label}</span>
      {children}
    </div>
  );
}

function MoneyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-lg text-muted">₹</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        className={`${input} pl-8`}
      />
    </div>
  );
}

function ProductPicker({
  products,
  locale,
  selected,
  onPick,
  newName,
  newNameOther,
  onNewName,
}: {
  products: FormProduct[];
  locale: string;
  selected: string | null;
  onPick: (id: string) => void;
  newName: string;
  newNameOther: string;
  onNewName: (name: string, other: string) => void;
}) {
  const t = useTranslations("receive");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(products.length === 0 || (!selected && newName !== ""));

  const q = query.trim().toLowerCase();
  const shown = products
    .filter((p) => !q || [p.name, p.name_hi, p.name_en].some((n) => n?.toLowerCase().includes(q)))
    .slice(0, 12);

  return (
    <Field label={t("product")}>
      {!creating && (
        <>
          {products.length > 6 && (
            <input placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} className={`${input} mb-2`} />
          )}
          <div className="grid grid-cols-2 gap-2">
            {shown.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p.id)}
                className={`${bigButton} text-left ${p.id === selected ? "border-brand bg-brand text-brand-ink" : "border-border"}`}
              >
                {localName(p, locale)}
              </button>
            ))}
          </div>
        </>
      )}
      <button
        type="button"
        onClick={() => {
          setCreating(!creating);
          onNewName("", "");
        }}
        className="mt-2 min-h-11 self-start font-semibold text-brand underline"
      >
        {creating ? t("chooseProduct") : t("newProduct")}
      </button>
      {creating && (
        <div className="flex flex-col gap-2">
          <input
            placeholder={t("productName")}
            value={newName}
            onChange={(e) => onNewName(e.target.value, newNameOther)}
            className={input}
          />
          <input
            placeholder={t("productNameOther")}
            value={newNameOther}
            onChange={(e) => onNewName(newName, e.target.value)}
            className={input}
          />
        </div>
      )}
    </Field>
  );
}
