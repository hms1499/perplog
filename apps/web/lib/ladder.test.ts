import { gapPct, ladderBrackets, ladderMarks, ladderScale, pctOf, stopShortcut } from "./ladder";

const E15 = 10n ** 15n;
const E18 = 10n ** 18n;
const TICK = E15; // 0.001
const p = (thousandths: number) => BigInt(thousandths) * E15;

const LONG = { refPrice: p(1205), priceBound: p(1206), stopPrice: p(1171), liqPriceEst: p(1020) };
const SHORT = { refPrice: p(1204), priceBound: p(1203), stopPrice: p(1240), liqPriceEst: p(1390) };
const BOOK = { bestBid: p(1204), bestAsk: p(1206) };

describe("stopShortcut", () => {
  it("long shortcut floors to the tick", () => {
    expect(stopShortcut("long", BOOK, 2, TICK)).toBe(p(1181)); // 1.206 × 0.98 = 1.18188
  });

  it("short shortcut ceils to the tick", () => {
    expect(stopShortcut("short", BOOK, 3, TICK)).toBe(p(1241)); // 1.204 × 1.03 = 1.24012
  });

  it("shortcut is null when the side is missing", () => {
    expect(stopShortcut("long", { bestBid: p(1204), bestAsk: null }, 1, TICK)).toBeNull();
    expect(stopShortcut("short", { bestBid: null, bestAsk: p(1206) }, 1, TICK)).toBeNull();
  });
});

describe("ladderMarks", () => {
  it("without a quote shows only the book", () => {
    expect(ladderMarks(null, BOOK).map((m) => m.kind)).toEqual(["bid", "ask"]);
    expect(ladderMarks(null, { bestBid: null, bestAsk: null })).toEqual([]);
  });

  it("with a quote marks entry, ref, stop, liquidation and the book", () => {
    const kinds = ladderMarks(LONG, BOOK).map((m) => m.kind);
    expect(kinds).toEqual(expect.arrayContaining(["entry", "ref", "stop", "liq", "bid", "ask"]));
    expect(ladderMarks(LONG, BOOK).find((m) => m.kind === "entry")?.price).toBe(LONG.priceBound);
  });

  it("omits liquidation and buffer when liqPriceEst is null", () => {
    const q = { ...LONG, liqPriceEst: null };
    expect(ladderMarks(q, BOOK).some((m) => m.kind === "liq")).toBe(false);
    expect(ladderBrackets(q)).toEqual([{ from: LONG.priceBound, to: LONG.stopPrice, kind: "loss" }]);
  });

  it("brackets entry to stop and stop to liquidation", () => {
    expect(ladderBrackets(LONG)).toEqual([
      { from: LONG.priceBound, to: LONG.stopPrice, kind: "loss" },
      { from: LONG.stopPrice, to: p(1020), kind: "buffer" },
    ]);
  });
});

describe("ladderScale", () => {
  const prices = (q: typeof LONG) => ladderMarks(q, BOOK).map((m) => m.price);

  it("long marks order: higher price sits higher", () => {
    const s = ladderScale(prices(LONG), 400);
    expect(s.y(LONG.priceBound)).toBeLessThan(s.y(LONG.stopPrice));
    expect(s.y(LONG.stopPrice)).toBeLessThan(s.y(p(1020)));
  });

  it("short marks order", () => {
    const s = ladderScale(prices(SHORT), 400);
    expect(s.y(SHORT.stopPrice)).toBeLessThan(s.y(SHORT.priceBound));
    expect(s.y(p(1390))).toBeLessThan(s.y(SHORT.stopPrice));
  });

  it("keeps every mark inside the padded height", () => {
    const s = ladderScale(prices(LONG), 400);
    for (const price of prices(LONG)) {
      expect(s.y(price)).toBeGreaterThan(0);
      expect(s.y(price)).toBeLessThan(400);
    }
  });

  it("scale with equal prices is finite", () => {
    const s = ladderScale([E18, E18], 300);
    expect(Number.isFinite(s.y(E18))).toBe(true);
    expect(s.ticks.length).toBeGreaterThan(0);
    for (const t of s.ticks) expect(Number.isFinite(s.y(t))).toBe(true);
  });

  it("with no prices has no ticks and centers", () => {
    const s = ladderScale([], 300);
    expect(s.ticks).toEqual([]);
    expect(s.y(E18)).toBe(150);
  });

  it("ticks are round", () => {
    const s = ladderScale([p(980), p(1300)], 400);
    expect(s.ticks.length).toBeGreaterThanOrEqual(4);
    expect(s.ticks.length).toBeLessThanOrEqual(8);
    for (const t of s.ticks) expect(t % (50n * E15)).toBe(0n);
  });
});

describe("pctOf", () => {
  it("is the distance as a percent of the first price", () => {
    expect(pctOf(p(1206), p(1171))).toBeCloseTo(2.9, 1);
    expect(pctOf(p(1171), p(1206))).toBeCloseTo(2.99, 1);
  });
});

describe("ladderScale ticks", () => {
  it("an empty ladder around a tight book still has at least 4 ticks", () => {
    const s = ladderScale([64_200n * E18, 64_250n * E18], 380);
    expect(s.ticks.length).toBeGreaterThanOrEqual(4);
  });

  it("never puts a tick below zero", () => {
    for (const t of ladderScale([0n], 300).ticks) expect(t >= 0n).toBe(true);
    for (const t of ladderScale([p(1), p(2)], 300).ticks) expect(t >= 0n).toBe(true);
  });
});

describe("gapPct", () => {
  it("is the distance between two prices as an exact percent of a reference", () => {
    // Buffer between a 63,901 stop and a 58,410 liquidation, against a 64,569 entry.
    expect(gapPct(63_901n * E18, 58_410n * E18, 64_569n * E18)).toBeCloseTo(8.504, 3);
    expect(gapPct(1n, 1n, 0n)).toBe(0);
  });
});
