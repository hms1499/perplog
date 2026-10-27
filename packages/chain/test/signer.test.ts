import { OperatorRevert } from "../src/signer";

describe("signer", () => {
  test("OperatorRevert carries the error name", () => {
    const e = new OperatorRevert("ImmediateOrCancelNoFill");
    expect(e).toBeInstanceOf(Error);
    expect(e.errorName).toBe("ImmediateOrCancelNoFill");
  });
});
