/**
 * Mock for @tauri-apps/api/event
 *
 * Stores event handlers so tests can fire events with emitMockEvent().
 *
 * Supports two modes:
 *   - "immediate" (default): listen() resolves synchronously via Promise.resolve
 *   - "deferred": listen() hangs until resolveListen() is called manually
 */

type Handler = (event: { payload: unknown }) => void;

const handlers = new Map<string, Set<Handler>>();

type ListenMode = "immediate" | "deferred";
let listenMode: ListenMode = "immediate";
let pendingResolve: (() => void) | null = null;

/** Switch between immediate and deferred resolution for listen(). */
export function setListenMode(mode: ListenMode): void {
  listenMode = mode;
  pendingResolve = null;
}

/**
 * When in "deferred" mode, call this to resolve the pending listen() promise.
 * The unlisten function will be registered and the handler added to `handlers`.
 */
export function resolveListen(): void {
  if (pendingResolve) {
    pendingResolve();
    pendingResolve = null;
  }
}

export const listen = vi.fn(
  (event: string, handler: Handler): Promise<() => void> => {
    if (!handlers.has(event)) {
      handlers.set(event, new Set());
    }
    handlers.get(event)!.add(handler);
    const unlisten = () => {
      handlers.get(event)?.delete(handler);
    };

    if (listenMode === "deferred") {
      return new Promise<() => void>((resolve) => {
        pendingResolve = () => resolve(unlisten);
      });
    }
    return Promise.resolve(unlisten);
  }
);

export const emit = vi.fn(async (_event: string, _payload?: unknown) => {});

export function emitMockEvent(event: string, payload: unknown) {
  const eventHandlers = handlers.get(event);
  if (eventHandlers) {
    eventHandlers.forEach((handler) => handler({ payload }));
  }
}

export function resetMocks() {
  handlers.clear();
  listen.mockClear();
  emit.mockClear();
  listenMode = "immediate";
  pendingResolve = null;
}

/** Returns the number of registered handlers for a given event name. */
export function listenerCount(event: string): number {
  return handlers.get(event)?.size ?? 0;
}
