import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom does not implement matchMedia. The shell only uses it to follow the
// system color scheme, so a passive stub is enough for tests.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// vitest runs without global APIs, so React Testing Library auto-cleanup must
// be registered explicitly.
afterEach(() => {
  cleanup();
});
