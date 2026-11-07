import { expect, it } from "vitest";

it("CI確認用: わざと失敗するテスト", () => {
  expect(1).toBe(2);
});
