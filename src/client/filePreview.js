export function previewKindForFile(file = {}) {
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (type.includes("word") || type.includes("officedocument.wordprocessingml") || name.endsWith(".doc") || name.endsWith(".docx")) return "docx";
  if (type.startsWith("audio/") || name.endsWith(".m4a") || name.endsWith(".mp3") || name.endsWith(".wav") || name.endsWith(".webm")) return "audio";
  return "file";
}

export function filePreviewLabel(file = {}) {
  const kind = previewKindForFile(file);
  if (kind === "image") return "Image preview";
  if (kind === "pdf") return "PDF card";
  if (kind === "docx") return "Word document card";
  if (kind === "audio") return "Voice/audio attachment";
  return "File attachment";
}

export function mediaCapabilitySnapshot({ mediaRecorder = typeof MediaRecorder !== "undefined", protocol = typeof location !== "undefined" ? location.protocol : "", getUserMedia = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) } = {}) {
  const secureContext = protocol === "https:" || protocol === "http:" || protocol === "file:";
  const canRecordVoice = Boolean(mediaRecorder && getUserMedia && secureContext);
  return {
    canRecordVoice,
    voiceFallback: canRecordVoice ? "Browser recording available" : "Use Voice Memos and upload the audio file",
    cameraCapture: "Use capture=environment when the browser supports it; otherwise choose from Photos."
  };
}
