import { describe, expect, it } from "vitest";
import { cents, pct, shares, timeLeft } from "./format";

describe("format", () => {
  it("pct", () => {
    expect(pct(0.243)).toBe("24%");
    expect(pct(0.004)).toBe("<1%");
    expect(pct(0.995)).toBe(">99%");
    expect(pct(null)).toBe("--");
  });
  it("cents", () => {
    expect(cents(0.277)).toBe("27.7¢");
    expect(cents(0.07)).toBe("7¢");
    expect(cents(0.073)).toBe("7.3¢");
  });
  it("shares floor so they match the payout", () => {
    expect(shares(301.2853)).toBe("301.28");
    expect(shares(1000)).toBe("1,000");
  });
  it("timeLeft hides past end dates on still-open markets", () => {
    const now = Date.parse("2026-10-09T00:00:00Z");
    expect(timeLeft("2026-10-08T00:00:00Z", now)).toBeNull();
    expect(timeLeft("2026-10-09T05:00:00Z", now)).toBe("5h left");
  });
});
