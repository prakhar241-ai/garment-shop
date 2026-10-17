"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

/** Code128 barcode as SVG, stretched to fill its box (the bars scale evenly,
 *  so it still scans). Human-readable text is drawn separately by the label. */
export function Barcode({ value, className, style }: { value: string; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    // margin 20 at width 2 = a 10-module quiet zone each side, as Code128 needs.
    JsBarcode(svg, value, { format: "CODE128", displayValue: false, margin: 20, width: 2, height: 60 });
    const w = svg.getAttribute("width");
    const h = svg.getAttribute("height");
    svg.setAttribute("viewBox", `0 0 ${parseFloat(w ?? "0")} ${parseFloat(h ?? "0")}`);
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("preserveAspectRatio", "none");
  }, [value]);

  return <svg ref={ref} className={className} style={style} role="img" aria-label={value} />;
}
