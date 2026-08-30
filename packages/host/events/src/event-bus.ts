/**
 * Typed in-process event bus.
 *
 * The bus is the core's "single source of truth" (ADR-003 / ADR-010): every
 * state transition is emitted here and projected outward to frontends via the
 * protocol layer. Keeping the bus generic over an event map means each manager
 * gets full type safety without a monolithic event registry.
 */

/** Maps event names to their payload types. */
export interface EventMap {
  [name: string]: unknown;
}

/** Listener contract; async listeners are awaited by {@link EventBus.emit}. */
export type EventListener<E> = (event: E) => void | Promise<void>;

/** Optional sink for listener errors (defaults to rethrow via queueMicrotask). */
export type ErrorHandler = (error: unknown, eventName: string) => void;

/** Listener for every event name, regardless of subscription time. */
export type AllEventsListener<M extends EventMap> = (name: keyof M, event: M[keyof M]) => void | Promise<void>;

interface Entry<E> {
  fn: EventListener<E>;
  once: boolean;
}

export class EventBus<M extends EventMap> {
  private readonly entries = new Map<keyof M, Set<Entry<M[keyof M]>>>();
  private readonly allListeners = new Set<AllEventsListener<M>>();
  private errorHandler: ErrorHandler | undefined;

  /**
   * Registers a callback invoked whenever `name` is emitted.
   * @returns an unsubscribe function.
   */
  subscribe<K extends keyof M>(name: K, fn: EventListener<M[K]>): () => void {
    return this.add(name, { fn: fn as EventListener<M[keyof M]>, once: false });
  }

  /**
   * Registers a callback invoked at most once.
   * @returns an unsubscribe function (safe to call after firing).
   */
  once<K extends keyof M>(name: K, fn: EventListener<M[K]>): () => void {
    return this.add(name, { fn: fn as EventListener<M[keyof M]>, once: true });
  }

  /**
   * Registers a callback invoked for every emitted event (used by the daemon
   * to forward engine events onto the wire).
   * @returns an unsubscribe function.
   */
  subscribeAll(listener: AllEventsListener<M>): () => void {
    this.allListeners.add(listener);
    return () => this.allListeners.delete(listener);
  }

  /**
   * Emits an event to all subscribers. Listeners run sequentially and are
   * awaited; a throwing listener is isolated (reported via the error handler)
   * and does not prevent the remaining listeners from running.
   */
  async emit<K extends keyof M>(name: K, event: M[K]): Promise<void> {
    const named = this.entries.get(name) ? Array.from(this.entries.get(name)!) : [];
    const all = Array.from(this.allListeners);
    // Sequential, ordered delivery is intentional: async listeners read shared
    // state, so ordering must be deterministic (see ADR-010).
    /* oxlint-disable no-await-in-loop */
    for (const entry of named) {
      if (entry.once) {
        this.remove(name, entry);
      }
      try {
        await entry.fn(event);
      } catch (error) {
        this.reportError(error, String(name));
      }
    }
    for (const listener of all) {
      try {
        await listener(name, event);
      } catch (error) {
        this.reportError(error, String(name));
      }
    }
  }

  /** Number of subscribers for a given event name. */
  listenerCount<K extends keyof M>(name: K): number {
    return this.entries.get(name)?.size ?? 0;
  }

  /** Names with at least one subscriber (used for event forwarding). */
  eventNames(): Array<keyof M> {
    return [...this.entries.keys()];
  }

  /** Removes all subscribers across every event name. */
  clear(): void {
    this.entries.clear();
    this.allListeners.clear();
  }

  /** Overrides the error handler used for listener failures. */
  onError(handler: ErrorHandler): void {
    this.errorHandler = handler;
  }

  private add<K extends keyof M>(name: K, entry: Entry<M[keyof M]>): () => void {
    let set = this.entries.get(name);
    if (!set) {
      set = new Set();
      this.entries.set(name, set);
    }
    set.add(entry);
    return () => this.remove(name, entry);
  }

  private remove<K extends keyof M>(name: K, entry: Entry<M[keyof M]>): void {
    const set = this.entries.get(name);
    if (!set) return;
    set.delete(entry);
    if (set.size === 0) this.entries.delete(name);
  }

  private reportError(error: unknown, eventName: string): void {
    if (this.errorHandler) {
      this.errorHandler(error, eventName);
      return;
    }
    // Default: surface async so it cannot break the emit call stack.
    queueMicrotask(() => {
      throw error;
    });
  }
}
