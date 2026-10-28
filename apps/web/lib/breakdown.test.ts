import { gapSegments } from "./breakdown";
import { signedUsd } from "./format";

const E18 = 10n ** 18n;

describe("gapSegments", () => {
  it("shares each part by its magnitude", () => {
    const segs = gapSegments([
      { label: "Funding paid", raw: 4n },
      { label: "Liquidation fees", raw: -187n },
    ]);
    expect(segs.map((s) => s.label)).toEqual(["Funding paid", "Liquidation fees"]);
    expect(segs[0]?.share).toBeCloseTo(4 / 191);
    expect(segs[1]?.share).toBeCloseTo(187 / 191);
    expect(segs[1]?.raw).toBe(-187n);
  });

  it("drops zero parts", () => {
    const segs = gapSegments([
      { label: "Funding paid", raw: 0n },
      { label: "Liquidation fees", raw: -5n },
    ]);
    expect(segs).toEqual([{ label: "Liquidation fees", raw: -5n, share: 1 }]);
  });

  it("is empty when every part is zero", () => {
    expect(gapSegments([{ label: "Funding paid", raw: 0n }])).toEqual([]);
    expect(gapSegments([])).toEqual([]);
  });
});

describe("signedUsd", () => {
  it("signs with + and a real minus", () => {
    expect(signedUsd(41250n * 10n ** 16n)).toBe("+412.50");
    expect(signedUsd(-8620n * 10n ** 16n)).toBe("−86.20");
    expect(signedUsd(0n * E18)).toBe("0.00");
  });
});
