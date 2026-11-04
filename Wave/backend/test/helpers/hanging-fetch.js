global.fetch = (url, opts = {}) => new Promise((_, reject) => {
  if (opts.signal) {
    opts.signal.addEventListener("abort", () =>
      reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  }
});
