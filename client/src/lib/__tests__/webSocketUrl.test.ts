import { describe, expect, it } from 'vitest';
import { webSocketUrl } from '../webSocketUrl';

describe('webSocketUrl', () => {
  it('builds a ws URL from an http page', () => {
    expect(
      webSocketUrl('/api/events', {
        protocol: 'http:',
        host: 'localhost:5173'
      })
    ).toBe('ws://localhost:5173/api/events');
  });

  it('builds a wss URL from an https page', () => {
    expect(
      webSocketUrl('api/events', {
        protocol: 'https:',
        host: 'example.com'
      })
    ).toBe('wss://example.com/api/events');
  });
});
