import SwiftUI

struct ProjectListView: View {
    @Environment(AppState.self) private var appState
    @Binding var selection: ProjectSummary?

    var body: some View {
        ZStack {
            WorkbenchTheme.pageBackground.ignoresSafeArea()

            List(selection: $selection) {
                Section {
                    HostSummaryCard(hostURL: appState.hostStore.hostURL)
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                }

                Section("项目") {
                    ForEach(appState.projects) { project in
                        ProjectRow(project: project)
                            .tag(project)
                            .onTapGesture {
                                appState.selectProject(project)
                            }
                    }
                }
            }
            .scrollContentBackground(.hidden)
        }
        .overlay {
            ProjectListOverlay(
                isLoading: appState.isLoadingProjects,
                isEmpty: appState.projects.isEmpty,
                errorMessage: appState.errorMessage,
                retry: reload
            )
        }
        .navigationTitle("项目")
        .toolbar {
            Button("刷新", systemImage: "arrow.clockwise", action: reload)
                .disabled(appState.isLoadingProjects)
        }
        .task {
            if appState.projects.isEmpty {
                await appState.loadProjects()
            }
        }
        .refreshable {
            await appState.loadProjects()
        }
    }

    private func reload() {
        Task {
            await appState.loadProjects()
        }
    }
}

private struct HostSummaryCard: View {
    let hostURL: URL

    var body: some View {
        WorkbenchCard {
            HStack(spacing: 12) {
                Image(systemName: "server.rack")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(WorkbenchTheme.accent)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Mac Host Service")
                        .font(.headline)
                    Text(hostURL.absoluteString)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                StatusPill(text: "本机", systemImage: "checkmark.circle")
            }
        }
    }
}

private struct ProjectRow: View {
    let project: ProjectSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(project.name)
                        .font(.headline)
                    if let path = project.path {
                        Text(path)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer()
                Text(project.updatedAt ?? Date(), style: .relative)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            HStack {
                StatusPill(text: "\(project.threadCount) 个对话", systemImage: "bubble.left.and.bubble.right")
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 6)
    }
}

private struct ProjectListOverlay: View {
    let isLoading: Bool
    let isEmpty: Bool
    let errorMessage: String?
    let retry: () -> Void

    var body: some View {
        if isLoading {
            ProgressView("正在加载项目")
        } else if let errorMessage {
            ContentUnavailableView {
                Label("无法加载项目", systemImage: "wifi.exclamationmark")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("重试", action: retry)
            }
        } else if isEmpty {
            ContentUnavailableView("暂无项目", systemImage: "folder")
        }
    }
}
