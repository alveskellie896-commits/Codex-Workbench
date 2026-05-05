import { describe, expect, test } from "vitest";
import { filePreviewLabel, mediaCapabilitySnapshot, previewKindForFile } from "./filePreview.js";

describe("filePreview", () => {
  test("classifies image PDF Word and voice attachments", () => {
    expect(previewKindForFile({ name: "photo.png", type: "image/png" })).toBe("image");
    expect(previewKindForFile({ name: "brief.pdf", type: "" })).toBe("pdf");
    expect(previewKindForFile({ name: "notes.docx", type: "application/octet-stream" })).toBe("docx");
    expect(previewKindForFile({ name: "voice.m4a", type: "audio/mp4" })).toBe("audio");
  });

  test("returns user-facing preview labels", () => {
    expect(filePreviewLabel({ name: "brief.pdf" })).toBe("PDF card");
    expect(filePreviewLabel({ name: "voice.webm" })).toBe("Voice/audio attachment");
  });

  test("detects voice recording fallback", () => {
    expect(mediaCapabilitySnapshot({ mediaRecorder: false, protocol: "https:", getUserMedia: true })).toMatchObject({
      canRecordVoice: false,
      voiceFallback: "Use Voice Memos and upload the audio file"
    });
    expect(mediaCapabilitySnapshot({ mediaRecorder: true, protocol: "https:", getUserMedia: true }).canRecordVoice).toBe(true);
  });
});
