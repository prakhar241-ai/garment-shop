"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CameraScanner } from "@/components/CameraScanner";
import { addTagged, cartTotal, percentDiscount, stepQty, stockAfter, subtotal, type CartLine } from "@/lib/cart";
import { formatDate, formatPaise, rupeesToPaise } from "@/lib/money";
import { sizeLabel, sizesFor } from "@/lib/sizes";
import { slipText, whatsappLink } from "@/lib/slip";
import { bestOffer, type Offer } from "@/lib/offers";
import { lookupBarcode, makeSale, searchCustomers, type CustomerHit, type SaleError, type SalePayload } from "./actions";

/** A tagged item as the Sell screen knows it. `price` is the tag price; offers are applied when it is added. */
export type ScanItem = {
  variantId: string;
  barcode: string;
  name: string;
  size: string;
  price: number;
  stock: number;
  categoryId: string;
};
export type QuickCategory = { id: string; name: string; sizeType: string };

type Mode = "cash" | "upi" | "udhaar";
type Customer = { id?: string; name: string; phone: string | null; outstanding?: number };
type Done = {
  total: number;
  discount: number;
  mode: Mode;
  lines: CartLine[];
  negative: { barcode: string; stock_qty: number }[];
  customer: Customer | null;
};

export function SellScreen({
  items,
  categories,
  isOwner,
  shopName,
  offers,
  today,
}: {
  items: ScanItem[];
  categories: QuickCategory[];
  isOwner: boolean;
  shopName: string;
  offers: Offer[];
  today: string;
}) {
  const t = useTranslations();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [returning, setReturning] = useState(false);
  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [discount, setDiscount] = useState<{ amount: number; pin: string } | null>(null);
  const [sheet, setSheet] = useState<null | "quick" | "discount" | "customer">(null);
  const [error, setError] = useState<SaleError | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [pending, startTransition] = useTransition();
  const [catalog, setCatalog] = useState(() => new Map(items.map((i) => [i.barcode, i])));

  const sub = subtotal(lines);
  const disc = discount && sub > 0 ? Math.min(discount.amount, sub) : 0;
  const total = cartTotal(lines, disc);
  const left = useMemo(() => stockAfter(lines), [lines]);

  // ---- Adding items ------------------------------------------------------
  const addCode = useCallback(
    async (raw: string) => {
      const c = raw.trim().toUpperCase();
      if (!c) return;
      setNotice(null);
      setError(null);
      let item = catalog.get(c);
      if (!item) {
        const fresh = await lookupBarcode(c);
        if (fresh) {
          item = fresh;
          setCatalog((m) => new Map(m).set(fresh.barcode, fresh));
        }
      }
      if (!item) {
        setNotice(t("sell.notFound", { code: c }));
        return;
      }
      // Apply today's best offer, the same way make_sale() will.
      const best = bestOffer(offers, item.categoryId, item.price, today);
      const found = {
        variantId: item.variantId,
        barcode: item.barcode,
        name: item.name,
        size: item.size,
        stock: item.stock,
        price: best ? best.price : item.price,
        ...(best ? { regular: item.price, offer: best.offer.name } : {}),
      };
      setLines((ls) => addTagged(ls, found, returning));
    },
    [catalog, returning, t, offers, today],
  );

  // USB / Bluetooth scanners type the code fast and press Enter. Catch that
  // anywhere on the page, unless the person is typing in a box.
  const buffer = useRef({ text: "", at: 0 });
  useEffect(() => {
    if (done) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select")) return;
      const now = Date.now();
      if (now - buffer.current.at > 100) buffer.current.text = "";
      buffer.current.at = now;
      if (e.key === "Enter") {
        if (buffer.current.text.length >= 3) addCode(buffer.current.text);
        buffer.current.text = "";
      } else if (e.key.length === 1) {
        buffer.current.text += e.key;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addCode, done]);

  // ---- Paying --------------------------------------------------------------
  function pay(mode: Mode, customer?: Customer) {
    if (mode === "udhaar" && !customer) {
      setSheet("customer");
      return;
    }
    setError(null);
    const payload: SalePayload = {
      payment_mode: mode,
      items: lines.map((l) =>
        l.kind === "tagged"
          ? { variant_id: l.variantId, qty: l.qty }
          : { category_id: l.categoryId, size: l.size, price: l.price, qty: l.qty, description: l.name },
      ),
      ...(disc > 0 ? { discount: disc, owner_pin: isOwner ? undefined : discount!.pin } : {}),
      ...(customer?.id ? { customer_id: customer.id } : customer ? { new_customer: { name: customer.name, phone: customer.phone ?? "" } } : {}),
    };
    startTransition(async () => {
      const res = await makeSale(payload);
      if ("error" in res) {
        setError(res.error);
        if (res.error === "bad_pin" || res.error === "pin_locked") setDiscount(null);
        return;
      }
      // Keep the phone's stock numbers in step with the database.
      const byId = new Map(res.ok.stock.map((s) => [s.variant_id, s.stock_qty]));
      setCatalog((m) => new Map([...m].map(([k, v]) => [k, byId.has(v.variantId) ? { ...v, stock: byId.get(v.variantId)! } : v])));
      setDone({ total: res.ok.total, discount: res.ok.discount, mode, lines, negative: res.ok.negative, customer: customer ?? null });
      setSheet(null);
    });
  }

  function reset() {
    setLines([]);
    setDiscount(null);
    setReturning(false);
    setDone(null);
    setError(null);
    setNotice(null);
  }

  // ---- After the sale ------------------------------------------------------
  if (done) {
    const modeLabel = t(done.total < 0 ? `sell.refund${cap(done.mode)}` : `sell.${done.mode}`);
    const text = slipText({
      shop: shopName,
      date: new Date(),
      lines: done.lines.map((l) => ({ name: l.name, size: l.size, qty: l.qty, price: l.price })),
      discount: done.discount,
      total: done.total,
      modeLabel,
      labels: {
        total: t("sell.slip.total"),
        discount: t("sell.slip.discount"),
        returned: t("sell.slip.returned"),
        mode: t("sell.slip.mode"),
        thanks: t("sell.slip.thanks"),
      },
    });
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl bg-brand p-5 text-center text-brand-ink">
          <p className="text-lg font-semibold">✓ {done.total < 0 ? t("sell.doneRefund") : t("sell.done")}</p>
          <p className="mt-1 text-5xl font-bold">{formatPaise(Math.abs(done.total))}</p>
          <p className="mt-1 text-lg">{modeLabel}</p>
          {done.customer && <p className="text-base opacity-90">{done.customer.name}</p>}
        </div>
        {done.negative.length > 0 && (
          <div className="rounded-xl bg-warn-bg p-3 text-warn-ink">
            <p className="font-semibold">⚠ {t("sell.negativeWarn")}</p>
            <ul className="mt-1 font-mono text-sm">
              {done.negative.map((n) => (
                <li key={n.barcode}>
                  {n.barcode}: {n.stock_qty}
                </li>
              ))}
            </ul>
          </div>
        )}
        <a
          href={whatsappLink(text, done.customer?.phone)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-14 items-center justify-center rounded-xl border-2 border-[#25d366] text-lg font-bold text-[#128c4a]"
        >
          {t("sell.whatsapp")}
        </a>
        <button type="button" onClick={reset} autoFocus className="min-h-16 rounded-xl bg-brand text-xl font-bold text-brand-ink">
          {t("sell.newSale")}
        </button>
      </div>
    );
  }

  // ---- The sell screen -----------------------------------------------------
  return (
    <div className="flex flex-col gap-3 pb-44">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button
          type="button"
          onClick={() => setCamera(!camera)}
          className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-brand text-lg font-bold text-brand-ink"
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M13 8v8M17 8v8" />
          </svg>
          {camera ? t("sell.stopScan") : t("sell.scan")}
        </button>
        <button
          type="button"
          aria-pressed={returning}
          onClick={() => setReturning(!returning)}
          className={`min-h-14 rounded-xl border-2 px-3 text-base font-bold ${
            returning ? "border-danger bg-danger text-white" : "border-border bg-surface"
          }`}
        >
          ↩ {t("sell.returnMode")}
        </button>
      </div>

      {offers.length > 0 && (
        <section aria-label={t("offers.banner")} className="rounded-xl border-2 border-brand bg-green-50 px-3 py-2">
          <p className="font-bold text-brand">🏷 {t("offers.banner")}</p>
          <ul className="text-sm">
            {offers.map((o) => (
              <li key={o.id}>
                {t("offers.bannerLine", {
                  name: o.name,
                  what: o.kind === "percent" ? t("offers.percentOff", { value: o.value }) : t("offers.flat", { price: formatPaise(o.value) }),
                  to: formatDate(`${o.ends_on}T12:00:00+05:30`).slice(0, 5),
                })}
              </li>
            ))}
          </ul>
        </section>
      )}

      {returning && <p className="rounded-xl bg-red-50 p-2 text-center font-semibold text-danger">{t("sell.returnOn")}</p>}

      {camera && <CameraScanner onCode={addCode} onClose={() => setCamera(false)} />}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          addCode(code);
          setCode("");
        }}
        className="grid grid-cols-[1fr_auto] gap-2"
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("sell.codePlaceholder")}
          autoCapitalize="characters"
          autoComplete="off"
          aria-label={t("sell.codePlaceholder")}
          className="min-h-12 rounded-xl border-2 border-border bg-surface px-3 font-mono text-lg uppercase focus:border-brand focus:outline-none"
        />
        <button type="submit" className="min-h-12 rounded-xl border-2 border-brand px-4 font-bold text-brand">
          {t("sell.add")}
        </button>
      </form>

      {notice && (
        <p role="alert" className="rounded-xl bg-warn-bg p-3 font-semibold text-warn-ink">
          {notice}
        </p>
      )}

      {lines.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-border p-6 text-center text-lg text-muted">{t("sell.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lines.map((l) => {
            const ret = l.qty < 0;
            const short = l.kind === "tagged" && !ret && (left.get(l.variantId) ?? 0) < 0;
            return (
              <li
                key={l.key}
                className={`rounded-xl border-2 bg-surface p-3 ${ret ? "border-danger" : "border-border"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-lg leading-snug font-semibold">
                      {ret && <span className="text-danger">↩ {t("sell.returned")} · </span>}
                      {l.name}
                    </p>
                    <p className="text-sm text-muted">
                      {l.size}
                      {l.kind === "tagged" ? ` · ${l.barcode}` : ` · ${t("sell.untagged")}`}
                    </p>
                  </div>
                  <p className={`shrink-0 text-xl font-bold ${ret ? "text-danger" : ""}`}>{formatPaise(l.price * l.qty)}</p>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <QtyButton label="−" onClick={() => setLines(stepQty(lines, l.key, -1))} />
                    <span className="w-10 text-center text-xl font-bold">{Math.abs(l.qty)}</span>
                    <QtyButton label="+" onClick={() => setLines(stepQty(lines, l.key, 1))} />
                  </div>
                  <span className="text-sm text-muted">
                    {l.kind === "tagged" && l.regular !== undefined && (
                      <s className="mr-1" aria-label={formatPaise(l.regular)}>
                        {formatPaise(l.regular)}
                      </s>
                    )}
                    × {formatPaise(l.price)}
                  </span>
                </div>
                {l.kind === "tagged" && l.offer && (
                  <p className="mt-1 inline-block rounded-full bg-brand px-2 text-sm font-semibold text-brand-ink">
                    🏷 {t("offers.applied", { name: l.offer })}
                  </p>
                )}
                {short &&<p className="mt-1 text-sm font-semibold text-warn-ink">⚠ {t("sell.stockWarn")}</p>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSheet("quick")}
          className="min-h-12 rounded-xl border-2 border-border bg-surface px-2 text-base font-semibold"
        >
          + {t("sell.quick")}
        </button>
        {discount ? (
          <button
            type="button"
            onClick={() => setDiscount(null)}
            className="min-h-12 rounded-xl border-2 border-danger px-2 text-base font-semibold text-danger"
          >
            {t("sell.removeDiscount")}
          </button>
        ) : (
          <button
            type="button"
            disabled={sub <= 0}
            onClick={() => setSheet("discount")}
            className="min-h-12 rounded-xl border-2 border-border bg-surface px-2 text-base font-semibold disabled:opacity-40"
          >
            % {t("sell.addDiscount")}
          </button>
        )}
      </div>

      {lines.length > 0 && (
        <button
          type="button"
          onClick={() => window.confirm(t("sell.confirmClear")) && reset()}
          className="min-h-11 self-start font-semibold text-danger underline"
        >
          {t("sell.clear")}
        </button>
      )}

      {/* Total and pay buttons, always in reach above the bottom tabs. */}
      <div className="fixed inset-x-0 bottom-16 z-10 border-t border-border bg-surface/95 px-4 pt-2 backdrop-blur pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-md">
          {error && (
            <p role="alert" className="mb-2 rounded-lg bg-red-50 p-2 text-center font-semibold text-danger">
              {t(`sell.err.${error}`)}
            </p>
          )}
          <div className="flex items-baseline justify-between">
            <span className="text-base text-muted">
              {disc > 0 ? `${t("sell.subtotal")} ${formatPaise(sub)} − ${t("sell.discount")} ${formatPaise(disc)}` : total < 0 ? t("sell.refund") : t("sell.total")}
            </span>
            <span className={`text-4xl font-bold ${total < 0 ? "text-danger" : ""}`}>{formatPaise(Math.abs(total))}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(["cash", "upi", "udhaar"] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={pending || lines.length === 0}
                onClick={() => pay(m)}
                className={`min-h-14 rounded-xl text-lg leading-tight font-bold disabled:opacity-40 ${
                  m === "cash" ? "bg-brand text-brand-ink" : "border-2 border-brand text-brand"
                }`}
              >
                {pending ? "…" : t(total < 0 ? `sell.refund${cap(m)}` : `sell.${m}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {sheet === "quick" && (
        <Sheet title={t("sell.quickTitle")} onClose={() => setSheet(null)}>
          <QuickSale
            categories={categories}
            onAdd={(line) => {
              setLines((ls) => [...ls, { ...line, qty: returning ? -line.qty : line.qty }]);
              setSheet(null);
            }}
          />
        </Sheet>
      )}
      {sheet === "discount" && (
        <Sheet title={t("sell.addDiscount")} onClose={() => setSheet(null)}>
          <DiscountForm
            subtotal={sub}
            needsPin={!isOwner}
            onApply={(d) => {
              setDiscount(d);
              setError(null);
              setSheet(null);
            }}
          />
        </Sheet>
      )}
      {sheet === "customer" && (
        <Sheet title={t("sell.chooseCustomer")} onClose={() => setSheet(null)}>
          <CustomerPicker pending={pending} onPick={(c) => pay("udhaar", c)} />
        </Sheet>
      )}
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function QtyButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-border text-2xl font-bold"
    >
      {label}
    </button>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="mx-auto max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="✕" className="h-11 w-11 rounded-full text-2xl">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const field =
  "min-h-12 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg focus:border-brand focus:outline-none";

function QuickSale({
  categories,
  onAdd,
}: {
  categories: QuickCategory[];
  onAdd: (line: Extract<CartLine, { kind: "quick" }>) => void;
}) {
  const t = useTranslations();
  const [cat, setCat] = useState<QuickCategory | null>(null);
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState(1);
  const paise = rupeesToPaise(price);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              setCat(c);
              setSize("");
            }}
            className={`min-h-12 rounded-xl border-2 px-2 font-semibold ${cat?.id === c.id ? "border-brand bg-brand text-brand-ink" : "border-border bg-surface"}`}
          >
            {c.name}
          </button>
        ))}
      </div>
      {cat && (
        <div className="grid grid-cols-4 gap-2">
          {sizesFor(cat.sizeType).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              className={`min-h-12 rounded-xl border-2 px-1 text-sm font-semibold ${size === s ? "border-brand bg-brand text-brand-ink" : "border-border bg-surface"}`}
            >
              {sizeLabel(s, t)}
            </button>
          ))}
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("sell.price")}</span>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-lg text-muted">₹</span>
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} className={`${field} pl-8`} />
        </div>
      </label>
      <div className="flex items-center justify-between">
        <span className="font-semibold">{t("sell.qty")}</span>
        <div className="flex items-center gap-1">
          <QtyButton label="−" onClick={() => setQty(Math.max(1, qty - 1))} />
          <span className="w-10 text-center text-xl font-bold">{qty}</span>
          <QtyButton label="+" onClick={() => setQty(qty + 1)} />
        </div>
      </div>
      <button
        type="button"
        disabled={!cat || !paise}
        onClick={() =>
          onAdd({
            kind: "quick",
            key: `q:${Date.now()}`,
            categoryId: cat!.id,
            name: cat!.name,
            size: size ? sizeLabel(size, t) : "",
            price: paise!,
            qty,
          })
        }
        className="min-h-14 rounded-xl bg-brand text-lg font-bold text-brand-ink disabled:opacity-40"
      >
        {t("sell.addToCart")}
      </button>
    </div>
  );
}

function DiscountForm({
  subtotal: sub,
  needsPin,
  onApply,
}: {
  subtotal: number;
  needsPin: boolean;
  onApply: (d: { amount: number; pin: string }) => void;
}) {
  const t = useTranslations("sell");
  const [amount, setAmount] = useState("");
  const [percent, setPercent] = useState("");
  const [pin, setPin] = useState("");
  const value = percent ? percentDiscount(sub, Number(percent)) : (rupeesToPaise(amount) ?? 0);
  const ok = value > 0 && value <= sub && (!needsPin || /^\d{6}$/.test(pin));

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t("discountAmount")}</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value.replace(/[^\d.]/g, ""));
              setPercent("");
            }}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t("discountPercent")}</span>
          <input
            inputMode="decimal"
            value={percent}
            onChange={(e) => {
              setPercent(e.target.value.replace(/[^\d.]/g, ""));
              setAmount("");
            }}
            className={field}
          />
        </label>
      </div>
      {value > 0 && (
        <p className="text-lg">
          {t("discount")}: <b>{formatPaise(Math.min(value, sub))}</b> → {t("total")} <b>{formatPaise(sub - Math.min(value, sub))}</b>
        </p>
      )}
      {needsPin && (
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t("ownerPin")}</span>
          <span className="text-sm text-muted">{t("ownerPinHint")}</span>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className={`${field} tracking-[0.5em]`}
          />
        </label>
      )}
      <button
        type="button"
        disabled={!ok}
        onClick={() => onApply({ amount: value, pin })}
        className="min-h-14 rounded-xl bg-brand text-lg font-bold text-brand-ink disabled:opacity-40"
      >
        {t("apply")}
      </button>
    </div>
  );
}

function CustomerPicker({ pending, onPick }: { pending: boolean; onPick: (c: Customer) => void }) {
  const t = useTranslations("sell");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      const res = await searchCustomers(q);
      if (live) setHits(res);
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  if (creating) {
    return (
      <div className="flex flex-col gap-2">
        <input placeholder={t("customerName")} value={name} onChange={(e) => setName(e.target.value)} className={field} autoFocus />
        <input
          placeholder={t("customerPhone")}
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={field}
        />
        <button
          type="button"
          disabled={pending || !name.trim()}
          onClick={() => onPick({ name: name.trim(), phone: phone.trim() || null })}
          className="min-h-14 rounded-xl bg-brand text-lg font-bold text-brand-ink disabled:opacity-40"
        >
          {pending ? t("saving") : t("confirmUdhaar")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <input placeholder={t("searchCustomer")} value={q} onChange={(e) => setQ(e.target.value)} className={field} />
      <ul className="flex flex-col gap-2">
        {hits.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              disabled={pending}
              onClick={() => onPick(c)}
              className="flex min-h-14 w-full items-center justify-between gap-2 rounded-xl border-2 border-border bg-surface px-3 text-left"
            >
              <span className="min-w-0">
                <span className="block truncate text-lg font-semibold">{c.name}</span>
                {c.phone && <span className="block text-sm text-muted">{c.phone}</span>}
              </span>
              {c.outstanding > 0 && (
                <span className="shrink-0 text-sm font-semibold text-danger">{t("owes", { amount: formatPaise(c.outstanding) })}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => setCreating(true)} className="min-h-12 rounded-xl border-2 border-dashed border-brand font-bold text-brand">
        {t("newCustomer")}
      </button>
    </div>
  );
}
