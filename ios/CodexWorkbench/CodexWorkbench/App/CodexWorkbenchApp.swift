import SwiftUI

@main
struct CodexWorkbenchApp: App {
    @State private var appState = AppState.bootstrap()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
        }
        .onChange(of: scenePhase) {
            if scenePhase == .active {
                Task {
                    await appState.foregroundRefresh()
                }
            }
        }
    }
}
