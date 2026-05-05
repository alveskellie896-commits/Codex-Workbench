import { describe, expect, test } from "vitest";
import {
  estimateUploadBatchBytes,
  formatFileSize,
  mergeRecentUploads,
  normalizeUploadRecord,
  uploadsForThread
} from "./uploadHistory.js";

describe("uploadHistory", () => {
  test("formats file sizes for upload cards", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(900)).toBe("900 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2 MB");
  });

  test("normalizes uploaded file records", () => {
    expect(
      normalizeUploadRecord({
        threadId: "thread-a",
        name: "demo.pdf",
        type: "application/pdf",
        size: 12,
        path: "/tmp/demo.pdf",
        uploadedAt: "2026-04-30T00:00:00.000Z"
      })
    ).toMatchObject({
      threadId: "thread-a",
      name: "demo.pdf",
      type: "application/pdf",
      size: 12,
      path: "/tmp/demo.pdf"
    });
  });

  test("merges newest uploads first without duplicates", () => {
    const records = mergeRecentUploads(
      [{ name: "old.pdf", size: 1, path: "/tmp/old.pdf", uploadedAt: "2026-04-29T00:00:00.000Z" }],
      [
        { name: "new.pdf", size: 2, path: "/tmp/new.pdf", type: "application/pdf" },
        { name: "old.pdf", size: 1, path: "/tmp/old.pdf", type: "application/pdf" }
      ],
      () => new Date("2026-04-30T00:00:00.000Z")
    );

    expect(records.map((record) => record.name)).toEqual(["new.pdf", "old.pdf"]);
  });

  test("keeps attachment history scoped to the current thread", () => {
    const records = mergeRecentUploads(
      [{ threadId: "thread-b", name: "other.pdf", size: 1, path: "/tmp/other.pdf", uploadedAt: "2026-04-29T00:00:00.000Z" }],
      [{ name: "current.pdf", size: 2, path: "/tmp/current.pdf", type: "application/pdf" }],
      () => new Date("2026-04-30T00:00:00.000Z"),
      "thread-a"
    );

    expect(uploadsForThread(records, "thread-a").map((record) => record.name)).toEqual(["current.pdf"]);
    expect(uploadsForThread(records, "thread-b").map((record) => record.name)).toEqual(["other.pdf"]);
  });

  test("estimates selected upload batch size", () => {
    expect(estimateUploadBatchBytes([{ size: 10 }, { size: 20 }])).toBe(30);
  });
});
