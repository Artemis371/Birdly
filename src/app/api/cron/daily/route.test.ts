import { afterEach, describe, expect, it, vi } from "vitest";

const resolveAll = vi.fn(async () => ({ checked: 0, paid: [], waiting: [], errors: [], timedOut: false }));
vi.mock("@/lib/resolution/server", () => ({ resolveAll: () => resolveAll() }));
vi.mock("@/lib/custom/notify", () => ({ notifyEndedCustomMarkets: async () => ({ sent: 0, failed: 0, skipped: null }) }));
vi.mock("@/lib/snapshots", () => ({ snapshotAll: async () => ({ recorded: 0, skipped: null }) }));
vi.mock("@/lib/env", () => ({ isConfigured: () => true }));
const { GET } = await import("./route");

const call = (auth?: string) => GET(new Request("http://x/api/cron/daily", { headers: auth ? { authorization: auth } : {} }));

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.clearAllMocks();
});

describe("daily cron route", () => {
  it("refuses everything when CRON_SECRET isn't set", async () => {
    expect((await call("Bearer undefined")).status).toBe(401);
    expect(resolveAll).not.toHaveBeenCalled();
  });
  it("refuses a missing or wrong secret", async () => {
    process.env.CRON_SECRET = "s3cret-value-1234";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(resolveAll).not.toHaveBeenCalled();
  });
  it("runs with the right secret", async () => {
    process.env.CRON_SECRET = "s3cret-value-1234";
    expect((await call("Bearer s3cret-value-1234")).status).toBe(200);
    expect(resolveAll).toHaveBeenCalledTimes(1);
  });
});
