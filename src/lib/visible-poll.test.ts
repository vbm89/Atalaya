import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startVisiblePoll, type PollEnv } from "./visible-poll.ts";

function fakeEnv(hidden = false) {
  const state = { hidden, timers: new Map<number, () => void>(), next: 1, listeners: new Set<() => void>() };
  const env: PollEnv = {
    isHidden: () => state.hidden,
    onVisibilityChange: (fn) => {
      state.listeners.add(fn);
      return () => state.listeners.delete(fn);
    },
    setInterval: (fn) => {
      const id = state.next++;
      state.timers.set(id, fn);
      return id;
    },
    clearInterval: (id) => {
      state.timers.delete(id as number);
    },
  };
  const tick = () => [...state.timers.values()].forEach((fn) => fn());
  const setHidden = (h: boolean) => {
    state.hidden = h;
    state.listeners.forEach((fn) => fn());
  };
  return { env, state, tick, setHidden };
}

describe("startVisiblePoll", () => {
  it("fetches at once, then on each interval while visible", () => {
    const f = fakeEnv(false);
    let runs = 0;
    startVisiblePoll(() => (runs += 1), 60_000, f.env);
    assert.equal(runs, 1);
    f.tick();
    f.tick();
    assert.equal(runs, 3);
  });

  it("stops while hidden and fetches once when visible again", () => {
    const f = fakeEnv(false);
    let runs = 0;
    startVisiblePoll(() => (runs += 1), 60_000, f.env);
    f.setHidden(true);
    assert.equal(f.state.timers.size, 0);
    f.tick();
    assert.equal(runs, 1);
    f.setHidden(false);
    assert.equal(runs, 2);
    assert.equal(f.state.timers.size, 1);
  });

  it("does not fetch when started hidden; stop clears timer and listener", () => {
    const f = fakeEnv(true);
    let runs = 0;
    const stop = startVisiblePoll(() => (runs += 1), 60_000, f.env);
    assert.equal(runs, 0);
    f.setHidden(false);
    assert.equal(runs, 1);
    stop();
    assert.equal(f.state.timers.size, 0);
    assert.equal(f.state.listeners.size, 0);
  });
});
