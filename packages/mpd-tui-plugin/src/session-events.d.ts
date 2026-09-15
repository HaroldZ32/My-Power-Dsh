/**
 * The log-only session event this plugin appends, declared for consumers.
 *
 * The two iron rules of the session-event seam (spec §接缝一) are:
 *   1. the event must be LOG-ONLY (no `surfaceOp`) — the model never sees it;
 *   2. its type must be registered in every reachable dsh-session copy's
 *      `KNOWN_SESSION_EVENT_TYPES`, or a strict read path (resume, persistence
 *      load) refuses the whole log.
 *
 * Rule 2 is implemented at runtime in `../registration.ts`. This declaration
 * exists so a consumer (and a future typed reader) knows the vocabulary; it is
 * a pure ambient declaration, deliberately in a `.d.ts` with no top-level
 * import/export, because this package resolves no `@deepseek-ai/*` package at
 * build time.
 */
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records that the user opened the mpd board (log-only UI state).
     * @param data - which entry point opened it and when.
     */
    'mpd-tui/board-opened': {
      readonly view: string
      readonly via: 'command' | 'shortcut'
      readonly at: number
    }
  }
}
