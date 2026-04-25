import SwiftUI

struct ThreadListView: View {
    @Environment(AppState.self) private var appState
    let project: ProjectSummary
    @Binding var selection: ThreadSummary?
    @State private var showsSubagents = false

    private var threads: [ThreadSummary] {
        appState.threads(for: project)
    }

    private var visibleThreads: [ThreadSummary] {
        showsSubagents ? threads : threads.filter { isLikelySubagent($0) == false }
    }

    private var hiddenSubagentCount: Int {
        max(threads.count - visibleThreads.count, 0)
    }

    var body: some View {
        ZStack {
            WorkbenchTheme.pageBackground.ignoresSafeArea()

            List(selection: $selection) {
                Section {
                    ProjectConversationHeader(project: project, showsSubagents: $showsSubagents)
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                }

                Section {
                    ForEach(visibleThreads) { thread in
                        ThreadRow(thread: thread)
                            .tag(thread)
                            .onTapGesture {
                                appState.selectThread(thread)
                            }
                    }
                } header: {
                    Text("对话")
                } footer: {
                    if hiddenSubagentCount > 0 {
                        Text("已隐藏 \(hiddenSubagentCount) 个多 agent 子线程。打开上方开关可以查看。")
                    }
                }
            }
            .scrollContentBackground(.hidden)
        }
        .overlay {
            ThreadListOverlay(
                isLoading: appState.loadingProjectIDs.contains(project.id),
                isEmpty: threads.isEmpty,
                errorMessage: appState.errorMessage,
                retry: reload
            )
        }
        .navigationTitle(project.name)
        .task(id: project.id) {
            await appState.loadThreads(for: project)
        }
        .refreshable {
            await appState.loadThreads(for: project)
        }
        .toolbar {
            Button("刷新", systemImage: "arrow.clockwise", action: reload)
                .disabled(appState.loadingProjectIDs.contains(project.id))
        }
    }

    private func isLikelySubagent(_ thread: ThreadSummary) -> Bool {
        thread.isSubagent || thread.parentThreadId != nil || thread.subagentDepth != nil || thread.title.localizedCaseInsensitiveContains("agent")
    }

    private func reload() {
        Task {
            await appState.loadThreads(for: project)
        }
    }
}

private struct ProjectConversationHeader: View {
    let project: ProjectSummary
    @Binding var showsSubagents: Bool

    var body: some View {
        WorkbenchCard {
            VStack(alignment: .leading, spacing: 10) {
                Text(project.name)
                    .font(.title2.weight(.bold))
                if let path = project.path {
                    Text(path)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Toggle(isOn: $showsSubagents.animation()) {
                    Label("显示多 agent 子线程", systemImage: "person.2.wave.2")
                }
                .font(.subheadline)
            }
        }
    }
}

private struct ThreadRow: View {
    let thread: ThreadSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                Text(thread.title)
                    .font(.headline)
                    .lineLimit(2)
                Spacer()
                RunStatePill(runState: thread.runState)
            }

            HStack {
                if let model = thread.model {
                    Label(model, systemImage: "cpu")
                }
                if let updatedAt = thread.updatedAt {
                    Text(updatedAt, style: .relative)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
    }
}

struct RunStatePill: View {
    let runState: ThreadRunState

    var body: some View {
        StatusPill(text: runState.rawValue.capitalized, systemImage: icon, tint: tint)
    }

    private var tint: Color {
        runState == .failed ? WorkbenchTheme.danger : WorkbenchTheme.accent
    }

    private var icon: String {
        if runState == .queued {
            "clock"
        } else if runState == .running || runState == .cancelling {
            "terminal"
        } else if runState == .failed {
            "exclamationmark.triangle"
        } else if runState == .completed {
            "checkmark.circle"
        } else if runState == .cancelled {
            "xmark.circle"
        } else {
            "circle"
        }
    }
}

private struct ThreadListOverlay: View {
    let isLoading: Bool
    let isEmpty: Bool
    let errorMessage: String?
    let retry: () -> Void

    var body: some View {
        if isLoading {
            ProgressView("正在加载对话")
        } else if let errorMessage {
            ContentUnavailableView {
                Label("无法加载对话", systemImage: "exclamationmark.bubble")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("重试", action: retry)
            }
        } else if isEmpty {
            ContentUnavailableView("暂无对话", systemImage: "message")
        }
    }
}
