/**
 * Screenshots for the design critique loop: every screen × state × viewport of the
 * prototype (or the running app's routes), taken with a local Chromium-family
 * browser in headless mode — one short-lived process per shot, sequential, holding
 * the project's command slot. The manifest records what was rendered when, so the
 * design gate can require fresh shots and a critique newer than them.
 */
export declare const STATES: readonly ["empty", "loading", "error", "success"];
export declare const VIEWPORTS: {
    readonly mobile: {
        readonly width: 360;
        readonly height: 800;
    };
    readonly tablet: {
        readonly width: 768;
        readonly height: 1024;
    };
    readonly desktop: {
        readonly width: 1280;
        readonly height: 800;
    };
    readonly phone: {
        readonly width: 390;
        readonly height: 844;
    };
};
export type ViewportId = keyof typeof VIEWPORTS;
export declare const MANIFEST = "design/shots/manifest.json";
export interface Shot {
    screen: string;
    state: string;
    viewport: ViewportId;
    file: string;
    width?: number;
    height?: number;
    sha256: string;
    /** A single colour: nothing rendered. */
    blank: boolean;
    /** Share of pixels changed since the previous shot of the same screen/state/viewport. */
    changedRatio?: number;
    error?: string;
}
export interface ShotManifest {
    generatedAt: string;
    source: "prototype" | "url";
    url?: string;
    browser: string;
    shots: Shot[];
    skipped: string[];
}
/** Viewports a screen is judged at, by platform. */
export declare function viewportsFor(platform: string): ViewportId[];
/** FORGE_BROWSER, Playwright's headless shell, then installed Chrome, Chromium, Edge or Brave. */
export declare function findBrowser(): string | undefined;
export declare const BROWSER_HINT = "No Chromium-family browser found \u2014 install one (`npx playwright install chromium-headless-shell`, or Chrome) or set FORGE_BROWSER to its executable";
/** Prototype states whose container still holds nothing but forge's placeholder comment. */
export declare function unfilledStates(root: string): {
    screen: string;
    state: string;
}[];
export declare function captureShots(root: string, options?: {
    url?: string;
    viewports?: ViewportId[];
    screens?: string[];
    timeoutMs?: number;
    onWait?: () => void;
}): Promise<ShotManifest>;
export declare function readManifest(root: string): ShotManifest | undefined;
/** What the design gate needs: a fully designed prototype, complete fresh non-blank shots, and a critique newer than them. */
export declare function shotProblems(root: string): string[];
