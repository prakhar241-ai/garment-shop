import { describe, expect, it } from "vitest";
import { rupees, toCsv } from "./csv";

describe("csv", () => {
  it("starts with a BOM, uses CRLF and quotes when needed", () => {
    const out = toCsv(["name", "note"], [["कॉटन साड़ी", 'says "hi", ok'], ["a\nb", null]]);
    expect(out.startsWith("\uFEFFname,note\r\n")).toBe(true);
    expect(out).toContain('कॉटन साड़ी,"says ""hi"", ok"\r\n');
    expect(out).toContain('"a\nb",\r\n');
  });

  it("neutralises spreadsheet formulas but keeps negative numbers", () => {
    const out = toCsv(["x"], [["=1+1"], ["-12.50"], ["@cmd"]]);
    expect(out).toContain("'=1+1");
    expect(out).toContain("\r\n-12.50\r\n");
    expect(out).toContain("'@cmd");
  });

  it("writes paise as rupees", () => {
    expect(rupees(12345)).toBe("123.45");
    expect(rupees(-500)).toBe("-5.00");
    expect(rupees(0)).toBe("0.00");
    expect(rupees(null)).toBe("");
  });
});
