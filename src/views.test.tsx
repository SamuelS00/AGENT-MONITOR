// Smoke tests: every view must render from the labeled sample dataset without
// crashing, and navigation must update the toolbar title. Sample data is
// fictional and always labeled as such (see AGENTS.md).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "./App";

vi.mock("./monitor", () => ({
  inTauri: () => false,
  loadSnapshot: vi.fn(),
  refreshCollector: vi.fn(),
}));

beforeEach(() => localStorage.clear());

const VIEWS = ["Monitor", "Execution Explorer", "Timeline", "History & Analytics", "Settings"];

describe("views (sample source)", () => {
  it.each(VIEWS)("renders %s and keeps the sample label visible", async (label) => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Views" });
    fireEvent.click(within(nav).getByRole("button", { name: new RegExp(label) }));

    expect(await screen.findByRole("heading", { level: 1, name: label })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: new RegExp(label) })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByText(/Sample data/).length).toBeGreaterThan(0);
  });

  it("opens the command palette from the toolbar", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open command palette" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
