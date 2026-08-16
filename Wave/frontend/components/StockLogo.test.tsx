import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { StockLogo } from "./StockLogo";

afterEach(cleanup);

describe("StockLogo", () => {
  it("loads the configured company logo and falls back cleanly if it fails", () => {
    const { container, rerender } = render(<StockLogo symbol="AAPL" size={48} />);
    const logo = container.querySelector(".stock-logo") as HTMLElement;
    expect(logo.style.width).toBe("48px");

    const image = container.querySelector("img") as HTMLImageElement;
    expect(image.src).toContain("domain=apple.com");
    fireEvent.error(image);
    expect(container.querySelector("img")).toBeNull();
    expect(logo.textContent).toBe("AA");

    rerender(<StockLogo symbol="MSFT" size={48} />);
    expect((container.querySelector("img") as HTMLImageElement).src).toContain("domain=microsoft.com");
  });

  it("uses readable initials for an unknown ticker", () => {
    const { container } = render(<StockLogo symbol="WAVE" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".stock-logo")?.textContent).toBe("WA");
  });
});
