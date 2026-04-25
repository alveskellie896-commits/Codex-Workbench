import SwiftUI

struct ChatView: View {
    @Environment(AppState.self) private var appState
    let thread: ThreadSummary
    @State private var draft = ""
    @State private var selectedModel: String?

    private var messages: [MessageEvent] {
        appState.messages(for: thread)
    }

    private var runState: ThreadRunState {
        appState.runState(for: thread)
    }

    var body: some View {
        VStack(spacing: 0) {
            ChatHeader(thread: thread, selectedModel: selectedModel ?? thread.model, runState: runState)
            Divider()
            MessageListView(messages: messages)
            Divider()
            ComposerView(
                draft: $draft,
                selectedModel: $selectedModel,
                models: appState.availableModels,
                isRunning: runState == .running || runState == .queued,
                send: send,
                stop: stop
            )
        }
        .background(WorkbenchTheme.pageBackground)
        .navigationTitle(thread.title)
        .toolbar {
            Button("重试", systemImage: "arrow.counterclockwise", action: retry)
        }
        .task(id: thread.id) {
            await appState.loadThread(thread)
            await appState.loadModels()
        }
        .alert("对话错误", isPresented: hasErrorMessage) {
            Button("OK", role: .cancel) {
                appState.errorMessage = nil
            }
        } message: {
            Text(appState.errorMessage ?? "")
        }
    }

    private var hasErrorMessage: Binding<Bool> {
        Binding(
            get: { appState.errorMessage != nil },
            set: { if $0 == false { appState.errorMessage = nil } }
        )
    }

    private func send() {
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard content.isEmpty == false else {
            return
        }

        draft = ""

        Task {
            await appState.sendMessage(thread: thread, content: content, model: selectedModel)
        }
    }

    private func stop() {
        Task {
            await appState.cancel(thread: thread)
        }
    }

    private func retry() {
        Task {
            await appState.retry(thread: thread)
        }
    }
}

private struct ChatHeader: View {
    let thread: ThreadSummary
    let selectedModel: String?
    let runState: ThreadRunState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(thread.title)
                        .font(.headline)
                    if let selectedModel {
                        Label(selectedModel, systemImage: "cpu")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                RunStatePill(runState: runState)
            }

            ToolRunStatusPlaceholder(runState: runState)
        }
        .padding(14)
        .background(WorkbenchTheme.panel)
    }
}

private struct ToolRunStatusPlaceholder: View {
    let runState: ThreadRunState

    var body: some View {
        HStack(spacing: 10) {
            if runState == .running || runState == .queued || runState == .cancelling {
                ProgressView()
                    .controlSize(.small)
            } else {
                Image(systemName: "wrench.and.screwdriver")
                    .foregroundStyle(WorkbenchTheme.accent)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text("Tool and run status")
                    .font(.subheadline.weight(.semibold))
                Text(statusText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(12)
        .background(WorkbenchTheme.accentSoft.opacity(0.55), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var statusText: String {
        if runState == .idle {
            "等待下一次请求。"
        } else if runState == .queued {
            "已提交到主机队列。"
        } else if runState == .running {
            "Codex 正在运行工具或生成回复。"
        } else if runState == .cancelling {
            "已请求停止。"
        } else if runState == .failed {
            "上一次运行失败，可以从工具栏重试。"
        } else if runState == .completed {
            "上一次运行已完成。"
        } else if runState == .cancelled {
            "上一次运行已取消。"
        } else {
            runState.phase.capitalized
        }
    }
}
