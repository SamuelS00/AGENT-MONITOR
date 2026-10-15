// `tauri build` refuses to build when an npm package and its Rust crate differ in major.minor, but lint, tests and
// `cargo check` do not notice. This catches the mismatch where those checks run. Like the Tauri CLI, it compares the
// versions actually installed, not the ranges in package.json.
import { describe, expect, it } from "vitest";
import cargoLock from "../src-tauri/Cargo.lock?raw";
import apiPackage from "../node_modules/@tauri-apps/api/package.json?raw";

const plugins = import.meta.glob("../node_modules/@tauri-apps/plugin-*/package.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const majorMinor = (version: string) => version.split(".").slice(0, 2).join(".");
const crateVersion = (name: string) => new RegExp(`name = "${name}"\\nversion = "([^"]+)"`).exec(cargoLock)?.[1];
const versionOf = (packageJson: string) => (JSON.parse(packageJson) as { version: string }).version;

describe("Tauri npm packages and Rust crates", () => {
  it("keeps every installed @tauri-apps/plugin-* in step with its crate", () => {
    const entries = Object.entries(plugins);
    expect(entries.length, "at least one plugin is installed").toBeGreaterThan(0);
    for (const [path, raw] of entries) {
      const name = /plugin-([^/]+)\/package\.json$/.exec(path)![1];
      const crate = `tauri-plugin-${name}`;
      expect(crateVersion(crate), `${crate} is in Cargo.lock`).toBeDefined();
      expect(majorMinor(versionOf(raw)), `@tauri-apps/plugin-${name} vs ${crate}`).toBe(majorMinor(crateVersion(crate)!));
    }
  });

  it("keeps @tauri-apps/api in step with the tauri crate", () => {
    expect(majorMinor(versionOf(apiPackage))).toBe(majorMinor(crateVersion("tauri")!));
  });
});
