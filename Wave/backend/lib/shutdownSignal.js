let controller = new AbortController();
module.exports = {
  get signal() { return controller.signal; },   // read at call time, never cached
  abort() { controller.abort(); },
  reset() { controller = new AbortController(); },
};
