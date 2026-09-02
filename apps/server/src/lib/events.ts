import { EventEmitter } from 'node:events';
import type { EventType, StreamEvent } from '@postal/shared';

/**
 * In-process pub/sub feeding the SSE endpoint. Deliberately not durable: a
 * dashboard that reconnects re-reads state from the API, so a dropped event is
 * a cosmetic gap rather than lost data. Scaling past one instance would swap
 * this for a Redis pub/sub channel behind the same two functions.
 */
class EventBus extends EventEmitter {
  constructor() {
    super();
    // Dashboards, the metrics ticker and tests all subscribe; the default of 10
    // is low enough to produce spurious leak warnings under normal load.
    this.setMaxListeners(100);
  }

  publish(type: EventType, payload: unknown): void {
    const event: StreamEvent = { type, at: new Date().toISOString(), payload };
    this.emit('event', event);
  }

  subscribe(listener: (event: StreamEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}

export const eventBus = new EventBus();
