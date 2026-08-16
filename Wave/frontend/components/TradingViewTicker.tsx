/**
 * components/TradingViewTicker.tsx
 * TradingView's free "Ticker Tape" widget — no account or API key needed.
 * Purely cosmetic/additive: doesn't touch prices, trading, or any backend
 * data, just a live market-sentiment strip using TradingView's own feed.
 *
 * Wrapped as a component (rather than a raw embed snippet) so it can be
 * reused elsewhere later (e.g. the Stocks or Trade page) without
 * duplicating the embed/script-loading logic.
 */

import { useEffect, useRef } from "react";

export interface TickerSymbol { proName: string; title: string; }

// A reasonable mix of the crypto/stock symbols already on the platform —
// see COINS in data/market.ts and STOCK_NAMES in PlatformApp.tsx.
const DEFAULT_TICKER_SYMBOLS: TickerSymbol[] = [
  { proName: "BITSTAMP:BTCUSD",  title: "Bitcoin" },
  { proName: "BITSTAMP:ETHUSD",  title: "Ethereum" },
  { proName: "COINBASE:SOLUSD",  title: "Solana" },
  { proName: "NASDAQ:AAPL",      title: "Apple" },
  { proName: "NASDAQ:MSFT",      title: "Microsoft" },
  { proName: "NASDAQ:TSLA",      title: "Tesla" },
  { proName: "NASDAQ:NVDA",      title: "NVIDIA" },
  { proName: "NASDAQ:AMZN",      title: "Amazon" },
];

export function TradingViewTicker({ symbols = DEFAULT_TICKER_SYMBOLS, colorTheme = "dark" }: { symbols?: TickerSymbol[]; colorTheme?: "light" | "dark" }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = ""; // clear on symbol/theme change before re-embedding

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
    script.async = true;
    script.type = "text/javascript";
    script.innerHTML = JSON.stringify({
      symbols,
      showSymbolLogo: true,
      isTransparent: true,
      displayMode: "adaptive",
      colorTheme,
      locale: "en",
    });
    containerRef.current.appendChild(script);
  }, [symbols, colorTheme]);

  return (
    <div className="tradingview-widget-container" style={{ borderRadius: 12, overflow: "hidden" }}>
      <div ref={containerRef} className="tradingview-widget-container__widget" />
    </div>
  );
}
