import { describe, expect, it } from "vitest";
import { BASE_MINUTES, estimateMinutes, type HistorySample } from "@/lib/domain/estimates";

const sample = (subject: string, difficulty: 1 | 2 | 3 | 4 | 5, minutes: number): HistorySample => ({
  subject,
  difficulty,
  actualSeconds: minutes * 60,
});

describe("estimateMinutes (T4)", () => {
  it("uses the difficulty baseline with no history", () => {
    for (const d of [1, 2, 3, 4, 5] as const) {
      const e = estimateMinutes(d, "Math", []);
      expect(e.minutes).toBe(BASE_MINUTES[d]);
      expect(e.basis).toBe("difficulty");
    }
  });

  it("stays on the baseline until there are 3 usable samples", () => {
    const e = estimateMinutes(3, "Math", [sample("Math", 3, 100), sample("Math", 3, 100)]);
    expect(e.basis).toBe("difficulty");
    expect(e.minutes).toBe(40);
  });

  it("blends toward the median of actual times once there is enough data", () => {
    // 3 samples -> weight 0.3; median 100 -> 40*0.7 + 100*0.3 = 58 -> rounds to 60
    const h = [sample("Math", 3, 100), sample("Math", 3, 100), sample("Math", 3, 100)];
    const e = estimateMinutes(3, "Math", h);
    expect(e.basis).toBe("history");
    expect(e.minutes).toBe(60);
    expect(e.explanation).toContain("3");
  });

  it("caps the weight at 80% so the baseline never fully disappears", () => {
    const h = Array.from({ length: 20 }, () => sample("Math", 3, 100));
    // 40*0.2 + 100*0.8 = 88 -> 90
    expect(estimateMinutes(3, "Math", h).minutes).toBe(90);
  });

  it("uses the median, so one outlier barely moves the estimate", () => {
    const h = [sample("Math", 2, 20), sample("Math", 2, 25), sample("Math", 2, 30), sample("Math", 2, 400)];
    const e = estimateMinutes(2, "Math", h); // median 27.5, weight .4 -> 25*.6+27.5*.4 = 26 -> 25
    expect(e.minutes).toBe(25);
  });

  it("prefers same-subject samples when there are at least 3", () => {
    const h = [
      sample("Math", 3, 80),
      sample("Math", 3, 80),
      sample("Math", 3, 80),
      sample("History", 3, 20),
      sample("History", 3, 20),
      sample("History", 3, 20),
    ];
    const math = estimateMinutes(3, " math ", h);
    const hist = estimateMinutes(3, "History", h);
    expect(math.scope).toBe("subject");
    expect(math.minutes).toBeGreaterThan(hist.minutes);
  });

  it("falls back to all samples at that difficulty when the subject is new", () => {
    const h = [sample("Math", 3, 60), sample("Math", 3, 60), sample("Science", 3, 60)];
    expect(estimateMinutes(3, "Art", h).scope).toBe("difficulty");
  });

  it("ignores other difficulties and accidental sub-2-minute sessions", () => {
    const h = [sample("Math", 4, 100), sample("Math", 4, 100), sample("Math", 4, 1)];
    expect(estimateMinutes(4, "Math", h).basis).toBe("difficulty");
    expect(estimateMinutes(3, "Math", h).minutes).toBe(40);
  });

  it("rounds to 5 minutes and stays in range", () => {
    const huge = Array.from({ length: 10 }, () => sample("Math", 5, 1000));
    const e = estimateMinutes(5, "Math", huge);
    expect(e.minutes % 5).toBe(0);
    expect(e.minutes).toBeLessThanOrEqual(240);
  });
});
