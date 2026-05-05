import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function isWindows() {
  return os.platform() === "win32";
}

function isMac() {
  return os.platform() === "darwin";
}

async function runPowerShell(script, { input = "", timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const utf8Script = `
      [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
      [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
      $OutputEncoding = New-Object System.Text.UTF8Encoding $false
      ${script}
    `;
    const child = execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", utf8Script],
      { timeout, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve(stdout);
      }
    );
    if (input) child.stdin.end(input);
  });
}

function powershellSingleQuotedString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function readClipboard() {
  if (isWindows()) {
    try {
      return await runPowerShell("Get-Clipboard -Raw", { timeout: 3000 });
    } catch {
      return null;
    }
  }
  if (!isMac()) return null;
  try {
    return await execFileAsync("pbpaste", [], { timeout: 3000 });
  } catch {
    return null;
  }
}

async function writeClipboard(text) {
  if (isWindows()) {
    const tempFile = path.join(os.tmpdir(), `codex-workbench-clipboard-${process.pid}-${randomUUID()}.txt`);
    await fs.writeFile(tempFile, text, "utf8");
    try {
      await runPowerShell(
        `$value = Get-Content -LiteralPath ${powershellSingleQuotedString(tempFile)} -Raw -Encoding UTF8; Set-Clipboard -Value $value`,
        { timeout: 5000 }
      );
      return;
    } finally {
      fs.unlink(tempFile).catch(() => {});
    }
  }
  if (!isMac()) throw new Error("Clipboard automation is only supported on Windows and macOS");
  await new Promise((resolve, reject) => {
    const child = execFile("pbcopy", [], (error) => {
      if (error) reject(error);
      else resolve();
    });
    child.stdin.end(text);
  });
}

export function buildCodexThreadDeepLink(threadId) {
  return `codex://threads/${encodeURIComponent(threadId)}`;
}

export function buildCodexNewThreadDeepLink() {
  return "codex://threads/new";
}

async function openCodexDeepLink(url, strategyName) {
  if (isWindows()) {
    await runPowerShell(`Start-Process ${JSON.stringify(url)}`, { timeout: 5000 });
    return { ok: true, url, strategy: `${strategyName}-windows` };
  }
  if (!isMac()) throw new Error("Opening Codex Desktop threads is only supported on Windows and macOS");
  await execFileAsync("open", [url], { timeout: 5000 });
  return { ok: true, url, strategy: strategyName };
}

export async function openCodexThreadInDesktop(threadId) {
  return openCodexDeepLink(buildCodexThreadDeepLink(threadId), "codex-deeplink");
}

export async function openCodexNewThreadInDesktop() {
  return openCodexDeepLink(buildCodexNewThreadDeepLink(), "codex-new-thread-deeplink");
}

export async function reloadCodexDesktopWindow() {
  if (isWindows()) {
    await runPowerShell(
      `
        $shell = New-Object -ComObject WScript.Shell
        $activated = $false
        foreach ($process in Get-Process Codex -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }) {
          if ($shell.AppActivate($process.Id)) {
            $activated = $true
            break
          }
        }
        foreach ($title in @("Codex", "OpenAI Codex")) {
          if ($activated) { break }
          if ($shell.AppActivate($title)) {
            $activated = $true
            break
          }
        }
        if (-not $activated) {
          throw "Could not activate the Codex Desktop window"
        }
        Start-Sleep -Milliseconds 300
        $shell.SendKeys("^r")
      `,
      { timeout: 10000 }
    );
    return { ok: true, strategy: "codex-desktop-reload-windows" };
  }
  if (!isMac()) throw new Error("Desktop reload automation is only supported on Windows and macOS");
  await execFileAsync(
    "osascript",
    [
      "-e",
      `
        tell application "Codex" to activate
        delay 0.2
        tell application "System Events"
          tell process "Codex"
            keystroke "r" using command down
          end tell
        end tell
      `
    ],
    { timeout: 10000 }
  );
  return { ok: true, strategy: "codex-desktop-reload" };
}

export async function restartCodexDesktopAndOpenThread(threadId) {
  const url = buildCodexThreadDeepLink(threadId);
  if (isWindows()) {
    await runPowerShell(
      `
        $url = ${JSON.stringify(url)}
        function Get-CodexDesktopProcesses {
          Get-CimInstance Win32_Process | Where-Object {
            ($_.Name -ieq "Codex.exe" -and $_.CommandLine -match '\\\\app\\\\Codex\\.exe') -or
            ($_.Name -ieq "codex.exe" -and $_.CommandLine -match '\\\\resources\\\\codex\\.exe.* app-server --analytics-default-enabled' -and $_.CommandLine -notmatch "--listen")
          }
        }

        $targets = @(Get-CodexDesktopProcesses)
        foreach ($process in $targets) {
          Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        }

        $deadline = (Get-Date).AddSeconds(8)
        do {
          $remaining = @(Get-CodexDesktopProcesses)
          if ($remaining.Count -eq 0) { break }
          Start-Sleep -Milliseconds 200
        } while ((Get-Date) -lt $deadline)

        Start-Process $url
      `,
      { timeout: 15000 }
    );
    return { ok: true, url, strategy: "codex-desktop-restart-windows" };
  }
  if (!isMac()) throw new Error("Desktop restart automation is only supported on Windows and macOS");
  await execFileAsync(
    "osascript",
    [
      "-e",
      `
        tell application "Codex" to quit
        delay 1.5
      `
    ],
    { timeout: 10000 }
  ).catch(() => {});
  await execFileAsync("open", [url], { timeout: 5000 });
  return { ok: true, url, strategy: "codex-desktop-restart" };
}

export async function sendToCodexDesktop(text) {
  const previousClipboard = await readClipboard();
  await writeClipboard(text);
  try {
    if (isWindows()) {
      await runPowerShell(
        `
          Add-Type @"
          using System;
          using System.Runtime.InteropServices;

          public static class NativeMethods {
            [DllImport("user32.dll")]
            public static extern bool SetForegroundWindow(IntPtr hWnd);

            [DllImport("user32.dll")]
            public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

            [DllImport("user32.dll")]
            public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

            [DllImport("user32.dll")]
            public static extern bool SetCursorPos(int X, int Y);

            [DllImport("user32.dll")]
            public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
          }

          public struct RECT {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
          }
"@
          $shell = New-Object -ComObject WScript.Shell
          Start-Sleep -Milliseconds 900
          $activated = $false
          $target = $null
          foreach ($process in Get-Process Codex -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }) {
            $target = $process
            [NativeMethods]::ShowWindowAsync($process.MainWindowHandle, 9) | Out-Null
            Start-Sleep -Milliseconds 100
            [NativeMethods]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
            if ($shell.AppActivate($process.Id)) {
              $activated = $true
              break
            }
          }
          foreach ($title in @("Codex", "OpenAI Codex")) {
            if ($activated) { break }
            if ($shell.AppActivate($title)) {
              $activated = $true
              break
            }
          }
          if (-not $activated) {
            throw "Could not activate the Codex Desktop window"
          }
          Start-Sleep -Milliseconds 700
          if ($target -and $target.MainWindowHandle -ne 0) {
            $rect = New-Object RECT
            [NativeMethods]::GetWindowRect($target.MainWindowHandle, [ref]$rect) | Out-Null
            $width = [Math]::Max(1, $rect.Right - $rect.Left)
            $height = [Math]::Max(1, $rect.Bottom - $rect.Top)
            $x = [int]($rect.Left + ($width * 0.62))
            $bottomOffset = [Math]::Max(90, [Math]::Min(165, [int]($height * 0.085)))
            $y = [int]($rect.Bottom - $bottomOffset)
            [NativeMethods]::SetCursorPos($x, $y) | Out-Null
            Start-Sleep -Milliseconds 120
            [NativeMethods]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 40
            [NativeMethods]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 250
          }
          $shell.SendKeys("/")
          Start-Sleep -Milliseconds 150
          $shell.SendKeys("^a")
          Start-Sleep -Milliseconds 150
          $shell.SendKeys("^v")
          Start-Sleep -Milliseconds 250
          $shell.SendKeys("{ENTER}")
        `,
        { timeout: 10000 }
      );
      return;
    }
    if (!isMac()) throw new Error("Desktop send automation is only supported on Windows and macOS");
    await execFileAsync(
      "osascript",
      [
        "-e",
        `
          tell application "Codex" to activate
          delay 0.25
          tell application "System Events"
            tell process "Codex"
              keystroke "v" using command down
              delay 0.05
              key code 36
            end tell
          end tell
        `
      ],
      { timeout: 10000 }
    );
  } finally {
    if (previousClipboard !== null) {
      setTimeout(() => {
        writeClipboard(previousClipboard).catch(() => {});
      }, 3000).unref();
    }
  }
}

export async function stopCodexDesktopResponse() {
  if (isWindows()) {
    await runPowerShell(
      `
        $shell = New-Object -ComObject WScript.Shell
        $activated = $false
        foreach ($process in Get-Process Codex -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }) {
          if ($shell.AppActivate($process.Id)) {
            $activated = $true
            break
          }
        }
        foreach ($title in @("Codex", "OpenAI Codex")) {
          if ($activated) { break }
          if ($shell.AppActivate($title)) {
            $activated = $true
            break
          }
        }
        if (-not $activated) {
          throw "Could not activate the Codex Desktop window"
        }
        Start-Sleep -Milliseconds 150
        $shell.SendKeys("{ESC}")
        Start-Sleep -Milliseconds 100
        $shell.SendKeys("^.")
      `,
      { timeout: 10000 }
    );
    return { ok: true, strategy: "codex-desktop-interrupt-windows" };
  }
  if (!isMac()) throw new Error("Desktop interrupt automation is only supported on Windows and macOS");
  await execFileAsync(
    "osascript",
    [
      "-e",
      `
        tell application "Codex" to activate
        delay 0.2
        tell application "System Events"
          tell process "Codex"
            key code 53
            delay 0.05
            keystroke "." using command down
          end tell
        end tell
      `
    ],
    { timeout: 10000 }
  );
  return { ok: true, strategy: "codex-desktop-interrupt" };
}
