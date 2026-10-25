import { VERSION } from "../src/index";

test("core package loads", () => {
  expect(VERSION).toBe("0.1.0");
});
