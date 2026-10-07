// Minimal Chrome DevTools Protocol client for Bun (no `playwright` dependency: the npm package is
// NOT resolvable in this repo — verified — so Chromium is driven directly over CDP).
//
// Bun exposes a global `WebSocket`, and CDP's discovery endpoints (`/json/version`, `/json/list`)
// are plain HTTP, so a browser target can be attached without any client library.
export class CDP {
  static async attach(wsUrl, { timeoutMs = 20000 } = {}) {
    const socket = new WebSocket(wsUrl)
    const session = new CDP(socket)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP websocket did not open within " + String(timeoutMs) + " ms")), timeoutMs)
      socket.addEventListener("open", () => { clearTimeout(timer); resolve() })
      socket.addEventListener("error", (event) => { clearTimeout(timer); reject(new Error("CDP websocket error: " + String(event?.message ?? "unknown"))) })
      socket.addEventListener("message", (event) => session.#onMessage(event.data))
      socket.addEventListener("close", () => session.#onClose())
    })
    return session
  }

  #socket
  #nextId = 1
  #pending = new Map()
  #listeners = new Map()
  closed = false
  closeReason = null

  constructor(socket) {
    this.#socket = socket
  }

  #onClose() {
    this.closed = true
    this.closeReason = "socket closed"
    for (const [, entry] of this.#pending) entry.reject(new Error("CDP socket closed before the response arrived"))
    this.#pending.clear()
  }

  #onMessage(data) {
    let message
    try {
      message = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data))
    } catch {
      return
    }
    if (message.id !== undefined) {
      const entry = this.#pending.get(message.id)
      if (entry === undefined) return
      this.#pending.delete(message.id)
      if (message.error !== undefined) entry.reject(new Error(message.method + ": " + JSON.stringify(message.error)))
      else entry.resolve(message.result)
      return
    }
    const handlers = this.#listeners.get(message.method)
    if (handlers === undefined) return
    for (const handler of [...handlers]) {
      try {
        handler(message.params)
      } catch { /* a broken probe listener must not break the session */ }
    }
  }

  on(method, handler) {
    const list = this.#listeners.get(method) ?? []
    list.push(handler)
    this.#listeners.set(method, list)
    return () => {
      const current = this.#listeners.get(method) ?? []
      this.#listeners.set(method, current.filter((entry) => entry !== handler))
    }
  }

  send(method, params = {}) {
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      try {
        this.#socket.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        this.#pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /** Evaluate an expression in the page and return its JSON value (throws on a page exception). */
  async evaluate(expression, { awaitPromise = true, timeoutMs = 30000 } = {}) {
    const result = await Promise.race([
      this.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: true, timeout: timeoutMs }),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("Runtime.evaluate timed out after " + String(timeoutMs) + " ms")), timeoutMs + 1000)),
    ])
    if (result.exceptionDetails !== undefined && result.exceptionDetails !== null) {
      const detail = result.exceptionDetails
      throw new Error("page exception: " + String(detail.exception?.description ?? detail.text ?? "unknown"))
    }
    return result.result?.value
  }

  async waitFor(expression, { timeoutMs = 30000, intervalMs = 250, label = expression } = {}) {
    const deadline = Date.now() + timeoutMs
    let last = null
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(expression)
      } catch (error) {
        last = "EVAL-ERROR: " + String(error?.message ?? error)
      }
      if (last === true) return true
      await new Promise((done) => setTimeout(done, intervalMs))
    }
    throw new Error("waitFor timed out (" + String(timeoutMs) + " ms) for " + label + "; last value: " + JSON.stringify(last))
  }

  async mouseClick(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" })
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 })
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 })
  }

  /** A REAL pointer click at the element's centre (never `el.click()`: this is a browser test). */
  async clickSelector(selector, { index = 0 } = {}) {
    const box = await this.evaluate(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = els[${index}];
      if (el === undefined) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height, count: els.length };
    })()`)
    if (box === null) return { clicked: false, reason: "no element for " + selector, matched: 0 }
    if (box.width === 0 || box.height === 0) return { clicked: false, reason: "zero-size element", box }
    await this.mouseClick(box.x, box.y)
    return { clicked: true, box }
  }

  async screenshot(path) {
    const result = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })
    await Bun.write(path, Buffer.from(result.data, "base64"))
    return { path, bytes: Buffer.from(result.data, "base64").byteLength }
  }

  dispose() {
    try {
      this.#socket.close()
    } catch { /* already closed */ }
  }
}

/** Poll `/json/list` until a page target appears, then attach to it. */
export async function attachToPage(port, { timeoutMs = 30000, urlIncludes = null, log = () => {} } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastTargets = []
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch("http://127.0.0.1:" + String(port) + "/json/list", { signal: AbortSignal.timeout(4000) })).json()
      lastTargets = targets.filter((target) => target.type === "page")
      const target = lastTargets.find((entry) => urlIncludes === null || String(entry.url).includes(urlIncludes)) ?? lastTargets[0]
      if (target !== undefined && typeof target.webSocketDebuggerUrl === "string") {
        log("[cdp] attaching to target " + target.id + " url=" + String(target.url).replace(/token=[A-Za-z0-9_-]+/, "token=<redacted>"))
        return { session: await CDP.attach(target.webSocketDebuggerUrl), target }
      }
    } catch { /* chrome not listening yet */ }
    await new Promise((done) => setTimeout(done, 400))
  }
  throw new Error("no CDP page target appeared on 127.0.0.1:" + String(port) + "; last targets: " + JSON.stringify(lastTargets.map((target) => target.type + ":" + target.url)))
}
