import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { formatPromptWithAttachments, saveBase64Upload, sanitizeUploadName, sanitizeUploadSegment } from "./uploads.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("sanitizeUploadName", () => {
  test("keeps safe filename parts and strips path traversal", () => {
    expect(sanitizeUploadName("../my photo.png")).toBe("my-photo.png");
  });
});

describe("sanitizeUploadSegment", () => {
  test("keeps upload folders scoped and path-safe", () => {
    expect(sanitizeUploadSegment("../thread/abc")).toBe("thread-abc");
  });
});

describe("saveBase64Upload", () => {
  test("saves uploaded base64 data under the upload root", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-upload-"));
    tempDirs.push(dir);

    const upload = await saveBase64Upload(
      {
        name: "photo.png",
        type: "image/png",
        dataBase64: Buffer.from("hello").toString("base64")
      },
      { uploadRoot: dir, now: () => new Date("2026-04-25T12:34:56.000Z") }
    );

    expect(upload.name).toBe("photo.png");
    expect(upload.type).toBe("image/png");
    expect(upload.size).toBe(5);
    expect(upload.path.startsWith(dir)).toBe(true);
    await expect(fs.readFile(upload.path, "utf8")).resolves.toBe("hello");
  });

  test("stores uploads in a thread-scoped folder when threadId is present", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-upload-"));
    tempDirs.push(dir);

    const upload = await saveBase64Upload(
      {
        threadId: "thread/abc",
        name: "photo.png",
        type: "image/png",
        dataBase64: Buffer.from("hello").toString("base64")
      },
      { uploadRoot: dir, now: () => new Date("2026-04-25T12:34:56.000Z") }
    );

    expect(upload.threadId).toBe("thread/abc");
    expect(upload.path).toContain(`${path.sep}thread-abc${path.sep}`);
  });

  test("accepts uploaded Word documents", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-upload-"));
    tempDirs.push(dir);

    const upload = await saveBase64Upload(
      {
        name: "resume.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        dataBase64: Buffer.from("word-doc-bytes").toString("base64")
      },
      { uploadRoot: dir, now: () => new Date("2026-04-25T12:34:56.000Z") }
    );

    expect(upload.name).toBe("resume.docx");
    expect(upload.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(upload.path.endsWith("resume.docx")).toBe(true);
    await expect(fs.readFile(upload.path, "utf8")).resolves.toBe("word-doc-bytes");
  });
});

describe("formatPromptWithAttachments", () => {
  test("appends uploaded file paths to the outgoing prompt", () => {
    expect(formatPromptWithAttachments("Please inspect this", [{ name: "photo.png", path: "/tmp/photo.png", type: "image/png" }])).toBe(
      "Please inspect this\n\nAttached files:\n- photo.png (image/png): /tmp/photo.png"
    );
  });
});
