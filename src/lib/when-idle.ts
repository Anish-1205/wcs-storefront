/** Run `fn` once the page has loaded and the main thread is idle. Returns a cancel function. */
export function whenIdle(fn: () => void): () => void {
  // Safari has no requestIdleCallback; a short timeout still lands after load.
  const hasIdle = typeof window.requestIdleCallback === "function";
  let cancelled = false;
  let handle: number | undefined;
  const run = () => {
    if (cancelled) return;
    handle = hasIdle ? window.requestIdleCallback(fn, { timeout: 3000 }) : window.setTimeout(fn, 200);
  };
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener("load", run);
    if (handle === undefined) return;
    if (hasIdle) window.cancelIdleCallback(handle);
    else window.clearTimeout(handle);
  };
}
