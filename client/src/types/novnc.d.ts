/**
 * Minimal type declarations for @novnc/novnc (the package ships no types).
 * Only the surface the VNC viewer actually uses is declared. Events are
 * dispatched as CustomEvents on the RFB instance: 'connect', 'disconnect'
 * (detail: { clean: boolean }), 'clipboard' (detail: { text: string }),
 * 'credentialsrequired', 'securityfailure'.
 */
declare module '@novnc/novnc' {
  export interface RFBCredentials {
    username?: string;
    password?: string;
    target?: string;
  }

  export interface RFBOptions {
    shared?: boolean;
    credentials?: RFBCredentials;
    repeaterID?: string;
    wsProtocols?: string[];
  }

  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      urlOrChannel: string | WebSocket,
      options?: RFBOptions
    );

    /** Scale the remote framebuffer to fit the container element. */
    scaleViewport: boolean;
    /** Ask the server to resize the session to the container size. */
    resizeSession: boolean;
    clipViewport: boolean;
    viewOnly: boolean;
    focusOnClick: boolean;
    /** CSS background of the letterboxed area around the framebuffer. */
    background: string;
    qualityLevel: number;
    compressionLevel: number;

    disconnect(): void;
    focus(options?: FocusOptions): void;
    blur(): void;
    sendCredentials(credentials: RFBCredentials): void;
    /** Send a key event to the remote server. Omitting down sends press+release. */
    sendKey(keysym: number, code: string, down?: boolean): void;
    /**
     * Send text to the remote clipboard. Uses the extended-clipboard
     * pseudo-encoding (UTF-8) when the server supports it, so non-Latin-1
     * text (for example Japanese) is preserved.
     */
    clipboardPasteFrom(text: string): void;
  }
}
