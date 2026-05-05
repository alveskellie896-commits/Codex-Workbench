import SwiftUI

struct ThreadListView: View {
    @Environment(AppState.self) private var appState
    let project: ProjectSummary
    @Binding var selection: ThreadSummary?
    @State private var threads: [ThreadSummary] = []
    @State private var searchText = ""
    @State private var showsSubagents = false
    @State private var isLoading = false
    @State private var isCreatingThread = false
    @State private var errorMessage: String?

    private var visibleThreads: [ThreadSummary] {
        let source = showsSubagents ? threads : threads.filter { isLikelySubagent($0) == false }
        return source.matching(searchText)
    }

    private var hiddenSubagentCount: Int {
        let visibleWithoutSearch = showsSubagents ? threads : threads.filter { isLikelySubagent($0) == false }
        return max(threads.count - visibleWithoutSearch.count, 0)
    }

    private var isSearching: Bool {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
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
                    if isCreatingThread {
                        CreatingThreadRow()
                    }
                    if visibleThreads.isEmpty && isSearching {
                        ThreadSearchEmptyRow(query: searchText)
                    } else {
                        ForEach(visibleThreads) { thread in
                            ThreadRow(thread: thread)
                                .tag(thread)
                        }
                    }
                } header: {
                    Text("Conversations")
                } footer: {
                    if hiddenSubagentCount > 0 {
                        Text("\(hiddenSubagentCount) multi-agent subthreads hidden. Use the toggle above to inspect them.")
                    }
                }
            }
            .scrollContentBackground(.hidden)
        }
        .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Search conversations")
        .overlay {
            ThreadListOverlay(
                isLoading: isLoading,
                hasThreads: threads.isEmpty == false,
                isEmpty: threads.isEmpty,
                errorMessage: errorMessage,
                retry: reload
            )
        }
        .navigationTitle(project.name)
        .task(id: project.id) {
            await reloadAsync()
        }
        .refreshable {
            await reloadAsync()
        }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("New Chat", systemImage: "square.and.pencil", action: createThread)
                    .disabled(isCreatingThread)

                Button("Refresh", systemImage: "arrow.clockwise", action: reload)
                    .disabled(isLoading)
            }
        }
    }

    private func isLikelySubagent(_ thread: ThreadSummary) -> Bool {
        thread.isSubagent || thread.parentThreadId != nil || thread.subagentDepth != nil || thread.title.localizedCaseInsensitiveContains("agent")
    }

    private func reload() {
        Task {
            await reloadAsync()
        }
    }

    private func createThread() {
        guard isCreatingThread == false else {
            return
        }
        isCreatingThread = true
        errorMessage = nil

        Task {
            do {
                let thread = try await appState.apiClient.createThread(projectID: project.id)
                await MainActor.run {
                    threads.insertOrMoveToFront(thread)
                    selection = thread
                    isCreatingThread = false
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isCreatingThread = false
                }
            }
        }
    }

    private func reloadAsync() async {
        isLoading = true
        errorMessage = nil

        do {
            threads = try await appState.apiClient.fetchThreads(projectID: project.id)
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }
}

private extension Array where Element == ThreadSummary {
    mutating func insertOrMoveToFront(_ thread: ThreadSummary) {
        removeAll { $0.id == thread.id }
        insert(thread, at: 0)
    }

    func matching(_ query: String) -> [ThreadSummary] {
        let tokens = query
            .lowercased()
            .split(whereSeparator: { $0.isWhitespace })
            .map(String.init)
        guard tokens.isEmpty == false else {
            return self
        }

        return filter { thread in
            let haystack = [
                thread.title,
                thread.cwd,
                thread.gitBranch,
                thread.model ?? "",
                thread.effectiveModel ?? "",
                thread.agentNickname,
                thread.agentRole
            ]
                .joined(separator: " ")
                .lowercased()
            return tokens.allSatisfy { haystack.contains($0) }
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
                    Label("Show multi-agent subthreads", systemImage: "person.2.wave.2")
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

private struct CreatingThreadRow: View {
    var body: some View {
        HStack(spacing: 10) {
            ProgressView()
                .controlSize(.small)
            Text("Creating chat")
                .font(.subheadline.weight(.semibold))
            Spacer()
        }
        .foregroundStyle(WorkbenchTheme.accent)
        .padding(.vertical, 6)
    }
}

private struct ThreadSearchEmptyRow: View {
    let query: String

    var body: some View {
        ContentUnavailableView {
            Label("No Matching Chats", systemImage: "magnifyingglass")
        } description: {
            Text("No conversation matches \"\(query.trimmingCharacters(in: .whitespacesAndNewlines))\".")
        }
        .padding(.vertical, 20)
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
    let hasThreads: Bool
    let isEmpty: Bool
    let errorMessage: String?
    let retry: () -> Void

    var body: some View {
        if isLoading && hasThreads == false {
            ProgressView("Loading conversations")
        } else if let errorMessage {
            ContentUnavailableView {
                Label("Could Not Load Conversations", systemImage: "exclamationmark.bubble")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("Retry", action: retry)
            }
        } else if isEmpty {
            ContentUnavailableView("No Conversations", systemImage: "message")
        }
    }
}
