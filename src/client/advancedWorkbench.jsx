import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ApiClient,
  browserFingerprint,
  clearTrustedDevice,
  loadStoredTokens,
  loadTrustedDevice,
  storeTokens,
  storeTrustedDevice
} from "./api.js";
import { formatFileSize } from "./uploadHistory.js";

function fingerprint() {
  return browserFingerprint();
}

function makeApi(tokens, setTokens) {
  return new ApiClient({
    getAccessToken: () => tokens?.accessToken,
    getRefreshToken: () => tokens?.refreshToken,
    onTokenRefresh: (refreshed) => {
      const nextTokens = { ...tokens, ...refreshed };
      storeTokens(nextTokens);
      setTokens(nextTokens);
    },
    onUnauthorized: () => setTokens(null)
  });
}

function flattenThreads(projects = []) {
  const rows = [];
  const walk = (threads = [], project) => {
    for (const thread of threads) {
      rows.push({ ...thread, projectCwd: project.cwd });
      walk(thread.subagents || [], project);
    }
  };
  for (const project of projects) walk(project.recentThreads || [], project);
  return rows;
}

function fileToPayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = String(reader.result || "");
      resolve({ name: file.name, type: file.type || "application/octet-stream", dataBase64: dataUrl.split(",").pop() || "" });
    });
    reader.addEventListener("error", () => reject(new Error(`Could not read ${file.name}`)));
    reader.readAsDataURL(file);
  });
}

function FilePreview({ file, onRemove }) {
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!file?.type?.startsWith("image/")) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const type = file?.type || "unknown";
  return (
    <article className="advanced-file-card">
      {preview ? <img src={preview} alt="" /> : <span className="advanced-file-icon">{type.includes("pdf") ? "PDF" : type.includes("word") || file.name.endsWith(".docx") ? "DOCX" : "FILE"}</span>}
      <div>
        <strong>{file.name}</strong>
        <small>{formatFileSize(file.size)} · {type}</small>
      </div>
      <button type="button" onClick={onRemove}>Remove</button>
    </article>
  );
}

function PairingPanel({ api, tokens, setTokens }) {
  const [session, setSession] = useState(null);
  const [devices, setDevices] = useState([]);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [trustedLocal, setTrustedLocal] = useState(() => loadTrustedDevice());
  const [renaming, setRenaming] = useState({});

  async function refreshDevices() {
    if (!tokens?.accessToken) return;
    const result = await api.devices();
    setDevices(result.devices || []);
  }

  useEffect(() => {
    refreshDevices().catch(() => {});
  }, [tokens?.accessToken]);

  async function createSession() {
    const next = await api.createPairingSession("phone");
    setSession(next);
    setNotice("Pairing code created. Open the link on your phone or enter the short code.");
  }

  async function completeManual() {
    const result = await api.completePairing(code, "This browser", fingerprint());
    storeTokens(result.tokens);
    storeTrustedDevice({ deviceId: result.device.id, deviceToken: result.deviceToken, name: result.device.name });
    setTrustedLocal(loadTrustedDevice());
    setTokens(result.tokens);
    setNotice("This device is now trusted.");
  }

  async function revoke(deviceId) {
    if (!window.confirm("Revoke this trusted device? It will be signed out immediately.")) return;
    await api.revokeDevice(deviceId);
    if (trustedLocal?.deviceId === deviceId) {
      clearTrustedDevice();
      setTrustedLocal(null);
    }
    await refreshDevices();
  }

  async function rename(deviceId) {
    const name = renaming[deviceId];
    if (!name?.trim()) return;
    await api.renameDevice(deviceId, name);
    setRenaming((current) => {
      const next = { ...current };
      delete next[deviceId];
      return next;
    });
    await refreshDevices();
  }

  function forgetThisBrowser() {
    clearTrustedDevice();
    setTrustedLocal(null);
    setNotice("This browser forgot its trusted-device token. The server record remains until revoked.");
  }

  return (
    <section className="advanced-section">
      <h3>Trusted device pairing</h3>
      <p>Scan once or enter a short code. Later this phone can sign in with its trust token instead of the password.</p>
      <p className="advanced-muted">Current browser: {trustedLocal?.deviceId ? `trusted as ${trustedLocal.name || trustedLocal.deviceId}` : "not trusted yet"}</p>
      <div className="advanced-actions">
        <button type="button" onClick={createSession} disabled={!tokens?.accessToken}>Create pairing code</button>
        <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Enter pairing code" />
        <button type="button" onClick={completeManual} disabled={!code.trim()}>Trust this browser</button>
        <button type="button" onClick={forgetThisBrowser} disabled={!trustedLocal?.deviceId}>Forget this browser</button>
      </div>
      {session ? (
        <div className="advanced-pairing-card">
          <div dangerouslySetInnerHTML={{ __html: session.qrSvg || "" }} />
          <p><strong>{session.shortCode}</strong></p>
          <a href={session.pairingUrl}>{session.pairingUrl}</a>
          <small>Expires {new Date(session.expiresAt).toLocaleString()}</small>
        </div>
      ) : null}
      {notice ? <p className="advanced-notice">{notice}</p> : null}
      <h4>Trusted devices</h4>
      {devices.map((device) => (
        <article className="advanced-row" key={device.id}>
          <span>
            <strong>{device.name}</strong>
            <small>{device.revokedAt ? "Revoked" : `Last seen ${device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "never"}`}</small>
            <small>{device.id === trustedLocal?.deviceId ? "This browser" : device.userAgent || ""}</small>
            {!device.revokedAt ? (
              <input value={renaming[device.id] ?? ""} onChange={(event) => setRenaming((current) => ({ ...current, [device.id]: event.target.value }))} placeholder="Rename device" />
            ) : null}
          </span>
          {!device.revokedAt ? (
            <div className="advanced-actions compact">
              <button type="button" onClick={() => rename(device.id)} disabled={!renaming[device.id]?.trim()}>Rename</button>
              <button type="button" onClick={() => revoke(device.id)}>Revoke</button>
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}

function RuntimePanel({ api, selectedThreadId }) {
  const [payload, setPayload] = useState(null);
  const [controls, setControls] = useState({ model: "", reasoningEffort: "medium", accessMode: "on-request", planMode: false });
  const capabilities = payload?.capabilities?.controls || {};

  async function load() {
    const next = selectedThreadId ? await api.threadRuntime(selectedThreadId) : await api.runtimeDefaults();
    setPayload(next);
    setControls(next.thread || next.defaults || controls);
  }

  useEffect(() => {
    load().catch(() => {});
  }, [selectedThreadId]);

  async function save() {
    if (controls.accessMode === "full-access" && !window.confirm("Full access lets Codex run without asking. Only use it for a trusted local project. Continue?")) return;
    const next = selectedThreadId ? await api.setThreadRuntime(selectedThreadId, controls) : await api.setRuntimeDefaults(controls);
    setPayload(next);
  }

  return (
    <section className="advanced-section">
      <h3>Run controls</h3>
      <label>Model <input value={controls.model || ""} onChange={(event) => setControls({ ...controls, model: event.target.value })} placeholder="Use current/default model" /></label>
      <label>Reasoning
        <select value={controls.reasoningEffort} disabled={!capabilities.reasoningEffort?.supported} onChange={(event) => setControls({ ...controls, reasoningEffort: event.target.value })}>
          {(payload?.reasoningEfforts || ["low", "medium", "high", "xhigh"]).map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <label>Access mode
        <select value={controls.accessMode} disabled={!capabilities.accessMode?.supported} onChange={(event) => setControls({ ...controls, accessMode: event.target.value })}>
          {(payload?.accessModes || []).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label className="advanced-check">
        <input type="checkbox" checked={controls.planMode} disabled={!capabilities.planMode?.supported} onChange={(event) => setControls({ ...controls, planMode: event.target.checked })} />
        Plan mode
      </label>
      <p className="advanced-muted">{capabilities.steerActiveRun?.note || "Follow-ups are queued if native steering is not available."}</p>
      <button type="button" onClick={save}>Save controls</button>
    </section>
  );
}

function QueuePanel({ api, selectedThreadId }) {
  const [items, setItems] = useState([]);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState({});

  async function load() {
    if (!selectedThreadId) return;
    const result = await api.followUps(selectedThreadId);
    setItems(result.followUps || []);
  }

  useEffect(() => {
    load().catch(() => {});
  }, [selectedThreadId]);

  async function enqueue() {
    if (!selectedThreadId || !message.trim()) return;
    await api.enqueueFollowUp(selectedThreadId, message);
    setMessage("");
    await load();
  }

  async function cancel(id) {
    await api.cancelFollowUp(selectedThreadId, id);
    await load();
  }

  async function saveEdit(id) {
    const prompt = editing[id];
    if (prompt === undefined) return;
    await api.editFollowUp(selectedThreadId, id, { prompt });
    setEditing((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    await load();
  }

  async function reorder(id, direction) {
    await api.reorderFollowUp(selectedThreadId, id, direction);
    await load();
  }

  return (
    <section className="advanced-section">
      <h3>Queued follow-ups</h3>
      <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask the next question while the current run is busy" />
      <button type="button" onClick={enqueue} disabled={!selectedThreadId || !message.trim()}>Queue follow-up</button>
      {items.map((item) => (
        <article className="advanced-row" key={item.id}>
          <span>
            <strong>{item.status}</strong>
            {editing[item.id] !== undefined ? (
              <textarea value={editing[item.id]} onChange={(event) => setEditing((current) => ({ ...current, [item.id]: event.target.value }))} />
            ) : (
              <small>{item.prompt}</small>
            )}
            <small>Target: {item.threadId} · {new Date(item.createdAt).toLocaleString()}</small>
          </span>
          {item.status === "queued" ? (
            <div className="advanced-actions compact">
              {editing[item.id] !== undefined ? <button type="button" onClick={() => saveEdit(item.id)}>Save</button> : <button type="button" onClick={() => setEditing((current) => ({ ...current, [item.id]: item.prompt }))}>Edit</button>}
              <button type="button" onClick={() => reorder(item.id, "up")}>Up</button>
              <button type="button" onClick={() => reorder(item.id, "down")}>Down</button>
              <button type="button" onClick={() => cancel(item.id)}>Cancel</button>
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}

function SubagentPanel({ api, selectedThreadId }) {
  const [items, setItems] = useState([]);
  const [role, setRole] = useState("worker");
  const [goal, setGoal] = useState("");
  const [notes, setNotes] = useState("");

  async function load() {
    if (!selectedThreadId) return;
    const result = await api.subagents(selectedThreadId);
    setItems(result.subagents || []);
  }

  useEffect(() => {
    load().catch(() => {});
  }, [selectedThreadId]);

  async function create() {
    await api.createSubagent(selectedThreadId, { role, goal, notes });
    setGoal("");
    setNotes("");
    await load();
  }

  return (
    <section className="advanced-section">
      <h3>Subagents</h3>
      <p>This panel uses native subagent threads when they already exist. Creating a new one sends an explicit /subagents command because this Codex bridge has no stable subagent creation API.</p>
      <input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Role" />
      <textarea value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Goal" />
      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes" />
      <button type="button" onClick={create} disabled={!selectedThreadId || !goal.trim()}>Create subagent command</button>
      {items.map((item) => (
        <article className="advanced-row" key={item.id}>
          <span><strong>{item.role}: {item.title}</strong><small>{item.status} · {item.nativeThread ? "native thread" : "command fallback"}</small></span>
        </article>
      ))}
    </section>
  );
}

function GitPanel({ api, selectedThreadId }) {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState("");
  const [branch, setBranch] = useState("");

  async function load() {
    if (!selectedThreadId) return;
    setStatus(await api.gitStatus(selectedThreadId));
  }

  useEffect(() => {
    load().catch(() => {});
  }, [selectedThreadId]);

  async function action(actionName, extra = {}) {
    const confirm = `confirm:${actionName}`;
    if (window.prompt(`Type ${confirm} to run Git ${actionName}`) !== confirm) return;
    await api.gitAction({ threadId: selectedThreadId, action: actionName, confirm, ...extra });
    await load();
  }

  return (
    <section className="advanced-section">
      <h3>Git safe panel</h3>
      <button type="button" onClick={load} disabled={!selectedThreadId}>Refresh status</button>
      {status?.status ? (
        <div className="advanced-git-card">
          <p><strong>{status.status.repository ? status.status.branch : "Not a Git repository"}</strong></p>
          <p>{status.status.clean ? "Working tree clean" : `${status.status.files.length} changed file(s)`}</p>
          <small>{status.status.shortStat || "No diff stat"}</small>
          {status.status.files.map((file) => <code key={file.path}>{file.status} {file.path}</code>)}
        </div>
      ) : null}
      <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Commit message" />
      <button type="button" onClick={() => action("commit", { message })} disabled={!message.trim()}>Commit</button>
      <button type="button" onClick={() => action("pull")}>Pull --ff-only</button>
      <button type="button" onClick={() => action("push")}>Push</button>
      <input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="Branch name" />
      <button type="button" onClick={() => action("checkout", { branch })} disabled={!branch.trim()}>Switch branch</button>
      <button type="button" onClick={() => action("create-branch", { branch })} disabled={!branch.trim()}>Create branch</button>
      <button type="button" onClick={() => action("stash", { message: "Phone stash" })}>Stash</button>
    </section>
  );
}

function AttachVoicePanel({ api, selectedThreadId }) {
  const [files, setFiles] = useState([]);
  const [message, setMessage] = useState("");
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  async function send() {
    const payloads = await Promise.all(files.map(fileToPayload));
    const uploads = payloads.length ? (await api.uploadFiles(payloads, { threadId: selectedThreadId })).uploads : [];
    await api.send(selectedThreadId, message || "Attachment from phone", uploads);
    setFiles([]);
    setMessage("");
  }

  async function toggleRecording() {
    if (!("MediaRecorder" in window)) {
      alert("This browser cannot record audio here. On iPhone Safari, update iOS or attach a voice memo file instead.");
      return;
    }
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => chunksRef.current.push(event.data);
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      setFiles((current) => [...current, new File([blob], `voice-${Date.now()}.webm`, { type: blob.type })]);
      stream.getTracks().forEach((track) => track.stop());
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
  }

  return (
    <section className="advanced-section">
      <h3>Files, camera, voice</h3>
      <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Message with attachments" />
      <input type="file" multiple onChange={(event) => setFiles((current) => [...current, ...Array.from(event.target.files || [])])} />
      <input type="file" accept="image/*" capture="environment" onChange={(event) => setFiles((current) => [...current, ...Array.from(event.target.files || [])])} />
      <button type="button" onClick={toggleRecording}>{recording ? "Stop recording" : "Record voice"}</button>
      {files.map((file, index) => <FilePreview key={`${file.name}:${index}`} file={file} onRemove={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} />)}
      <button type="button" onClick={send} disabled={!selectedThreadId || (!files.length && !message.trim())}>Send to selected thread</button>
    </section>
  );
}

function AdvancedWorkbenchPanel() {
  const [tokens, setTokens] = useState(() => loadStoredTokens());
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("pair");
  const [projects, setProjects] = useState([]);
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const api = useMemo(() => makeApi(tokens, setTokens), [tokens]);
  const threads = useMemo(() => flattenThreads(projects), [projects]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (!code) return;
    api.completePairing(code, navigator.userAgent.includes("iPhone") ? "iPhone" : "Phone browser", fingerprint())
      .then((result) => {
        storeTokens(result.tokens);
        storeTrustedDevice({ deviceId: result.device.id, deviceToken: result.deviceToken, name: result.device.name });
        window.history.replaceState({}, "", "/");
        window.location.reload();
      })
      .catch((error) => alert(error.message));
  }, []);

  useEffect(() => {
    if (!tokens?.accessToken) return;
    api.projects().then(setProjects).catch(() => {});
  }, [tokens?.accessToken]);

  async function trustedLogin() {
    const trusted = loadTrustedDevice();
    if (!trusted) {
      alert("No trusted device token is saved. Use password login or pair this phone first.");
      return;
    }
    setLoginBusy(true);
    try {
      const result = await api.deviceLogin(trusted.deviceId, trusted.deviceToken, fingerprint());
      storeTokens(result);
      setTokens(result);
      window.location.reload();
    } catch (error) {
      clearTrustedDevice();
      alert(error.message);
    } finally {
      setLoginBusy(false);
    }
  }

  if (!tokens?.accessToken) return null;

  return (
    <>
      <button className="advanced-fab" type="button" onClick={() => setOpen((current) => !current)}>Advanced</button>
      {open ? (
        <aside className="advanced-panel">
          <header>
            <strong>Advanced mobile controls</strong>
            <button type="button" onClick={() => setOpen(false)}>Close</button>
          </header>
          {!tokens?.accessToken ? (
            <section className="advanced-section">
              <p>Already paired this phone? Use trusted-device login.</p>
              <button type="button" onClick={trustedLogin} disabled={loginBusy}>{loginBusy ? "Signing in..." : "Trusted login"}</button>
            </section>
          ) : (
            <>
              <label className="advanced-thread-picker">Thread
                <select value={selectedThreadId} onChange={(event) => setSelectedThreadId(event.target.value)}>
                  <option value="">Choose a thread</option>
                  {threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title || thread.id}</option>)}
                </select>
              </label>
              <nav className="advanced-tabs">
                {[
                  ["pair", "Pairing"],
                  ["runtime", "Run"],
                  ["queue", "Queue"],
                  ["agents", "Agents"],
                  ["git", "Git"],
                  ["files", "Files"]
                ].map(([id, label]) => <button className={tab === id ? "active" : ""} key={id} type="button" onClick={() => setTab(id)}>{label}</button>)}
              </nav>
              {tab === "pair" ? <PairingPanel api={api} tokens={tokens} setTokens={setTokens} /> : null}
              {tab === "runtime" ? <RuntimePanel api={api} selectedThreadId={selectedThreadId} /> : null}
              {tab === "queue" ? <QueuePanel api={api} selectedThreadId={selectedThreadId} /> : null}
              {tab === "agents" ? <SubagentPanel api={api} selectedThreadId={selectedThreadId} /> : null}
              {tab === "git" ? <GitPanel api={api} selectedThreadId={selectedThreadId} /> : null}
              {tab === "files" ? <AttachVoicePanel api={api} selectedThreadId={selectedThreadId} /> : null}
            </>
          )}
        </aside>
      ) : null}
    </>
  );
}

export function mountAdvancedWorkbench() {
  if (typeof document === "undefined") return;
  const target = document.createElement("div");
  target.id = "advanced-workbench-root";
  document.body.appendChild(target);
  createRoot(target).render(<AdvancedWorkbenchPanel />);
}
