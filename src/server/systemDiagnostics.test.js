import { describe, expect, test } from "vitest";
import { makeDiagnosticCheck, parseCurrentPhoneLink, summarizeDiagnosticChecks } from "./systemDiagnostics.js";

describe("parseCurrentPhoneLink", () => {
  test("extracts phone, computer, and update time from the generated link file", () => {
    const parsed = parseCurrentPhoneLink(`
Phone: https://demo.ts.net/
Computer: http://127.0.0.1:8787/
UpdatedAt: 2026-04-29T15:48:24.053Z
`);

    expect(parsed).toEqual({
      phoneUrl: "https://demo.ts.net/",
      localUrl: "http://127.0.0.1:8787/",
      updatedAt: "2026-04-29T15:48:24.053Z",
      tunnelType: "",
      stable: false,
      failureReason: "",
      tunnelPasswordIp: ""
    });
  });

  test("extracts tunnel metadata and recovery errors", () => {
    const parsed = parseCurrentPhoneLink(`
Phone: https://demo.trycloudflare.com/
Computer: http://127.0.0.1:8787/
UpdatedAt: 2026-05-02T10:00:00.000Z
TunnelType: cloudflare
Stable: false
FailureReason: tunnel failed
TunnelPasswordIp: 203.0.113.8
`);

    expect(parsed.tunnelType).toBe("cloudflare");
    expect(parsed.stable).toBe(false);
    expect(parsed.failureReason).toBe("tunnel failed");
    expect(parsed.tunnelPasswordIp).toBe("203.0.113.8");
  });
});

describe("summarizeDiagnosticChecks", () => {
  test("reports warning when there are no hard failures", () => {
    const summary = summarizeDiagnosticChecks([
      makeDiagnosticCheck({ id: "service", label: "Service", status: "ok" }),
      makeDiagnosticCheck({ id: "socket", label: "Socket", status: "warning" })
    ]);

    expect(summary.overall).toBe("warning");
    expect(summary.ok).toBe(1);
    expect(summary.warnings).toBe(1);
    expect(summary.errors).toBe(0);
  });

  test("lets errors dominate the overall result", () => {
    const summary = summarizeDiagnosticChecks([
      makeDiagnosticCheck({ id: "service", label: "Service", status: "ok" }),
      makeDiagnosticCheck({ id: "database", label: "Database", status: "error" }),
      makeDiagnosticCheck({ id: "socket", label: "Socket", status: "warning" })
    ]);

    expect(summary.overall).toBe("error");
    expect(summary.errors).toBe(1);
  });
});
