// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserFileGateway,
  canReuseBrowserHandle,
  isPickerCancellation,
  type WritableFileHandle,
} from "./file-gateway";

interface MockFileHandle extends WritableFileHandle {
  writes: string[];
}

function createFileHandle(name: string, read: () => Promise<string>): MockFileHandle {
  const writes: string[] = [];
  return {
    name,
    writes,
    async getFile() {
      return { name, text: read } as unknown as File;
    },
    async createWritable() {
      return {
        async write(data: string) {
          writes.push(data);
        },
        async close() {},
      };
    },
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, "showOpenFilePicker");
  Reflect.deleteProperty(window, "showSaveFilePicker");
  vi.restoreAllMocks();
});

describe("browser file handle reuse", () => {
  it("reuses a handle only when saving the same named document", () => {
    expect(canReuseBrowserHandle({ currentPath: "memo.md", forceNewPath: false })).toBe(true);
  });

  it("does not overwrite the previous file after creating a new document", () => {
    expect(canReuseBrowserHandle({ currentPath: null, forceNewPath: false })).toBe(false);
  });

  it("does not reuse a handle for Save As", () => {
    expect(canReuseBrowserHandle({ currentPath: "memo.md", forceNewPath: true })).toBe(false);
  });
});

describe("browser picker cancellation", () => {
  it("recognizes an AbortError as an intentional cancel", () => {
    expect(isPickerCancellation(new DOMException("cancelled", "AbortError"))).toBe(true);
  });

  it("does not hide unrelated picker failures", () => {
    expect(isPickerCancellation(new Error("permission denied"))).toBe(false);
  });
});

describe("BrowserFileGateway", () => {
  it("has no startup document in localhost preview", async () => {
    const gateway = new BrowserFileGateway();

    await expect(gateway.openStartup()).resolves.toBeNull();
  });

  it("keeps the current handle when a newly selected file fails to load", async () => {
    const first = createFileHandle("first.md", async () => "first content");
    const broken = createFileHandle("broken.md", async () => {
      throw new Error("read failed");
    });
    const picker = vi.fn().mockResolvedValueOnce([first]).mockResolvedValueOnce([broken]);
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: picker });
    const gateway = new BrowserFileGateway();

    await expect(gateway.open()).resolves.toEqual({ content: "first content", path: "first.md" });
    await expect(gateway.open()).rejects.toThrow("read failed");
    await gateway.save({
      content: "first edited",
      currentPath: "first.md",
      forceNewPath: false,
      suggestedName: "first.md",
    });

    expect(first.writes).toEqual(["first edited"]);
    expect(broken.writes).toEqual([]);
  });

  it("asks for a new download name when Save As has no file-system picker", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("copy.md");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:mdpad-test"),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const gateway = new BrowserFileGateway();

    const path = await gateway.save({
      content: "copy",
      currentPath: "original.md",
      forceNewPath: true,
      suggestedName: "original.md",
    });

    expect(path).toBe("copy.md");
    expect(window.prompt).toHaveBeenCalledWith("保存するファイル名", "original.md");
  });
});
