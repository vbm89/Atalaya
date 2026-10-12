/**
 * Poll `run` every `intervalMs` only while the page is visible. Hidden tabs
 * stop polling; when the tab becomes visible again it fetches once at once
 * and resumes the interval. Returns a stop function.
 */
export interface PollEnv {
  isHidden: () => boolean;
  onVisibilityChange: (fn: () => void) => () => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
}

function browserEnv(): PollEnv {
  return {
    isHidden: () => document.visibilityState === "hidden",
    onVisibilityChange: (fn) => {
      document.addEventListener("visibilitychange", fn);
      return () => document.removeEventListener("visibilitychange", fn);
    },
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id as number),
  };
}

export function startVisiblePoll(run: () => void, intervalMs: number, env: PollEnv = browserEnv()): () => void {
  let timer: unknown = null;
  const stopTimer = () => {
    if (timer != null) env.clearInterval(timer);
    timer = null;
  };
  const resume = () => {
    stopTimer();
    if (env.isHidden()) return;
    run();
    timer = env.setInterval(() => {
      if (!env.isHidden()) run();
    }, intervalMs);
  };
  const off = env.onVisibilityChange(resume);
  resume();
  return () => {
    off();
    stopTimer();
  };
}
