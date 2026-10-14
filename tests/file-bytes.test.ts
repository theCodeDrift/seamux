import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fileDownloadUrl, fileRawUrl } from "~/lib/files";
import { byteRange, loadFile } from "~/lib/files.server";
import { loader as download } from "~/routes/file-download";
import { loader as raw } from "~/routes/file-raw";

describe("file bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "seamux-raw-"));
  const path = join(dir, "notes é.txt");
  writeFileSync(path, "hello");

  const get = (
    loader: typeof raw | typeof download,
    url: string,
    headers: Record<string, string> = {},
  ) =>
    loader({
      request: new Request(`http://localhost${url}`, {
        headers: { host: "localhost", ...headers },
      }),
    } as never) as Promise<Response>;

  it("serves the bytes inline", async () => {
    const response = await get(raw, fileRawUrl(path));
    expect(await response.text()).toBe("hello");
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBe(
      "sandbox allow-scripts allow-popups allow-downloads",
    );
  });

  it("asks the browser to save it from /file/download", async () => {
    const response = await get(download, fileDownloadUrl(path));
    expect(await response.text()).toBe("hello");
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''notes%20%C3%A9.txt",
    );
  });

  it("sends the bytes a player asks for", async () => {
    const response = await get(raw, fileRawUrl(path), { range: "bytes=1-3" });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("ell");
    expect(response.headers.get("content-range")).toBe("bytes 1-3/5");
    expect(response.headers.get("content-length")).toBe("3");
  });

  it("refuses a range past the end", async () => {
    const response = await get(raw, fileRawUrl(path), {
      range: "bytes=9-",
    });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */5");
  });

  it("reads each form of a single range", () => {
    expect(byteRange("bytes=0-", 10)).toEqual({ start: 0, end: 9 });
    expect(byteRange("bytes=2-99", 10)).toEqual({ start: 2, end: 9 });
    expect(byteRange("bytes=-4", 10)).toEqual({ start: 6, end: 9 });
    expect(byteRange("bytes=-40", 10)).toEqual({ start: 0, end: 9 });
    expect(byteRange("bytes=0-1,4-5", 10)).toBeNull();
    expect(byteRange("bytes=5-2", 10)).toBeNull();
    expect(byteRange("bytes=-0", 10)).toBe("unsatisfiable");
  });

  it("knows video and audio by extension", async () => {
    for (const [name, kind] of [
      ["clip.mp4", "video"],
      ["clip.MOV", "video"],
      ["take.webm", "video"],
      ["song.mp3", "audio"],
      ["memo.m4a", "audio"],
      ["tone.wav", "audio"],
    ] as const) {
      const media = join(dir, name);
      writeFileSync(media, Buffer.from([0, 1, 2, 3]));
      expect(await loadFile(media)).toMatchObject({ kind, text: null });
    }
  });
});
