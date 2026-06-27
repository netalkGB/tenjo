/** Inclusive host-port range, such as dev-server ports allocated to a project. */
export interface PortRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Parse the published HOST port range(s) from docker `-p` style specs. Each spec
 * is `[ip:]hostPorts:containerPorts`, where the port part is a single port or a
 * `start-end` range, for example `127.0.0.1:5180-5189:5180-5189` or `8080:8080`. Host
 * and container ports are configured 1:1, so the host range is both what the
 * agent binds inside the sandbox and what the user opens on localhost.
 */
export function parsePublishedHostRanges(
  publishPorts: readonly string[]
): PortRange[] {
  const ranges: PortRange[] = [];
  for (const spec of publishPorts) {
    const parts = spec.split(':');
    // The last colon segment is the container port(s); the segment before it
    // (or the only segment, when there is no host ip/port prefix) is the host
    // port(s) the user reaches on localhost.
    const hostPart = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    const [startText, endText] = hostPart.split('-');
    const start = Number.parseInt(startText, 10);
    if (!Number.isFinite(start)) {
      continue;
    }
    const end = endText !== undefined ? Number.parseInt(endText, 10) : start;
    ranges.push({ start, end: Number.isFinite(end) ? end : start });
  }
  return ranges;
}
