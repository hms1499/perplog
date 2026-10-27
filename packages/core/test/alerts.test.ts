import { needsUnprotectedCheck } from "../src/alerts";

test("opens, increases and flips need a check; reductions do not", () => {
  expect(needsUnprotectedCheck(undefined, 5n)).toBe(true);
  expect(needsUnprotectedCheck(0n, -5n)).toBe(true);
  expect(needsUnprotectedCheck(5n, 8n)).toBe(true);
  expect(needsUnprotectedCheck(-5n, -8n)).toBe(true);
  expect(needsUnprotectedCheck(5n, -3n)).toBe(true); // flip opens a new position
  expect(needsUnprotectedCheck(8n, 5n)).toBe(false); // reduction
  expect(needsUnprotectedCheck(5n, 0n)).toBe(false);
});

test("an unchanged or flat position needs no check", () => {
  expect(needsUnprotectedCheck(5n, 5n)).toBe(false);
  expect(needsUnprotectedCheck(undefined, 0n)).toBe(false);
  expect(needsUnprotectedCheck(-8n, -5n)).toBe(false);
});
