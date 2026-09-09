/** Non-blocking scheduling for chrome side-effects (cookies, DOM attrs). */

export function afterPaint(task: () => void) {
  if (typeof window === "undefined") {
    task();
    return;
  }

  requestAnimationFrame(() => {
    task();
  });
}

export function runIdle(task: () => void, timeout = 120) {
  if (typeof window === "undefined") {
    task();
    return;
  }

  const ric = window.requestIdleCallback;
  if (typeof ric === "function") {
    ric(() => task(), { timeout });
    return;
  }

  window.setTimeout(task, 0);
}
