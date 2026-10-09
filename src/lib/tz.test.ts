import { describe, expect, it } from "vitest";
import { formatInZone, isoToZonedInput, zonedInputToIso } from "./tz";

describe("time zone helpers", () => {
  it("Hawaii is UTC-10 all year (no daylight saving)", () => {
    expect(zonedInputToIso("2027-03-31T23:59", "Pacific/Honolulu")).toBe("2027-04-01T09:59:00.000Z");
    expect(zonedInputToIso("2027-06-30T23:59", "Pacific/Honolulu")).toBe("2027-07-01T09:59:00.000Z");
    expect(zonedInputToIso("2027-12-31T23:59:59", "Pacific/Honolulu")).toBe("2028-01-01T09:59:59.000Z");
  });

  it("handles zones with daylight saving too", () => {
    expect(zonedInputToIso("2027-01-15T12:00", "America/New_York")).toBe("2027-01-15T17:00:00.000Z");
    expect(zonedInputToIso("2027-07-15T12:00", "America/New_York")).toBe("2027-07-15T16:00:00.000Z");
  });

  it("round-trips for the edit form", () => {
    const iso = zonedInputToIso("2027-03-31T23:59", "Pacific/Honolulu")!;
    expect(isoToZonedInput(iso, "Pacific/Honolulu")).toBe("2027-03-31T23:59");
  });

  it("formats with the zone abbreviation", () => {
    expect(formatInZone("2027-04-01T09:59:00Z", "Pacific/Honolulu")).toBe("Mar 31, 2027, 11:59 PM HST");
    expect(formatInZone("2027-04-01T09:59:00Z", "Pacific/Honolulu", { time: false })).toBe("Mar 31, 2027");
  });

  it("rejects garbage", () => {
    expect(zonedInputToIso("tomorrow", "Pacific/Honolulu")).toBeNull();
  });
});
