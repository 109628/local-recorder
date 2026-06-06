import { describe, expect, it } from "vitest";
import { buildXstackLayout, mixSessionInBrowser } from "@/lib/browser-mix";

describe("buildXstackLayout", () => {
  it("builds layout for one input", () => {
    expect(buildXstackLayout(1)).toBe("0_0");
  });

  it("builds layout for four inputs in 2x2", () => {
    expect(buildXstackLayout(4)).toBe("0_0|w0_0|0_h0|w0_h0");
  });

  it("builds layout for five inputs in 3-column grid", () => {
    expect(buildXstackLayout(5)).toBe("0_0|w0_0|2*w0_0|0_h0|w0_h0");
  });
});

describe("mixSessionInBrowser", () => {
  it("fails early when there are no uploaded chunks", async () => {
    await expect(
      mixSessionInBrowser({
        sessionId: "s1",
        participants: [{ participantId: "p1", recordStartAt: Date.now(), chunks: [] }],
      })
    ).rejects.toThrow("No uploaded chunks found in storage.");
  });
});
