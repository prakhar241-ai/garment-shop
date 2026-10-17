import { describe, expect, it } from "vitest";
import hi from "../../messages/hi.json";
import en from "../../messages/en.json";

type Tree = { [key: string]: string | Tree };

function keys(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [prefix + k] : keys(v, `${prefix}${k}.`)));
}

describe("translations", () => {
  it("Hindi and English have exactly the same keys", () => {
    expect(keys(hi).sort()).toEqual(keys(en).sort());
  });

  it("no empty strings", () => {
    for (const [name, tree] of [["hi", hi], ["en", en]] as const) {
      const empty = keys(tree).filter((k) => k.split(".").reduce<Tree | string>((t, p) => (t as Tree)[p], tree) === "");
      expect(empty, name).toEqual([]);
    }
  });
});
