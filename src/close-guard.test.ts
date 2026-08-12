import { describe, expect, it, vi } from "vitest";
import { shouldPreventWindowClose } from "./close-guard";

describe("shouldPreventWindowClose", () => {
  it("allows a clean document to close without confirmation", async () => {
    const confirmDiscard = vi.fn(async () => false);

    await expect(shouldPreventWindowClose(false, confirmDiscard)).resolves.toBe(false);
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it("allows a dirty document to close after discard is confirmed", async () => {
    const confirmDiscard = vi.fn(async () => true);

    await expect(shouldPreventWindowClose(true, confirmDiscard)).resolves.toBe(false);
    expect(confirmDiscard).toHaveBeenCalledOnce();
  });

  it("prevents closing when discard is cancelled", async () => {
    const confirmDiscard = vi.fn(async () => false);

    await expect(shouldPreventWindowClose(true, confirmDiscard)).resolves.toBe(true);
    expect(confirmDiscard).toHaveBeenCalledOnce();
  });
});
