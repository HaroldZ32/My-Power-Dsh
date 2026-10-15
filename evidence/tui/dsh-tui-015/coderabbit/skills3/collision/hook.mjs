// Scratch diagnostic hook (preloaded with NODE_OPTIONS=--import): make the harness's duplicate-tool
// error print the call stack of the SECOND registration, so the mechanism is read off the harness
// rather than inferred. Nothing here is shipped; it only mutates this scratch process's globals.
const RealError = Error;
RealError.stackTraceLimit = 80;
class TracedError extends RealError {
  constructor(...args) {
    super(...args);
    try {
      const first = typeof args[0] === "string" ? args[0] : "";
      const isDuplicate = first.includes("is already registered");
      const isService = first.includes("already registered") && !isDuplicate;
      if (isDuplicate) {
        process.stderr.write("\n[hook] DUPLICATE-TOOL-REGISTRATION stack:\n" + String(this.stack) + "\n");
      } else if (isService) {
        process.stderr.write("\n[hook] SERVICE-ALREADY-REGISTERED: " + first + "\n" + String(this.stack) + "\n");
      }
    } catch { /* a diagnostic must never break the boot */ }
  }
}
globalThis.Error = TracedError;
