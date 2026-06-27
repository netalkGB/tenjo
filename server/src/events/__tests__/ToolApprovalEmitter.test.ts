import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Notification } from 'pg';

// Use vi.hoisted so mock objects are available inside vi.mock factory
const { mockPoolClient, mockPool } = vi.hoisted(() => {
  const client = {
    query: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    release: vi.fn()
  };
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn().mockResolvedValue(undefined)
  };
  return { mockPoolClient: client, mockPool: pool };
});

vi.mock('../../db/client', () => ({
  pool: mockPool
}));

// Capture the notification handler registered via client.on('notification', ...)
let notificationHandler: ((msg: Notification) => void) | null = null;
mockPoolClient.on.mockImplementation(
  (event: string, handler: (msg: Notification) => void) => {
    if (event === 'notification') {
      notificationHandler = handler;
    }
  }
);

import {
  toolApprovalEmitter,
  ToolApprovalTimeoutError,
  ToolApprovalCancelledError
} from '../ToolApprovalEmitter';

function buildNotification(
  overrides: Partial<Notification> = {}
): Notification {
  return {
    channel: 'tool_approval',
    payload: undefined,
    processId: 1,
    name: 'notification',
    ...overrides
  } as Notification;
}

describe('ToolApprovalEmitter', () => {
  const emitter = toolApprovalEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
    notificationHandler = null;
    // Re-register the on mock implementation after clearAllMocks
    mockPoolClient.on.mockImplementation(
      (event: string, handler: (msg: Notification) => void) => {
        if (event === 'notification') {
          notificationHandler = handler;
        }
      }
    );
    mockPoolClient.query.mockResolvedValue(undefined);
    mockPool.connect.mockResolvedValue(mockPoolClient);
    mockPool.query.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await emitter.stop();
  });

  describe('start', () => {
    it('should acquire a pool client and LISTEN on the tool_approval channel', async () => {
      await emitter.start();

      expect(mockPool.connect).toHaveBeenCalledOnce();
      expect(mockPoolClient.on).toHaveBeenCalledWith(
        'notification',
        expect.any(Function)
      );
      expect(mockPoolClient.query).toHaveBeenCalledWith('LISTEN tool_approval');
    });

    it('should register a notification handler that emits toolCallId events', async () => {
      await emitter.start();

      expect(notificationHandler).not.toBeNull();

      const emitSpy = vi.spyOn(emitter, 'emit');

      notificationHandler!(
        buildNotification({
          payload: JSON.stringify({ toolCallId: 'tc-1', approved: true })
        })
      );

      expect(emitSpy).toHaveBeenCalledWith('tc-1', true);
    });

    it('should ignore notifications on other channels', async () => {
      await emitter.start();

      const emitSpy = vi.spyOn(emitter, 'emit');

      notificationHandler!(
        buildNotification({
          channel: 'other_channel',
          payload: JSON.stringify({ toolCallId: 'tc-1', approved: true })
        })
      );

      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('should ignore notifications with no payload', async () => {
      await emitter.start();

      const emitSpy = vi.spyOn(emitter, 'emit');

      notificationHandler!(buildNotification({ payload: undefined }));

      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('waitForApproval', () => {
    it('should resolve true when approved', async () => {
      await emitter.start();

      const promise = emitter.waitForApproval('tc-approve');

      notificationHandler!(
        buildNotification({
          payload: JSON.stringify({ toolCallId: 'tc-approve', approved: true })
        })
      );

      await expect(promise).resolves.toBe(true);
    });

    it('should resolve false when rejected', async () => {
      await emitter.start();

      const promise = emitter.waitForApproval('tc-reject');

      notificationHandler!(
        buildNotification({
          payload: JSON.stringify({
            toolCallId: 'tc-reject',
            approved: false
          })
        })
      );

      await expect(promise).resolves.toBe(false);
    });

    it('should reject with ToolApprovalTimeoutError on timeout', async () => {
      vi.useFakeTimers();

      await emitter.start();

      const promise = emitter.waitForApproval('tc-timeout', 1000);

      vi.advanceTimersByTime(1000);

      await expect(promise).rejects.toThrow(ToolApprovalTimeoutError);
      await expect(promise).rejects.toThrow(
        'Tool approval timed out: tc-timeout'
      );

      vi.useRealTimers();
    });

    it('should use default timeout of 5 minutes', async () => {
      vi.useFakeTimers();

      await emitter.start();

      const promise = emitter.waitForApproval('tc-default-timeout');

      // Advance just under 5 minutes - should not have timed out yet
      vi.advanceTimersByTime(5 * 60 * 1000 - 1);

      // Resolve it before the timeout fires
      notificationHandler!(
        buildNotification({
          payload: JSON.stringify({
            toolCallId: 'tc-default-timeout',
            approved: true
          })
        })
      );

      await expect(promise).resolves.toBe(true);

      vi.useRealTimers();
    });

    it('should clean up listeners after resolution', async () => {
      await emitter.start();

      const promise = emitter.waitForApproval('tc-cleanup');

      notificationHandler!(
        buildNotification({
          payload: JSON.stringify({
            toolCallId: 'tc-cleanup',
            approved: true
          })
        })
      );

      await promise;

      expect(emitter.listenerCount('tc-cleanup')).toBe(0);
      expect(emitter.listenerCount('__cancel__:tc-cleanup')).toBe(0);
    });

    it('should clean up listeners after timeout', async () => {
      vi.useFakeTimers();

      await emitter.start();

      const promise = emitter.waitForApproval('tc-timeout-cleanup', 100);

      vi.advanceTimersByTime(100);

      await expect(promise).rejects.toThrow(ToolApprovalTimeoutError);

      expect(emitter.listenerCount('tc-timeout-cleanup')).toBe(0);
      expect(emitter.listenerCount('__cancel__:tc-timeout-cleanup')).toBe(0);

      vi.useRealTimers();
    });
  });

  describe('cancelApproval', () => {
    it('should reject pending waitForApproval with ToolApprovalCancelledError', async () => {
      await emitter.start();

      const promise = emitter.waitForApproval('tc-cancel');

      emitter.cancelApproval('tc-cancel');

      await expect(promise).rejects.toThrow(ToolApprovalCancelledError);
      await expect(promise).rejects.toThrow(
        'Tool approval cancelled: tc-cancel'
      );
    });

    it('should clean up listeners after cancellation', async () => {
      await emitter.start();

      const promise = emitter.waitForApproval('tc-cancel-cleanup');

      emitter.cancelApproval('tc-cancel-cleanup');

      await promise.catch(() => {
        // Expected rejection
      });

      expect(emitter.listenerCount('tc-cancel-cleanup')).toBe(0);
      expect(emitter.listenerCount('__cancel__:tc-cancel-cleanup')).toBe(0);
    });

    it('should be a no-op when no pending approval exists', () => {
      // Should not throw
      emitter.cancelApproval('nonexistent');
    });
  });

  describe('sendApproval', () => {
    it('should send NOTIFY with approved=true', async () => {
      await emitter.sendApproval('tc-send-approve', true);

      const expectedPayload = JSON.stringify({
        toolCallId: 'tc-send-approve',
        approved: true
      });
      expect(mockPool.query).toHaveBeenCalledWith(
        `NOTIFY tool_approval, '${expectedPayload}'`
      );
    });

    it('should send NOTIFY with approved=false', async () => {
      await emitter.sendApproval('tc-send-reject', false);

      const expectedPayload = JSON.stringify({
        toolCallId: 'tc-send-reject',
        approved: false
      });
      expect(mockPool.query).toHaveBeenCalledWith(
        `NOTIFY tool_approval, '${expectedPayload}'`
      );
    });

    it('should escape single quotes in the payload', async () => {
      await emitter.sendApproval("tc-with'quote", true);

      const rawPayload = JSON.stringify({
        toolCallId: "tc-with'quote",
        approved: true
      });
      const escapedPayload = rawPayload.replace(/'/g, "''");
      expect(mockPool.query).toHaveBeenCalledWith(
        `NOTIFY tool_approval, '${escapedPayload}'`
      );
    });
  });

  describe('stop', () => {
    it('should UNLISTEN, release client, and clear listeners', async () => {
      await emitter.start();

      await emitter.stop();

      expect(mockPoolClient.query).toHaveBeenCalledWith(
        'UNLISTEN tool_approval'
      );
      expect(mockPoolClient.release).toHaveBeenCalledOnce();
    });

    it('should be safe to call stop when not started', async () => {
      // Should not throw even when client is null
      await expect(emitter.stop()).resolves.toBeUndefined();
    });

    it('should remove all event listeners', async () => {
      await emitter.start();

      // Add a listener
      emitter.on('test-event', () => {});

      await emitter.stop();

      expect(emitter.listenerCount('test-event')).toBe(0);
    });

    it('should allow stop to be called multiple times', async () => {
      await emitter.start();

      await emitter.stop();
      await emitter.stop();

      // release should only be called once since client is nulled after first stop
      expect(mockPoolClient.release).toHaveBeenCalledOnce();
    });
  });

  describe('error classes', () => {
    it('ToolApprovalTimeoutError should have correct name and message', () => {
      const error = new ToolApprovalTimeoutError('tc-1');
      expect(error.name).toBe('ToolApprovalTimeoutError');
      expect(error.message).toBe('Tool approval timed out: tc-1');
      expect(error).toBeInstanceOf(Error);
    });

    it('ToolApprovalCancelledError should have correct name and message', () => {
      const error = new ToolApprovalCancelledError('tc-2');
      expect(error.name).toBe('ToolApprovalCancelledError');
      expect(error.message).toBe('Tool approval cancelled: tc-2');
      expect(error).toBeInstanceOf(Error);
    });
  });
});
