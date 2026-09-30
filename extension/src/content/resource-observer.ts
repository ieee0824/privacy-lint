/** Resource completion is a metadata-only signal; the reporter reads origins and kinds. */
export function watchResourceChanges(
  onChange: () => void,
  Observer: typeof PerformanceObserver | undefined = globalThis.PerformanceObserver,
): PerformanceObserver | null {
  if (!Observer) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new Observer(() => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 400);
  });
  try {
    observer.observe({ entryTypes: ["resource"] });
    return observer;
  } catch {
    observer.disconnect();
    return null;
  }
}
