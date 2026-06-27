import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentEvents } from '../useAgentEvents';

const WEB_SOCKET_CONNECTING = 0;
const WEB_SOCKET_OPEN = 1;
const WEB_SOCKET_CLOSED = 3;

class MockWebSocket {
  static readonly CONNECTING = WEB_SOCKET_CONNECTING;
  static readonly OPEN = WEB_SOCKET_OPEN;
  static readonly CLOSING = 2;
  static readonly CLOSED = WEB_SOCKET_CLOSED;
  static instances: MockWebSocket[] = [];

  readonly CONNECTING = WEB_SOCKET_CONNECTING;
  readonly OPEN = WEB_SOCKET_OPEN;
  readonly CLOSING = 2;
  readonly CLOSED = WEB_SOCKET_CLOSED;
  readonly url: string;
  readonly extensions = '';
  readonly protocol = '';
  binaryType = 'blob';
  readonly bufferedAmount = 0;
  readyState = WEB_SOCKET_CONNECTING;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
  close = vi.fn(() => {
    this.readyState = WEB_SOCKET_CLOSED;
  });
  send = vi.fn();

  constructor(url: string | URL) {
    this.url = String(url);
    MockWebSocket.instances.push(this);
  }

  addEventListener(): void {}

  removeEventListener(): void {}

  dispatchEvent(): boolean {
    return true;
  }

  emitOpen(): void {
    this.readyState = WEB_SOCKET_OPEN;
    this.onopen?.call(this as unknown as WebSocket, new Event('open'));
  }

  emitClose(): void {
    this.readyState = WEB_SOCKET_CLOSED;
    this.onclose?.call(this as unknown as WebSocket, new CloseEvent('close'));
  }

  emitMessage(data: string): void {
    this.onmessage?.call(
      this as unknown as WebSocket,
      new MessageEvent('message', { data })
    );
  }
}

describe('useAgentEvents', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    document.body.dataset.csrfToken = 'csrf-token-1';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete document.body.dataset.csrfToken;
    vi.unstubAllGlobals();
  });

  it('opens a WebSocket for the project event stream', () => {
    const onEvent = vi.fn();
    const { result } = renderHook(() => useAgentEvents('project-1', onEvent));

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe(
      `ws://${window.location.host}/api/agent/projects/project-1/events?_csrf=csrf-token-1`
    );

    act(() => {
      MockWebSocket.instances[0].emitOpen();
    });

    expect(result.current.connection).toBe('open');
  });

  it('validates incoming events before invoking the callback', () => {
    const onEvent = vi.fn();
    renderHook(() => useAgentEvents('project-1', onEvent));

    act(() => {
      MockWebSocket.instances[0].emitMessage(
        JSON.stringify({ type: 'project-status', status: 'running' })
      );
      MockWebSocket.instances[0].emitMessage(
        JSON.stringify({ type: 'unknown-event' })
      );
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({
      type: 'project-status',
      status: 'running'
    });
  });

  it('reconnects after the socket closes', () => {
    renderHook(() => useAgentEvents('project-1', vi.fn()));

    act(() => {
      MockWebSocket.instances[0].emitClose();
      vi.advanceTimersByTime(1000);
    });

    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('closes the WebSocket on unmount without reconnecting', () => {
    const { unmount } = renderHook(() => useAgentEvents('project-1', vi.fn()));
    const socket = MockWebSocket.instances[0];

    unmount();

    expect(socket.close).toHaveBeenCalledTimes(1);
    act(() => {
      socket.emitClose();
      vi.advanceTimersByTime(1000);
    });
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
