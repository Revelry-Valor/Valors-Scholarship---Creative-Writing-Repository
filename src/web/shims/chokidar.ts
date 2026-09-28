// The browser demo has no outside editors to watch.
export function watch() {
  const w = { on: () => w, close: async () => undefined };
  return w;
}
