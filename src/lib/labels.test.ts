import { describe, expect, it } from "vitest";
import { LAYOUTS, expandCopies, paginate } from "./labels";

describe("labels", () => {
  it("expands copies in order and ignores bad counts", () => {
    expect(expandCopies([{ item: "a", copies: 2 }, { item: "b", copies: 0 }, { item: "c", copies: -1 }, { item: "d", copies: 1.7 }])).toEqual([
      "a",
      "a",
      "d",
    ]);
  });

  it("thermal: one label per page, skip ignored", () => {
    expect(paginate(["a", "b"], "thermal", 5)).toEqual([["a"], ["b"]]);
  });

  it("A4 65: fills sheets of 65 and starts after skipped slots", () => {
    const labels = Array.from({ length: 70 }, (_, i) => i);
    const pages = paginate(labels, "a4_65", 3);
    expect(pages.length).toBe(2);
    expect(pages[0].slice(0, 4)).toEqual([null, null, null, 0]);
    expect(pages[0].length).toBe(65);
    expect(pages[1].length).toBe(70 + 3 - 65);
  });

  it("skip can never push a whole sheet blank", () => {
    expect(paginate(["a"], "a4_40", 500)[0].filter(Boolean)).toEqual(["a"]);
    expect(paginate(["a"], "a4_40", 500)[0].length).toBe(40);
  });

  it("nothing to print gives no pages", () => {
    expect(paginate([], "a4_65", 10)).toEqual([]);
  });

  it("sheet layouts fit on A4", () => {
    for (const l of [LAYOUTS.a4_65, LAYOUTS.a4_40]) {
      const w = l.marginLeft * 2 + l.cols * l.labelW + (l.cols - 1) * l.colGap;
      const h = l.marginTop + l.rows * l.labelH + (l.rows - 1) * l.rowGap;
      expect(w).toBeLessThanOrEqual(210.01);
      expect(h).toBeLessThanOrEqual(297.01);
    }
  });
});
