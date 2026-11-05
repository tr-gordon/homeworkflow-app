import { describe, expect, it } from "vitest";
import {
  MAX_RUNNING_STRETCH_SECONDS,
  TimerError,
  elapsedSeconds,
  finishSession,
  formatClock,
  formatMinutes,
  isStretchCapped,
  newSession,
  pauseSession,
  resumeSession,
  totalActualSeconds,
} from "@/lib/domain/timer";

const t0 = new Date("2026-11-04T16:00:00Z");
const at = (secs: number) => new Date(t0.getTime() + secs * 1000);

describe("timer maths (R1-R4)", () => {
  it("counts live time while running", () => {
    const s = newSession("s1", "a1", "u1", t0);
    expect(elapsedSeconds(s, at(90))).toBe(90);
  });

  it("freezes while paused and resumes without losing time", () => {
    let s = newSession("s1", "a1", "u1", t0);
    s = pauseSession(s, at(600));
    expect(elapsedSeconds(s, at(5000))).toBe(600);
    s = resumeSession(s, at(5000));
    expect(elapsedSeconds(s, at(5300))).toBe(900);
  });

  it("finish commits the elapsed time", () => {
    let s = newSession("s1", "a1", "u1", t0);
    s = finishSession(s, at(1200));
    expect(s.state).toBe("finished");
    expect(s.accumulatedSeconds).toBe(1200);
    expect(elapsedSeconds(s, at(99999))).toBe(1200);
  });

  it("caps a forgotten running stretch (R3)", () => {
    const s = newSession("s1", "a1", "u1", t0);
    const later = at(10 * 3600);
    expect(isStretchCapped(s, later)).toBe(true);
    expect(elapsedSeconds(s, later)).toBe(MAX_RUNNING_STRETCH_SECONDS);
    expect(finishSession(s, later).accumulatedSeconds).toBe(MAX_RUNNING_STRETCH_SECONDS);
  });

  it("never goes negative if the clock is behind", () => {
    const s = newSession("s1", "a1", "u1", t0);
    expect(elapsedSeconds(s, at(-30))).toBe(0);
  });

  it("rejects invalid transitions", () => {
    const running = newSession("s1", "a1", "u1", t0);
    const paused = pauseSession(running, at(10));
    const done = finishSession(running, at(10));
    expect(() => resumeSession(running, at(1))).toThrow(TimerError);
    expect(() => pauseSession(paused, at(1))).toThrow(TimerError);
    expect(() => pauseSession(done, at(1))).toThrow(/timer_already_finished/);
    expect(() => finishSession(done, at(1))).toThrow(/timer_already_finished/);
  });

  it("sums across sessions", () => {
    const a = finishSession(newSession("a", "x", "u", t0), at(300));
    const b = newSession("b", "x", "u", at(1000));
    expect(totalActualSeconds([a, b], at(1060))).toBe(360);
  });

  it("formats", () => {
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(75)).toBe("1 h 15 min");
    expect(formatMinutes(120)).toBe("2 h");
  });
});
