import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { humanizeErrorMessage } from "./errorMessages.js";
import "./styles.css";
import "./mobileRemodex.css";

function installMobileRuntimeHints() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const root = document.documentElement;
  const userAgent = window.navigator.userAgent || "";
  const isIOS =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (window.navigator.platform === "MacIntel" && Number(window.navigator.maxTouchPoints || 0) > 1);
  root.dataset.mobileRuntime = isIOS ? "ios" : "web";

  const viewport = document.querySelector("meta[name='viewport']");
  if (viewport) {
    viewport.setAttribute(
      "content",
      "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
    );
  }

  const setVisible = () => {
    root.dataset.visible = document.visibilityState === "visible" ? "true" : "false";
  };
  setVisible();
  document.addEventListener("visibilitychange", setVisible);
}

function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((registration) => {
      registration.update?.().catch(() => {});
      if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
      if (registration.active) registration.active.postMessage({ type: "CLEAR_OLD_CACHES" });
    }).catch(() => {
      // PWA caching is a convenience; the app remains usable without it.
    });
  });
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="login-screen">
          <section className="login-card">
            <p className="eyebrow">页面出错</p>
            <h1>刷新一下</h1>
            <p className="form-error">{humanizeErrorMessage(this.state.error)}</p>
            <button className="primary-button" type="button" onClick={() => window.location.reload()}>
              刷新页面
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

installMobileRuntimeHints();
registerServiceWorker();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
