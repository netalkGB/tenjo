import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import logger from '../../logger';
import type { Tool } from '../types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Default User-Agent string sent on every request the agent makes.
 * Mirrors a current desktop Chrome on Linux. Override per-controller via
 * {@link BrowserConfig.userAgent}.
 */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const BROWSER_NAVIGATE_TOOL_NAME = 'browser_navigate';
export const BROWSER_BACK_TOOL_NAME = 'browser_back';
export const BROWSER_SNAPSHOT_TOOL_NAME = 'browser_snapshot';
export const BROWSER_CLICK_TOOL_NAME = 'browser_click';
export const BROWSER_TYPE_TOOL_NAME = 'browser_type';
export const BROWSER_PRESS_KEY_TOOL_NAME = 'browser_press_key';
export const BROWSER_SCROLL_TOOL_NAME = 'browser_scroll';
export const BROWSER_WAIT_FOR_TOOL_NAME = 'browser_wait_for';
export const BROWSER_READ_TOOL_NAME = 'browser_read';
export const BROWSER_DUCKDUCKGO_SEARCH_TOOL_NAME = 'browser_duckduckgo_search';

/**
 * Canonical URL of the page that {@link createBrowserDuckDuckGoSearchTool}
 * loads for a given query. Exported so other code (e.g. the activity relay
 * that surfaces search progress in the UI) can produce the same URL without
 * duplicating the format string. Keep in sync with the navigation inside
 * {@link createBrowserDuckDuckGoSearchTool}.
 */
export function buildDuckDuckGoSearchUrl(query: string): string {
  const url = new URL('https://lite.duckduckgo.com/lite/');
  url.searchParams.set('q', sanitizeDuckDuckGoQuery(query));
  return url.toString();
}

/**
 * Strip double quotes from a search query. Unlike Google, DuckDuckGo treats
 * a double-quoted phrase as a strict literal match and very frequently
 * returns zero results, so any double quotes the model adds are removed
 * before the query is sent. Covers the straight ASCII quote plus the common
 * curly / fullwidth variants.
 */
export function sanitizeDuckDuckGoQuery(query: string): string {
  return query
    .replace(/["“”＂]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const DEFAULT_SNAPSHOT_CHAR_LIMIT = 20_000;
const DEFAULT_READ_CHAR_LIMIT = 10_000;
const NAV_SNAPSHOT_DEPTH = 3;
const NAV_SNAPSHOT_MAX_CHARS = 5_000;
const SNAPSHOT_COMPACT_DEPTH = 4;
const SNAPSHOT_FULL_DEPTH = 8;
const NAV_LINK_LIMIT = 50;
const SEARCH_PAGES_PER_CALL = 2;
const WAIT_DEFAULT_TIMEOUT_MS = 30_000;
const WAIT_MAX_TIME_SECONDS = 30;

// ============================================================================
// System prompt hints
// ============================================================================

export const BROWSER_TOOL_SYSTEM_HINT =
  'You drive a real Chromium browser. The session persists across calls within a conversation (cookies, history, scroll position).';

export const BROWSER_ACCESSIBILITY_SYSTEM_HINT =
  'browser_navigate / browser_back / browser_snapshot return an aria YAML where each interactive element has a [ref=eN] marker. Use those refs with browser_click and browser_type. Refs go stale after any navigation or DOM change — take a fresh browser_snapshot. browser_snapshot returns a compact tree by default; pass full: true only when the compact one is missing what you need. browser_type covers textboxes (pass text), <select> (pass option label), checkbox (pass "true"/"false"), radio (value ignored). To submit a form, browser_press_key with key="Enter" and the same ref.';

/**
 * Research-quality guidance for an agent that searches via the
 * {@link createBrowserDuckDuckGoSearchTool}. Covers SERP triage, when to stop,
 * blocked-page fallback, and service-specific queries — the parts NOT already
 * inlined into the agent's persistence-quota instructions.
 */
export const BROWSER_RESEARCH_SYSTEM_HINT = [
  'Search with browser_duckduckgo_search (plain-text query; phrase the query in the language most likely to hold the answer — usually the topic\'s native language, which is not necessarily the user\'s language). Do NOT wrap terms in double quotes: unlike Google, DuckDuckGo reads quoted text as a strict literal match and usually returns no results — just list keywords separated by spaces. The results page it returns is just LEADS, NOT the answer. SKIP sponsored / ad listings (marked "Ad" / "Sponsored" / "PR" in the snapshot). DO NOT just open the first organic result — scan AT LEAST the top 3–5 organic result titles + snippets and pick the one MOST RELEVANT to your specific query. The first result is frequently wrong for ambiguous queries (common names, generic terms, partial-match searches): e.g. "<full-name> 好物" can return results about a different person who shares the surname, or a fan page that has no "好物" answer at all. Cross-check the result title / domain against the entities and concepts in the query before navigating, then browser_read the chosen result.',
  'STOP AS SOON AS one authoritative page (the official site, the product / topic page, Wikipedia, the primary source) clearly answers the question — do not burn time on extra pages. Read more pages only when the first was insufficient: the answer is ambiguous, the source is weak / unofficial, or the question is contested / requires comparison. If the page you opened turns out to be about the wrong entity (e.g. a name collision), go back to the results and pick a different one rather than re-running the same query.',
  'Before answering: confirm you have read at least one full page with browser_read (not just SERP snippets).',
  'If browser_duckduckgo_search returns blocked: true, do NOT immediately retry the same query — retry with a meaningfully different query, and if it stays blocked, navigate Wikipedia directly (Wikipedia is the one allowed direct-URL navigation). NEVER fall back to prior-knowledge answers.',
  "Service-specific queries (Spotify / Amazon / Rakuten / YouTube etc.): web search won't surface internal item URLs. Navigate the service's top page, use its in-page search box, and report items with the URLs you actually loaded.",
].join(' ');

export const BROWSER_REPORTING_SYSTEM_HINT = [
  'Cite every source. End your answer with a "References" bulleted list of the URLs you actually loaded.',
  'For "find / cheapest / best / where can I buy" queries: include each item\'s URL INLINE next to its data, not only in References. Example: "<item name> <price>: https://www.amazon.com/dp/B0XXXXXXXX". Item-URL patterns: Amazon /dp/XXX, eBay /itm/. Get them from the navigate result\'s `links` array.',
  'NEVER cite a search-results / category / homepage URL as if it were the item URL — those are leads, not answers. If you only have those, click into the actual item first.',
  'Copy URLs VERBATIM (no "...", no dropping query params, no decoding percent-encoding). Never invent or template URLs. Never tell the user to search themselves.',
].join(' ');

// ============================================================================
// Configuration types
// ============================================================================

export interface RequestDelayConfig {
  /** Minimum delay in ms (inclusive). */
  min: number;
  /** Maximum delay in ms (inclusive). */
  max: number;
}

export type HeadlessMode = 'new' | 'shell';

export interface BrowserConfig {
  /** Run Chromium without a window (no UI). Default false. */
  headless?: boolean;
  /**
   * Which Chromium headless implementation to use when `headless` is true.
   * - 'new' (default): Chromium's modern headless mode (`--headless=new`).
   * - 'shell': the legacy `chromium-headless-shell` binary.
   * Ignored when `headless` is false.
   */
  headlessMode?: HeadlessMode;
  /** User-Agent string sent on every navigation. */
  userAgent?: string;
  /**
   * Random pause inserted between successive navigations issued by the
   * same controller. Pass `false` to disable. Default: 500–3000 ms.
   */
  requestDelay?: RequestDelayConfig | false;
}

// ============================================================================
// Result types
// ============================================================================

export interface PageLink {
  text: string;
  url: string;
}

export interface BrowserNavigateResult {
  url: string;
  title: string;
  status: number | null;
  /** Compact aria snapshot of the loaded page so the model can pick refs. */
  snapshot: string;
  /** Whether `snapshot` was truncated. */
  snapshotTruncated: boolean;
  /** Length of the full (untruncated) snapshot. */
  snapshotFullLength: number;
  /**
   * Up to {@link NAV_LINK_LIMIT} unique outbound links scraped from the
   * page, with full untruncated URLs.
   */
  links: PageLink[];
  /**
   * True when the loaded page is an interstitial (challenge / verification
   * / error page) rather than the requested content.
   */
  blocked: boolean;
  /** Short human-readable reason populated when `blocked` is true. */
  blockedReason?: string;
}

// ============================================================================
// BrowserController — owns one Chromium process, context, and page
// ============================================================================

/**
 * Owns a single Chromium browser process plus its default context and
 * page. Each agent that needs a browser should construct its own controller
 * so concurrent agents do not fight over shared cookies, scroll position,
 * or navigation history. Lazy: Chromium does not launch until the first
 * {@link getPage} call.
 *
 * Pair every controller with a {@link close} call when the owning agent
 * shuts down — otherwise the Chromium process leaks.
 */
export class BrowserController {
  private headless: boolean;
  private headlessMode: HeadlessMode;
  private userAgent: string;
  private requestDelay: RequestDelayConfig | false;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private hasNavigated = false;

  constructor(config: BrowserConfig = {}) {
    this.headless = config.headless ?? false;
    this.headlessMode = config.headlessMode ?? 'new';
    this.userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
    this.requestDelay = config.requestDelay ?? { min: 500, max: 3000 };
  }

  /**
   * Update controller defaults. `requestDelay` takes effect on the next
   * navigation; the other fields only apply to a future Chromium launch
   * (call {@link close} first if you need to recreate the browser with
   * different headless / UA settings).
   */
  configure(config: BrowserConfig): void {
    if (config.headless !== undefined) this.headless = config.headless;
    if (config.headlessMode !== undefined)
      this.headlessMode = config.headlessMode;
    if (config.userAgent !== undefined) this.userAgent = config.userAgent;
    if (config.requestDelay !== undefined)
      this.requestDelay = config.requestDelay;
  }

  /**
   * Lazily launch (or reuse) the underlying Chromium browser, context, and
   * page, returning the page. Launch / context settings come from the
   * constructor config (or a later {@link configure} call).
   */
  async getPage(): Promise<Page> {
    if (!this.browser || !this.browser.isConnected()) {
      const { headless, headlessMode } = this;
      const args = ['--disable-blink-features=AutomationControlled'];
      // When headlessMode === 'new' we launch the full Chromium binary
      // and pass --headless=new for the modern headless mode. The
      // alternative (Playwright's built-in headless: true) uses the
      // smaller chromium-headless-shell binary.
      let launchHeadless = headless;
      if (headless && headlessMode === 'new') {
        launchHeadless = false;
        args.push('--headless=new');
      }
      logger.debug('Launching chromium', {
        headless,
        headlessMode,
        launchHeadless,
      });
      this.browser = await chromium.launch({
        headless: launchHeadless,
        args,
      });
      this.context = null;
      this.page = null;
    }
    if (!this.context) {
      const { userAgent } = this;
      this.context = await this.browser.newContext({
        userAgent,
        viewport: { width: 2560, height: 1440 },
      });
      logger.debug('Created browser context', { userAgent });
    }
    if (!this.page || this.page.isClosed()) {
      this.page = await this.context.newPage();
    }
    return this.page;
  }

  /** Close the underlying Chromium process and reset internal state. */
  async close(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (err) {
        logger.debug('Error closing browser (likely already gone)', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.browser = null;
      this.context = null;
      this.page = null;
      this.hasNavigated = false;
    }
  }

  /**
   * Sleep for a random duration drawn from the controller's configured
   * `requestDelay`. Resolves immediately if the delay is disabled.
   */
  async randomDelay(
    delay: RequestDelayConfig | false = this.requestDelay
  ): Promise<void> {
    if (!delay) return;
    const span = Math.max(0, delay.max - delay.min);
    const ms = delay.min + Math.floor(Math.random() * (span + 1));
    if (ms <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Insert the configured random delay between successive page navigations.
   * Skips the very first navigation in a session so interactive use isn't
   * needlessly slow. Reset by {@link close}.
   */
  async delayBetweenNavigations(): Promise<void> {
    if (!this.hasNavigated) {
      this.hasNavigated = true;
      return;
    }
    await this.randomDelay();
  }
}

// ============================================================================
// Helpers (page-pure, no controller state)
// ============================================================================

type ScrollDirection = 'up' | 'down' | 'top' | 'bottom';

const isScrollDirection = (v: unknown): v is ScrollDirection =>
  v === 'up' || v === 'down' || v === 'top' || v === 'bottom';

const TRUTHY_VALUES = ['true', '1', 'on', 'yes'];
const isTruthyString = (v: string): boolean =>
  TRUTHY_VALUES.includes(v.trim().toLowerCase());

/** Merge several buckets of page links into one list, de-duplicated by URL. */
function mergePageLinks(buckets: PageLink[][]): PageLink[] {
  const seen = new Set<string>();
  const merged: PageLink[] = [];
  for (const bucket of buckets) {
    for (const link of bucket) {
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      merged.push(link);
    }
  }
  return merged;
}

/**
 * Click DuckDuckGo Lite's "Next Page" submit button and wait for the next
 * SERP to load. The button lives in a form that already carries the query's
 * pagination token, so clicking is more reliable than a hand-built URL.
 * Returns false when no further page exists (button absent).
 */
async function clickNextSearchPage(page: Page): Promise<boolean> {
  const nextButton = page.locator('input[type="submit"][value*="Next" i]');
  if ((await nextButton.count()) === 0) return false;
  // The submit click triggers a full-document POST navigation; once click()
  // resolves the navigation has committed, so waitForLoadState observes the
  // new SERP rather than the old one.
  await nextButton.first().click();
  await page.waitForLoadState('load');
  return true;
}

const BLOCK_TEXT_PATTERN =
  /(captcha|i'?m not a robot|verify you.{0,20}human|unusual traffic|automated queries|are you a robot|reCAPTCHA|access denied|automated requests)/i;
const BLOCK_URL_PATTERN =
  /\/sorry\/|\/anomaly|recaptcha|static-pages\/41[78]|\/cdn-cgi\/challenge/i;

async function detectBlockedPage(page: Page): Promise<string | null> {
  try {
    const url = page.url();
    if (BLOCK_URL_PATTERN.test(url)) {
      return `redirected to interstitial page (${url})`;
    }
    const title = await page.title();
    if (BLOCK_TEXT_PATTERN.test(title)) {
      return `interstitial title "${title}"`;
    }
    const visibleText = await page.evaluate(() =>
      (document.body?.innerText || '').slice(0, 4000)
    );
    if (BLOCK_TEXT_PATTERN.test(visibleText)) {
      return 'interstitial marker in page text';
    }
    return null;
  } catch {
    return null;
  }
}

async function capturePageLinks(page: Page): Promise<PageLink[]> {
  try {
    return await page.evaluate((max) => {
      const seen = new Set<string>();
      const out: { text: string; url: string }[] = [];
      const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href]');
      for (const a of Array.from(anchors)) {
        const url = a.href;
        if (!url || !url.startsWith('http')) continue;
        if (seen.has(url)) continue;
        const text = (a.textContent || '').trim().replace(/\s+/g, ' ');
        if (!text || text.length < 2) continue;
        seen.add(url);
        out.push({ text: text.slice(0, 200), url });
        if (out.length >= max) break;
      }
      return out;
    }, NAV_LINK_LIMIT);
  } catch {
    return [];
  }
}

async function captureCompactSnapshot(page: Page): Promise<{
  snapshot: string;
  truncated: boolean;
  fullLength: number;
}> {
  try {
    const full = await page.ariaSnapshot({
      mode: 'ai',
      depth: NAV_SNAPSHOT_DEPTH,
    });
    if (full.length <= NAV_SNAPSHOT_MAX_CHARS) {
      return { snapshot: full, truncated: false, fullLength: full.length };
    }
    return {
      snapshot:
        full.slice(0, NAV_SNAPSHOT_MAX_CHARS) +
        `\n[...truncated ${full.length - NAV_SNAPSHOT_MAX_CHARS} chars; call browser_snapshot for the full / deeper tree]`,
      truncated: true,
      fullLength: full.length,
    };
  } catch {
    return { snapshot: '', truncated: false, fullLength: 0 };
  }
}

// ============================================================================
// Tool factories — each returns a Tool bound to a specific BrowserController
// ============================================================================

export function createBrowserNavigateTool(controller: BrowserController): Tool {
  return {
    definition: {
      type: 'function',
      function: {
        name: BROWSER_NAVIGATE_TOOL_NAME,
        description:
          "Navigate the Chromium browser to a URL and wait for the page to load. Use this for any URL — including search queries: just construct the search engine's URL (e.g. https://lite.duckduckgo.com/lite/?q=ENCODED_QUERY) and navigate. Returns the final URL, the document title, a compact aria snapshot (so you can pick a [ref=eN] for the next click/type without a separate browser_snapshot), AND a `links` array with every visible outbound link as {text, url} pairs (full untruncated URLs — use these when citing sources or comparing items on a listing page). If the snapshot is truncated, call browser_snapshot for the full tree.",
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description:
                'Absolute URL to navigate to (must include the scheme, e.g. https://example.com).',
            },
          },
          required: ['url'],
        },
      },
    },
    handler: async (args) => {
      const url = typeof args.url === 'string' ? args.url : '';
      if (!url) {
        return { error: 'Missing required argument: url' };
      }
      try {
        const page = await controller.getPage();
        await controller.delayBetweenNavigations();
        const response = await page.goto(url, { waitUntil: 'load' });
        const [snap, links, blockedReason] = await Promise.all([
          captureCompactSnapshot(page),
          capturePageLinks(page),
          detectBlockedPage(page),
        ]);
        const result: BrowserNavigateResult = {
          url: page.url(),
          title: await page.title(),
          status: response?.status() ?? null,
          snapshot: snap.snapshot,
          snapshotTruncated: snap.truncated,
          snapshotFullLength: snap.fullLength,
          links,
          blocked: blockedReason !== null,
          ...(blockedReason ? { blockedReason } : {}),
        };
        return result;
      } catch (err) {
        return {
          error:
            err instanceof Error ? err.message : 'Unknown navigation error',
        };
      }
    },
  };
}

export function createBrowserBackTool(controller: BrowserController): Tool {
  return {
    definition: {
      type: 'function',
      function: {
        name: BROWSER_BACK_TOOL_NAME,
        description:
          "Go back one step in browser history (equivalent to clicking the browser's back button). Useful after drilling into a result link to return to the search results page. Returns the new URL, title, and a compact aria snapshot of the page (same shape as browser_navigate). Returns an error if there is no history to go back to.",
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
    handler: async () => {
      try {
        const page = await controller.getPage();
        await controller.delayBetweenNavigations();
        const response = await page.goBack({ waitUntil: 'load' });
        if (!response) {
          return { error: 'No history entry to go back to.' };
        }
        const [snap, links, blockedReason] = await Promise.all([
          captureCompactSnapshot(page),
          capturePageLinks(page),
          detectBlockedPage(page),
        ]);
        const result: BrowserNavigateResult = {
          url: page.url(),
          title: await page.title(),
          status: response.status(),
          snapshot: snap.snapshot,
          snapshotTruncated: snap.truncated,
          snapshotFullLength: snap.fullLength,
          links,
          blocked: blockedReason !== null,
          ...(blockedReason ? { blockedReason } : {}),
        };
        return result;
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'Unknown back-nav error',
        };
      }
    },
  };
}

export function createBrowserSnapshotTool(controller: BrowserController): Tool {
  return {
    definition: {
      type: 'function',
      function: {
        name: BROWSER_SNAPSHOT_TOOL_NAME,
        description: `Capture the accessibility tree of the current page as a YAML string. Each interactive node is tagged with a \`[ref=eN]\` marker that can be passed to browser_click and browser_type. By default a compact tree (depth ${SNAPSHOT_COMPACT_DEPTH}, capped near ${DEFAULT_SNAPSHOT_CHAR_LIMIT} chars) is returned — pass \`full: true\` for a deeper tree (depth ${SNAPSHOT_FULL_DEPTH}) when the compact one is missing what you need.`,
        parameters: {
          type: 'object',
          properties: {
            full: {
              type: 'boolean',
              description:
                'Return a deeper accessibility tree. Default false (compact).',
            },
          },
          required: [],
        },
      },
    },
    handler: async (args) => {
      try {
        const page = await controller.getPage();
        const full = args.full === true;
        const fullSnapshot = await page.ariaSnapshot({
          mode: 'ai',
          depth: full ? SNAPSHOT_FULL_DEPTH : SNAPSHOT_COMPACT_DEPTH,
        });

        const fullLength = fullSnapshot.length;
        const cap = DEFAULT_SNAPSHOT_CHAR_LIMIT;
        const truncated = fullLength > cap;
        const snapshot = truncated
          ? fullSnapshot.slice(0, cap) +
            `\n[...truncated ${fullLength - cap} chars; call browser_snapshot again with full: true to get a deeper tree]`
          : fullSnapshot;

        return {
          url: page.url(),
          title: await page.title(),
          snapshot,
          snapshotLength: snapshot.length,
          fullLength,
          truncated,
        };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'Unknown snapshot error',
        };
      }
    },
  };
}

export function createBrowserClickTool(controller: BrowserController): Tool {
  return {
    definition: {
      type: 'function',
      function: {
        name: BROWSER_CLICK_TOOL_NAME,
        description:
          'Click the element identified by an aria-snapshot ref (the value inside `[ref=...]`, e.g. `e3`). Take a fresh browser_snapshot first if you have not yet, or if the page changed.',
        parameters: {
          type: 'object',
          properties: {
            ref: {
              type: 'string',
              description:
                'The ref id from the latest browser_snapshot, e.g. "e3" (without brackets).',
            },
          },
          required: ['ref'],
        },
      },
    },
    handler: async (args) => {
      const ref = typeof args.ref === 'string' ? args.ref : '';
      if (!ref) {
        return { error: 'Missing required argument: ref' };
      }
      try {
        const page = await controller.getPage();
        await page.locator(`aria-ref=${ref}`).click();
        return { success: true, url: page.url() };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'Unknown click error',
        };
      }
    },
  };
}

export function createBrowserTypeTool(controller: BrowserController): Tool {
  return {
    definition: {
      type: 'function',
      function: {
        name: BROWSER_TYPE_TOOL_NAME,
        description:
          "Enter a value into the element identified by an aria-snapshot ref. Behaviour depends on the element: <select> → choose the option whose label or value equals `value`; checkbox → set checked from `value` (truthy strings: 'true','1','on','yes'); radio → check the targeted radio (the value is ignored); text/search/email/etc. inputs → fill with `value`. Take a fresh browser_snapshot before calling if the page may have changed.",
        parameters: {
          type: 'object',
          properties: {
            ref: {
              type: 'string',
              description:
                'The ref id from the latest browser_snapshot, e.g. "e3" (without brackets).',
            },
            value: {
              type: 'string',
              description:
                'Value to enter. Text for inputs; option label/value for <select>; "true"/"false" for checkboxes; ignored for radios.',
            },
          },
          required: ['ref', 'value'],
        },
      },
    },
    handler: async (args) => {
      const ref = typeof args.ref === 'string' ? args.ref : '';
      const value = typeof args.value === 'string' ? args.value : '';
      if (!ref) {
        return { error: 'Missing required argument: ref' };
      }
      try {
        const page = await controller.getPage();
        const locator = page.locator(`aria-ref=${ref}`);

        const elementInfo = await locator.evaluate((el) => {
          const tag = el.tagName.toLowerCase();
          const inputType =
            el instanceof HTMLInputElement ? el.type.toLowerCase() : null;
          const role = el.getAttribute('role');
          return { tag, inputType, role };
        });

        if (elementInfo.tag === 'select') {
          await locator.selectOption(value);
        } else if (
          elementInfo.tag === 'input' &&
          elementInfo.inputType === 'checkbox'
        ) {
          await locator.setChecked(isTruthyString(value));
        } else if (
          elementInfo.tag === 'input' &&
          elementInfo.inputType === 'radio'
        ) {
          await locator.check();
        } else if (elementInfo.role === 'checkbox') {
          await locator.setChecked(isTruthyString(value));
        } else if (elementInfo.role === 'radio') {
          await locator.check();
        } else {
          await locator.fill(value);
        }

        return {
          success: true,
          elementType: elementInfo.tag,
          inputType: elementInfo.inputType,
        };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'Unknown type error',
        };
      }
    },
  };
}

export function createBrowserPressKeyTool(controller: BrowserController): Tool {
  return {
    definition: {
      type: 'function',
      function: {
        name: BROWSER_PRESS_KEY_TOOL_NAME,
        description:
          "Press a keyboard key. Use this to submit search forms (Enter), tab between fields, dismiss modals (Escape), navigate option lists (ArrowUp/ArrowDown), or trigger shortcuts (e.g. 'Control+a'). If `ref` is given the element is focused first and the key is dispatched to it; otherwise the key goes to whatever currently has focus on the page.",
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description:
                "Key name as accepted by Playwright. Common values: 'Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp', 'Home', 'End'. Single characters work too. Modifiers can be combined with '+' (e.g. 'Control+a').",
            },
            ref: {
              type: 'string',
              description:
                'Optional aria-snapshot ref. When provided, the element is focused before the key press, so this is the right way to "type then submit" against a specific input.',
            },
          },
          required: ['key'],
        },
      },
    },
    handler: async (args) => {
      const key = typeof args.key === 'string' ? args.key : '';
      if (!key) {
        return { error: 'Missing required argument: key' };
      }
      const ref = typeof args.ref === 'string' ? args.ref : '';
      try {
        const page = await controller.getPage();
        if (ref) {
          await page.locator(`aria-ref=${ref}`).press(key);
        } else {
          await page.keyboard.press(key);
        }
        return { success: true, key, ref: ref || null, url: page.url() };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'Unknown press error',
        };
      }
    },
  };
}

export function createBrowserScrollTool(controller: BrowserController): Tool {
  return {
    definition: {
      type: 'function',
      function: {
        name: BROWSER_SCROLL_TOOL_NAME,
        description:
          "Scroll the page or bring a snapshot element into view. Pass `ref` (from browser_snapshot) to scrollIntoView. Otherwise pass `direction` ('up' | 'down' | 'top' | 'bottom') for a window-level scroll. Optional `amount` overrides the per-step pixel count for up/down (default: one viewport height).",
        parameters: {
          type: 'object',
          properties: {
            ref: {
              type: 'string',
              description:
                'Aria-snapshot ref to scroll into view (mutually exclusive with `direction`).',
            },
            direction: {
              type: 'string',
              enum: ['up', 'down', 'top', 'bottom'],
              description: 'Window-level scroll direction.',
            },
            amount: {
              type: 'number',
              description:
                'Pixels to scroll for direction=up/down. Defaults to one viewport height.',
            },
          },
          required: [],
        },
      },
    },
    handler: async (args) => {
      try {
        const page = await controller.getPage();
        const ref = typeof args.ref === 'string' ? args.ref : '';

        if (ref) {
          await page.locator(`aria-ref=${ref}`).scrollIntoViewIfNeeded();
          return { success: true, mode: 'into-view', ref };
        }

        const direction: ScrollDirection = isScrollDirection(args.direction)
          ? args.direction
          : 'down';
        const amount =
          typeof args.amount === 'number' && Number.isFinite(args.amount)
            ? args.amount
            : null;

        const position = await page.evaluate(
          ({ dir, step }) => {
            const fallbackStep = step ?? window.innerHeight;
            switch (dir) {
              case 'top':
                window.scrollTo(0, 0);
                break;
              case 'bottom':
                window.scrollTo(0, document.body.scrollHeight);
                break;
              case 'up':
                window.scrollBy(0, -fallbackStep);
                break;
              case 'down':
                window.scrollBy(0, fallbackStep);
                break;
            }
            return { x: window.scrollX, y: window.scrollY };
          },
          { dir: direction, step: amount }
        );

        return { success: true, mode: 'page', direction, position };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'Unknown scroll error',
        };
      }
    },
  };
}

export function createBrowserWaitForTool(controller: BrowserController): Tool {
  return {
    definition: {
      type: 'function',
      function: {
        name: BROWSER_WAIT_FOR_TOOL_NAME,
        description:
          'Wait for a condition before proceeding. Specify exactly one of: `text` (wait until that string is visible on the page), `textGone` (wait until that string is no longer visible), or `time` (just sleep for N seconds, capped at 30). Useful after triggering AJAX or animations. Returns when the condition is met or throws on timeout.',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Wait until this text is visible on the page.',
            },
            textGone: {
              type: 'string',
              description: 'Wait until this text is no longer visible.',
            },
            time: {
              type: 'number',
              description:
                'Wait this many seconds (max 30). Use sparingly — prefer text-based waits.',
            },
            timeoutMs: {
              type: 'number',
              description:
                'Max wait time for text/textGone in milliseconds (default 30000).',
            },
          },
          required: [],
        },
      },
    },
    handler: async (args) => {
      try {
        const page = await controller.getPage();
        const text = typeof args.text === 'string' ? args.text : null;
        const textGone =
          typeof args.textGone === 'string' ? args.textGone : null;
        const time = typeof args.time === 'number' ? args.time : null;
        const timeout =
          typeof args.timeoutMs === 'number'
            ? args.timeoutMs
            : WAIT_DEFAULT_TIMEOUT_MS;

        const specified = [text, textGone, time].filter(
          (v) => v !== null
        ).length;
        if (specified === 0) {
          return { error: 'Specify one of: text, textGone, time' };
        }
        if (specified > 1) {
          return { error: 'Specify only one of: text, textGone, time' };
        }

        if (time !== null) {
          const seconds = Math.min(Math.max(time, 0), WAIT_MAX_TIME_SECONDS);
          await page.waitForTimeout(seconds * 1000);
          return { success: true, waited: 'time', seconds };
        }
        if (text !== null) {
          await page
            .getByText(text)
            .first()
            .waitFor({ state: 'visible', timeout });
          return { success: true, waited: 'text', text };
        }
        if (textGone !== null) {
          await page
            .getByText(textGone)
            .first()
            .waitFor({ state: 'hidden', timeout });
          return { success: true, waited: 'textGone', text: textGone };
        }
        return { error: 'unreachable' };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'Unknown wait error',
        };
      }
    },
  };
}

export function createBrowserReadTool(controller: BrowserController): Tool {
  return {
    definition: {
      type: 'function',
      function: {
        name: BROWSER_READ_TOOL_NAME,
        description: `Extract clean visible text from the current page using innerText (no HTML, no aria YAML noise). Use this AFTER navigating to a content page (article, wiki, blog, product description) when you actually want to READ the content for summarization or fact extraction. Far more useful than browser_snapshot for prose; browser_snapshot is for finding interactive refs to click/type. Pass \`ref\` to extract only that element's text. Result is truncated to ${DEFAULT_READ_CHAR_LIMIT} chars by default — pass \`maxChars\` to override.`,
        parameters: {
          type: 'object',
          properties: {
            ref: {
              type: 'string',
              description:
                "Optional aria-snapshot ref. When given, only that element's innerText is returned (e.g. an <article> or <main>). Otherwise the full body text is returned.",
            },
            maxChars: {
              type: 'number',
              description: `Cap on the text length returned. Default ${DEFAULT_READ_CHAR_LIMIT}. The result is truncated with a [...] marker when it exceeds this.`,
            },
          },
          required: [],
        },
      },
    },
    handler: async (args) => {
      try {
        const page = await controller.getPage();
        const ref = typeof args.ref === 'string' ? args.ref : '';
        const maxChars =
          typeof args.maxChars === 'number' && Number.isFinite(args.maxChars)
            ? args.maxChars
            : DEFAULT_READ_CHAR_LIMIT;

        const fullText = ref
          ? await page.locator(`aria-ref=${ref}`).innerText()
          : await page.evaluate(() => document.body.innerText);

        const fullLength = fullText.length;
        const truncated = fullLength > maxChars;
        const text = truncated
          ? fullText.slice(0, maxChars) +
            `\n[...truncated ${fullLength - maxChars} chars; call browser_read again with a larger maxChars or pass a ref to scope to one element]`
          : fullText;

        return {
          url: page.url(),
          title: await page.title(),
          text,
          textLength: text.length,
          fullLength,
          truncated,
        };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'Unknown read error',
        };
      }
    },
  };
}

export function createBrowserDuckDuckGoSearchTool(
  controller: BrowserController
): Tool {
  return {
    definition: {
      type: 'function',
      function: {
        name: BROWSER_DUCKDUCKGO_SEARCH_TOOL_NAME,
        description:
          `Run a DuckDuckGo web search. Pass \`query\` as plain text (e.g. 'OpenAI o1 release date') — the tool navigates to DuckDuckGo's text-only Lite SERP and, in a SINGLE call, collects the first ${SEARCH_PAGES_PER_CALL} results pages (clicking the Next-Page button for you) and returns their results merged. Returns the same shape as browser_navigate (url, title, snapshot, links, blocked): \`snapshot\` concatenates the pages and \`links\` is the merged, de-duplicated result list. Use this instead of manually navigating to the DuckDuckGo top page and typing into the search box. After this call, scan the organic results in the snapshot/links — DO NOT just navigate the first one. Compare each result title against the entities/concepts in your query and pick the MOST RELEVANT one (for ambiguous names or generic terms, the first result is often the wrong entity). Skip ads/sponsored listings. Then browser_navigate / browser_read the chosen result.`,
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'The search query as plain text. The tool URL-encodes it; do not pre-encode. Do NOT wrap terms or phrases in double quotes — unlike Google, DuckDuckGo treats quoted text as a strict literal match and usually returns zero results. Just list the keywords separated by spaces.',
            },
          },
          required: ['query'],
        },
      },
    },
    handler: async (args) => {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) {
        return { error: 'Missing required argument: query' };
      }
      const url = buildDuckDuckGoSearchUrl(query);
      try {
        const page = await controller.getPage();
        await controller.delayBetweenNavigations();
        const response = await page.goto(url, { waitUntil: 'load' });
        const status = response?.status() ?? null;

        // Collect the first SEARCH_PAGES_PER_CALL consecutive SERP pages so a
        // single call surfaces two pages of results merged together.
        const snapshots: string[] = [];
        const linkBuckets: PageLink[][] = [];
        let snapshotTruncated = false;
        let snapshotFullLength = 0;
        let blockedReason: string | null = null;
        for (
          let pageNumber = 1;
          pageNumber <= SEARCH_PAGES_PER_CALL;
          pageNumber++
        ) {
          if (pageNumber > 1) {
            await controller.delayBetweenNavigations();
            if (!(await clickNextSearchPage(page))) break;
          }
          const [snap, pageLinks, blocked] = await Promise.all([
            captureCompactSnapshot(page),
            capturePageLinks(page),
            detectBlockedPage(page),
          ]);
          snapshots.push(
            `===== DuckDuckGo results page ${pageNumber} =====\n${snap.snapshot}`
          );
          linkBuckets.push(pageLinks);
          snapshotTruncated = snapshotTruncated || snap.truncated;
          snapshotFullLength += snap.fullLength;
          blockedReason = blockedReason ?? blocked;
        }

        // Treat 403 / 429 / 503 as a load failure even when the URL did
        // not change to a known interstitial pattern, so the caller can
        // fall back instead of trying to parse an error page.
        const httpBlocked =
          status !== null &&
          (status === 403 || status === 429 || status === 503);
        const finalBlockedReason =
          blockedReason ??
          (httpBlocked ? `DuckDuckGo returned HTTP ${status}` : null);
        const result: BrowserNavigateResult = {
          url: page.url(),
          title: await page.title(),
          status,
          snapshot: snapshots.join('\n\n'),
          snapshotTruncated,
          snapshotFullLength,
          links: mergePageLinks(linkBuckets),
          blocked: finalBlockedReason !== null,
          ...(finalBlockedReason ? { blockedReason: finalBlockedReason } : {}),
        };
        return result;
      } catch (err) {
        return {
          error:
            err instanceof Error
              ? err.message
              : 'Unknown DuckDuckGo search error',
        };
      }
    },
  };
}

/**
 * Convenience: build the full set of browser tools for a given controller.
 * Use this when you want every tool — most agents do.
 */
export function createBrowserTools(controller: BrowserController): Tool[] {
  return [
    createBrowserNavigateTool(controller),
    createBrowserBackTool(controller),
    createBrowserSnapshotTool(controller),
    createBrowserClickTool(controller),
    createBrowserTypeTool(controller),
    createBrowserPressKeyTool(controller),
    createBrowserScrollTool(controller),
    createBrowserWaitForTool(controller),
    createBrowserReadTool(controller),
    createBrowserDuckDuckGoSearchTool(controller),
  ];
}
