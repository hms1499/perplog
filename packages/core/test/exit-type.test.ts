import { classifyExit } from "../src/exit-type";
import { change, stop, trade } from "./helpers";

const closing = trade({ lastChange: change({ txHash: "0xliq", orderId: "9" }) });

test("liquidation tx wins over a triggered stop", () => {
  const liquidations = [
    { id: "l", kind: "PositionLiquidated", pool: "0xp" as const, txHash: "0xliq" as const, timestamp: 200 },
  ];
  const stops = [stop({ status: "TRIGGERED", placedOrderId: "9" })];
  expect(classifyExit(closing, liquidations, stops, new Set())).toBe("LIQUIDATED");
});

test("triggered stop matched by placedOrderId → NATIVE_STOP", () => {
  expect(classifyExit(closing, [], [stop({ status: "TRIGGERED", placedOrderId: "9" })], new Set())).toBe(
    "NATIVE_STOP",
  );
  expect(classifyExit(closing, [], [stop({ status: "PENDING", placedOrderId: "9" })], new Set())).toBe(
    "MANUAL",
  );
});

test("perplog stop tx → PERPLOG_STOP; otherwise MANUAL; open → OPEN", () => {
  expect(classifyExit(closing, [], [], new Set(["0xliq"]))).toBe("PERPLOG_STOP");
  expect(classifyExit(closing, [], [], new Set())).toBe("MANUAL");
  expect(classifyExit(trade({ closedAt: null }), [], [], new Set())).toBe("OPEN");
});
