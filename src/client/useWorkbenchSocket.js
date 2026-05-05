import { useEffect, useRef, useState } from "react";
import { humanizeErrorMessage } from "./errorMessages.js";

function websocketUrl(token) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL("/ws", `${protocol}//${window.location.host}`);
  url.searchParams.set("token", token);
  return url.toString();
}

function reconnectDelay(attempt) {
  return Math.min(800 * 2 ** Math.max(0, attempt - 1), 10000);
}

export function useWorkbenchSocket({ token, onEvent }) {
  const [connection, setConnection] = useState({
    state: "offline",
    attempts: 0,
    reconnecting: false,
    nextRetryAt: "",
    lastError: "",
    userMessage: ""
  });
  const handlerRef = useRef(onEvent);
  const reconnectRef = useRef(null);
  const attemptsRef = useRef(0);
  const socketRef = useRef(null);

  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!token) {
      setConnection({ state: "offline", attempts: 0, reconnecting: false, nextRetryAt: "", lastError: "", userMessage: "" });
      return undefined;
    }

    let closedByEffect = false;

    function setConnectionState(nextState) {
      setConnection((current) => ({ ...current, ...nextState }));
    }

    function closeSocket() {
      try {
        socketRef.current?.close();
      } catch {
        // Best effort.
      }
      socketRef.current = null;
    }

    function reconnect(delayMs = 0) {
      window.clearTimeout(reconnectRef.current);
      const nextRetryAt = delayMs ? new Date(Date.now() + delayMs).toISOString() : "";
      setConnectionState({
        state: delayMs ? "offline" : "connecting",
        reconnecting: true,
        attempts: attemptsRef.current,
        nextRetryAt,
        userMessage: delayMs ? "正在重新连接电脑" : "正在连接电脑"
      });
      reconnectRef.current = window.setTimeout(connect, delayMs);
    }

    function connect() {
      if (closedByEffect) return;
      window.clearTimeout(reconnectRef.current);
      closeSocket();
      setConnectionState({
        state: "connecting",
        reconnecting: attemptsRef.current > 0,
        attempts: attemptsRef.current,
        nextRetryAt: "",
        userMessage: attemptsRef.current > 0 ? "正在连接电脑" : ""
      });

      const socket = new WebSocket(websocketUrl(token));
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        attemptsRef.current = 0;
        setConnectionState({ state: "online", attempts: 0, reconnecting: false, nextRetryAt: "", lastError: "", userMessage: "" });
      });

      socket.addEventListener("message", (event) => {
        try {
          handlerRef.current?.(JSON.parse(event.data));
        } catch {
          handlerRef.current?.({ type: "unknown", raw: event.data });
        }
      });

      socket.addEventListener("close", () => {
        if (closedByEffect) return;
        const attempt = Math.min(attemptsRef.current + 1, 6);
        attemptsRef.current = attempt;
        reconnect(reconnectDelay(attempt));
      });

      socket.addEventListener("error", (event) => {
        const message = event?.message || "WebSocket disconnected";
        setConnectionState({
          state: "offline",
          reconnecting: true,
          lastError: message,
          userMessage: humanizeErrorMessage(message)
        });
      });
    }

    connect();

    const reconnectNow = () => {
      if (closedByEffect) return;
      attemptsRef.current = 0;
      closeSocket();
      reconnect(0);
    };
    const reconnectWhenVisible = () => {
      if (document.visibilityState === "visible") reconnectNow();
    };
    const reconnectOnPageShow = (event) => {
      if (event.persisted) reconnectNow();
    };

    window.addEventListener("online", reconnectNow);
    window.addEventListener("focus", reconnectNow);
    window.addEventListener("pageshow", reconnectOnPageShow);
    document.addEventListener("visibilitychange", reconnectWhenVisible);

    return () => {
      closedByEffect = true;
      window.clearTimeout(reconnectRef.current);
      window.removeEventListener("online", reconnectNow);
      window.removeEventListener("focus", reconnectNow);
      window.removeEventListener("pageshow", reconnectOnPageShow);
      document.removeEventListener("visibilitychange", reconnectWhenVisible);
      closeSocket();
    };
  }, [token]);

  return connection;
}
