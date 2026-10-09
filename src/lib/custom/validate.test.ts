import { describe, expect, it } from "vitest";
import { slugify, validateCustomInput } from "./validate";

const good = { title: "Will Liam add more flake?", rules: "Yes if more flake goes down.", outcomes: "Yes\nNo", endAt: "2099-01-01T00:00", liquidity: "" };

describe("custom market validation", () => {
  it("accepts a good market, derives the slug and default liquidity", () => {
    const r = validateCustomInput(good, { publishing: true });
    expect(r).toMatchObject({ ok: true, value: { slug: "will-liam-add-more-flake", outcomes: ["Yes", "No"], liquidity: 1000 } });
  });
  it("slugify handles apostrophes and accents", () => {
    expect(slugify("What will Hannah's next job be?")).toBe("what-will-hannahs-next-job-be");
    expect(slugify("Café Señor")).toBe("cafe-senor");
  });
  it("rejects bad outcomes", () => {
    expect(validateCustomInput({ ...good, outcomes: "Yes" }, { publishing: false })).toMatchObject({ ok: false, field: "outcomes" });
    expect(validateCustomInput({ ...good, outcomes: "Yes\nyes" }, { publishing: false })).toMatchObject({ ok: false, field: "outcomes" });
    expect(validateCustomInput({ ...good, outcomes: Array(13).fill(0).map((_, i) => `o${i}`) }, { publishing: false })).toMatchObject({ ok: false });
  });
  it("publishing needs rules and a future end date; drafts don't", () => {
    expect(validateCustomInput({ ...good, rules: "" }, { publishing: true })).toMatchObject({ ok: false, field: "rules" });
    expect(validateCustomInput({ ...good, rules: "" }, { publishing: false }).ok).toBe(true);
    expect(validateCustomInput({ ...good, endAt: "2000-01-01" }, { publishing: true })).toMatchObject({ ok: false, field: "endAt" });
    expect(validateCustomInput({ ...good, endAt: "2000-01-01" }, { publishing: false }).ok).toBe(true);
  });
  it("liquidity bounds", () => {
    expect(validateCustomInput({ ...good, liquidity: "10" }, { publishing: false })).toMatchObject({ ok: false, field: "liquidity" });
    expect(validateCustomInput({ ...good, liquidity: "2500" }, { publishing: false })).toMatchObject({ ok: true, value: { liquidity: 2500 } });
  });
});
