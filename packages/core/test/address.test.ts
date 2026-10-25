import { normalizeAddress, shortAddress } from "../src/address";

test.each([
  ["  0xABCDEF0123456789abcdef0123456789ABCDEF01 ", "0xabcdef0123456789abcdef0123456789abcdef01"],
  ["abcdef0123456789abcdef0123456789abcdef01", "0xabcdef0123456789abcdef0123456789abcdef01"],
])("normalizes %s", (input, expected) => {
  expect(normalizeAddress(input)).toBe(expected);
});

test.each(["", "0x123", "vitalik.eth", "0xZZcdef0123456789abcdef0123456789abcdef01"])(
  "rejects %s",
  (input) => {
    expect(normalizeAddress(input)).toBeNull();
  },
);

test("shortAddress", () => {
  expect(shortAddress("0x31b0480ff2ec5d0a4d9480a9f8c8802897c08281")).toBe("0x31b0…8281");
});
