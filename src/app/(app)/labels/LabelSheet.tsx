"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Barcode } from "@/components/Barcode";
import { formatPaise } from "@/lib/money";
import { LAYOUTS, expandCopies, paginate, type LabelFormat, type LabelItem } from "@/lib/labels";

export type SheetRow = { id: string; copies: number; label: LabelItem };

const FORMAT_KEY = "labelFormat";

export function LabelSheet({ rows }: { rows: SheetRow[] }) {
  const t = useTranslations("labels");
  const [format, setFormat] = useState<LabelFormat>("thermal");
  const [skip, setSkip] = useState(0);
  const [copies, setCopies] = useState<Record<string, number>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.copies])),
  );

  // Remember the printer choice on this phone (a convenience only).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(FORMAT_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after mount
      if (saved === "thermal" || saved === "a4_65" || saved === "a4_40") setFormat(saved);
    } catch {}
  }, []);
  function chooseFormat(f: LabelFormat) {
    setFormat(f);
    try {
      localStorage.setItem(FORMAT_KEY, f);
    } catch {}
  }

  const labels = expandCopies(rows.map((r) => ({ item: r.label, copies: copies[r.id] ?? 0 })));
  const pages = paginate(labels, format, skip);
  const L = LAYOUTS[format];

  return (
    <>
      {/* @page has to match the paper, so it is written per format. */}
      <style>{`@media print { @page { size: ${L.pageW}mm ${L.pageH}mm; margin: 0; } }`}</style>

      <div className="flex flex-col gap-4 print:hidden">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-semibold">{t("format")}</legend>
          {(["thermal", "a4_65", "a4_40"] as const).map((f) => (
            <label
              key={f}
              className={`flex min-h-12 items-center gap-3 rounded-xl border-2 px-3 ${format === f ? "border-brand" : "border-border"}`}
            >
              <input type="radio" name="format" checked={format === f} onChange={() => chooseFormat(f)} className="h-5 w-5" />
              <span>{t(f)}</span>
            </label>
          ))}
        </fieldset>

        {format !== "thermal" && (
          <label className="flex items-center justify-between gap-3">
            <span>{t("skip")}</span>
            <input
              inputMode="numeric"
              value={skip || ""}
              placeholder="0"
              onChange={(e) => setSkip(parseInt(e.target.value.replace(/\D/g, "")) || 0)}
              className="min-h-12 w-20 rounded-xl border-2 border-border bg-surface text-center text-lg"
            />
          </label>
        )}

        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2">
              <div className="w-36 shrink-0">
                <LabelFace label={r.label} scale={0.9} />
              </div>
              <label className="flex flex-1 flex-col items-center gap-1">
                <span className="text-sm">{t("copies")}</span>
                <div className="flex items-center gap-1">
                  <Step onClick={() => setCopies({ ...copies, [r.id]: Math.max(0, (copies[r.id] ?? 0) - 1) })}>−</Step>
                  <input
                    inputMode="numeric"
                    value={copies[r.id] ?? 0}
                    onChange={(e) => setCopies({ ...copies, [r.id]: parseInt(e.target.value.replace(/\D/g, "")) || 0 })}
                    className="min-h-11 w-12 rounded-lg border-2 border-border bg-surface text-center text-lg"
                  />
                  <Step onClick={() => setCopies({ ...copies, [r.id]: (copies[r.id] ?? 0) + 1 })}>+</Step>
                </div>
              </label>
            </li>
          ))}
        </ul>

        <button
          type="button"
          disabled={labels.length === 0}
          onClick={() => window.print()}
          className="sticky bottom-20 min-h-14 rounded-xl bg-brand text-lg font-bold text-brand-ink shadow-lg disabled:opacity-40"
        >
          {t("print")} · {t("total", { count: labels.length })}
        </button>
      </div>

      {/* What actually prints. Hidden on screen. */}
      <div className="hidden print:block">
        {pages.map((page, i) => (
          <div
            key={i}
            style={{
              width: `${L.pageW}mm`,
              height: `${L.pageH}mm`,
              paddingTop: `${L.marginTop}mm`,
              paddingLeft: `${L.marginLeft}mm`,
              display: "grid",
              gridTemplateColumns: `repeat(${L.cols}, ${L.labelW}mm)`,
              gridAutoRows: `${L.labelH}mm`,
              columnGap: `${L.colGap}mm`,
              rowGap: `${L.rowGap}mm`,
              boxSizing: "border-box",
              overflow: "hidden",
              breakAfter: i < pages.length - 1 ? "page" : "auto",
            }}
          >
            {page.map((label, j) => (
              <div key={j} style={{ width: `${L.labelW}mm`, height: `${L.labelH}mm`, overflow: "hidden" }}>
                {label && <LabelFace label={label} scale={L.scale} print />}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

/** One label: name, size and price, barcode, code. Sized in mm for print. */
function LabelFace({ label, scale, print }: { label: LabelItem; scale: number; print?: boolean }) {
  const s = (n: number) => (print ? `${n * scale}mm` : `${n * scale * 0.6}em`);
  const pt = (n: number) => (print ? `${n * scale}pt` : `${n * scale * 0.11}em`);
  return (
    <div
      style={{
        height: print ? "100%" : undefined,
        padding: print ? `${1.5 * scale}mm ${2 * scale}mm` : "0.4em",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#fff",
        color: "#000",
        fontSize: print ? undefined : "1rem",
        border: print ? undefined : "1px dashed var(--border)",
        borderRadius: print ? undefined : "0.4em",
        lineHeight: 1.15,
      }}
    >
      <div style={{ fontSize: pt(7.5), fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label.name}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: pt(8), fontWeight: 700 }}>{label.size}</span>
        <span style={{ fontSize: pt(12), fontWeight: 800 }}>{formatPaise(label.price)}</span>
      </div>
      <Barcode value={label.barcode} className="block w-full" style={{ height: s(8) }} />
      <div style={{ fontSize: pt(6.5), textAlign: "center", fontFamily: "monospace", letterSpacing: "0.05em" }}>
        {label.barcode}
      </div>
    </div>
  );
}

function Step({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-border text-xl font-bold"
    >
      {children}
    </button>
  );
}
