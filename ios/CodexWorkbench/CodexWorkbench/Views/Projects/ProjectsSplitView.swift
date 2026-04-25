import SwiftUI

struct ProjectsSplitView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        NavigationSplitView {
            ProjectListView(
                selection: Binding(
                    get: { appState.selectedProject },
                    set: { appState.selectProject($0) }
                )
            )
        } content: {
            if let project = appState.selectedProject {
                ThreadListView(
                    project: project,
                    selection: Binding(
                        get: { appState.selectedThread },
                        set: { appState.selectThread($0) }
                    )
                )
            } else {
                ContentUnavailableView("选择一个项目", systemImage: "folder")
            }
        } detail: {
            if let thread = appState.selectedThread {
                ChatView(thread: thread)
            } else {
                ContentUnavailableView("选择一个对话", systemImage: "message")
            }
        }
    }
}
