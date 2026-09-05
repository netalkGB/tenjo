import { describe, expect, it } from 'vitest';
import {
  mapContainerPortToHostPort,
  parsePublishedPortSpec
} from 'tenjo-chat-engine';
import {
  resolveSandboxVncHost,
  resolveSandboxVncPort,
  usesPublishedHostPort
} from '../sandboxVncTarget';

describe('parsePublishedPortSpec', () => {
  it('should parse host:container, bind IP, ranges, and non-1:1 maps', () => {
    expect(parsePublishedPortSpec('5174:5174')).toEqual({
      bindIp: undefined,
      hostStart: 5174,
      hostEnd: 5174,
      containerStart: 5174,
      containerEnd: 5174
    });
    expect(parsePublishedPortSpec('127.0.0.1:5174-5213:5174-5213')).toEqual({
      bindIp: '127.0.0.1',
      hostStart: 5174,
      hostEnd: 5213,
      containerStart: 5174,
      containerEnd: 5213
    });
    expect(parsePublishedPortSpec('0.0.0.0:8080:5174')).toEqual({
      bindIp: '0.0.0.0',
      hostStart: 8080,
      hostEnd: 8080,
      containerStart: 5174,
      containerEnd: 5174
    });
  });
});

describe('mapContainerPortToHostPort', () => {
  it('should map a non-1:1 container port onto the published host port', () => {
    expect(mapContainerPortToHostPort(['127.0.0.1:8080:5174'], 5174)).toBe(
      8080
    );
    expect(mapContainerPortToHostPort(['8080-8119:5174-5213'], 5176)).toBe(
      8082
    );
    expect(mapContainerPortToHostPort(['8080:5174'], 9999)).toBeUndefined();
  });
});

describe('resolveSandboxVncHost', () => {
  it('should prefer the override, then container IP, then loopback', () => {
    expect(resolveSandboxVncHost(' host.docker.internal ', '172.17.0.2')).toBe(
      'host.docker.internal'
    );
    expect(resolveSandboxVncHost(undefined, '172.17.0.2')).toBe('172.17.0.2');
    expect(resolveSandboxVncHost('', undefined)).toBe('127.0.0.1');
  });
});

describe('resolveSandboxVncPort', () => {
  it('should use the container port unless dialing via a published host', () => {
    expect(usesPublishedHostPort('172.17.0.2')).toBe(false);
    expect(usesPublishedHostPort('127.0.0.1')).toBe(true);
    expect(usesPublishedHostPort('host.docker.internal')).toBe(true);
    expect(
      resolveSandboxVncPort('172.17.0.2', 5174, ['127.0.0.1:8080:5174'])
    ).toBe(5174);
    expect(
      resolveSandboxVncPort('127.0.0.1', 5174, ['127.0.0.1:8080:5174'])
    ).toBe(8080);
    expect(resolveSandboxVncPort('127.0.0.1', 5174, [])).toBe(5174);
  });
});
