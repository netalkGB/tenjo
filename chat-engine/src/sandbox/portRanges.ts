/** Inclusive host-port range, such as dev-server ports allocated to a project. */
export interface PortRange {
  readonly start: number;
  readonly end: number;
}

/**
 * One docker `-p` spec, with host and container ranges kept separate so
 * mappings need not be 1:1 (`8080:5174`, `8080-8119:5174-5213`).
 */
export interface PublishedPortSpec {
  /** Optional bind address (`127.0.0.1`, `0.0.0.0`). */
  readonly bindIp?: string;
  readonly hostStart: number;
  readonly hostEnd: number;
  readonly containerStart: number;
  readonly containerEnd: number;
}

/** Default in-container VNC port pool when nothing is published to the host. */
export const DEFAULT_SANDBOX_VNC_PORT_RANGE: PortRange = {
  start: 5174,
  end: 5213,
};

function parsePortRange(part: string): PortRange | null {
  const [startText, endText] = part.split('-');
  const start = Number.parseInt(startText, 10);
  if (!Number.isFinite(start)) {
    return null;
  }
  const end = endText !== undefined ? Number.parseInt(endText, 10) : start;
  return { start, end: Number.isFinite(end) ? end : start };
}

/**
 * Split a docker `-p` spec into bind IP, host ports, and container ports.
 * Supports `8080:8080`, `127.0.0.1:5174-5213:5174-5213`, and
 * `0.0.0.0:8080:5174`. IPv6 bind addresses use `[::1]:host:container`.
 */
export function parsePublishedPortSpec(spec: string): PublishedPortSpec | null {
  let rest = spec;
  let bindIp: string | undefined;
  if (spec.startsWith('[')) {
    const close = spec.indexOf(']');
    if (close === -1) {
      return null;
    }
    bindIp = spec.slice(1, close);
    rest = spec.slice(close + 1);
    if (rest.startsWith(':')) {
      rest = rest.slice(1);
    }
  }
  const parts = rest.split(':');
  let hostPart: string;
  let containerPart: string;
  if (parts.length >= 3) {
    bindIp = (bindIp ?? parts.slice(0, -2).join(':')) || undefined;
    hostPart = parts[parts.length - 2];
    containerPart = parts[parts.length - 1];
  } else if (parts.length === 2) {
    hostPart = parts[0];
    containerPart = parts[1];
  } else {
    hostPart = parts[0];
    containerPart = parts[0];
  }
  const host = parsePortRange(hostPart);
  const container = parsePortRange(containerPart);
  if (!host || !container) {
    return null;
  }
  return {
    bindIp,
    hostStart: host.start,
    hostEnd: host.end,
    containerStart: container.start,
    containerEnd: container.end,
  };
}

export function parsePublishedPortSpecs(
  publishPorts: readonly string[]
): PublishedPortSpec[] {
  const specs: PublishedPortSpec[] = [];
  for (const spec of publishPorts) {
    const parsed = parsePublishedPortSpec(spec);
    if (parsed) {
      specs.push(parsed);
    }
  }
  return specs;
}

/**
 * Parse the published HOST port range(s) from docker `-p` style specs. Each spec
 * is `[ip:]hostPorts:containerPorts`, where the port part is a single port or a
 * `start-end` range, for example `127.0.0.1:5180-5189:5180-5189` or `8080:8080`.
 */
export function parsePublishedHostRanges(
  publishPorts: readonly string[]
): PortRange[] {
  return parsePublishedPortSpecs(publishPorts).map((spec) => ({
    start: spec.hostStart,
    end: spec.hostEnd,
  }));
}

/** Container-side ranges from `-p` specs (what the sandbox process binds). */
export function parsePublishedContainerRanges(
  publishPorts: readonly string[]
): PortRange[] {
  return parsePublishedPortSpecs(publishPorts).map((spec) => ({
    start: spec.containerStart,
    end: spec.containerEnd,
  }));
}

/**
 * Host port that docker maps to `containerPort`, or undefined when the
 * container port is not covered by any spec.
 */
export function mapContainerPortToHostPort(
  publishPorts: readonly string[],
  containerPort: number
): number | undefined {
  for (const spec of parsePublishedPortSpecs(publishPorts)) {
    if (
      containerPort < spec.containerStart ||
      containerPort > spec.containerEnd
    ) {
      continue;
    }
    const offset = containerPort - spec.containerStart;
    const hostPort = spec.hostStart + offset;
    if (hostPort > spec.hostEnd) {
      continue;
    }
    return hostPort;
  }
  return undefined;
}
