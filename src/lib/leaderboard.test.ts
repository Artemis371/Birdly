import { describe, expect, it } from "vitest";
import { rankRows } from "./leaderboard";

describe("rankRows", () => {
  it("sorts by total and lets ties share a rank", () => {
    const r = rankRows([
      { displayName: "Bo", total: 9000 },
      { displayName: "Al", total: 12000 },
      { displayName: "Cy", total: 12000 },
      { displayName: "Di", total: 10000 },
    ]);
    expect(r.map((x) => [x.displayName, x.rank])).toEqual([["Al", 1], ["Cy", 1], ["Di", 3], ["Bo", 4]]);
  });
});
