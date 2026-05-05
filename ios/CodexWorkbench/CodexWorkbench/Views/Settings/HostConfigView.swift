import SwiftUI

struct HostConfigView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            WorkbenchTheme.pageBackground.ignoresSafeArea()

            Form {
                Section {
                    HostURLField(hostStore: appState.hostStore)
                } header: {
                    Text("Computer URL")
                } footer: {
                    Text("Use the Windows service URL. On the same Wi-Fi this is usually a LAN address; outside the network use the public phone link.")
                }

                Section("Connection Checklist") {
                    Label("Local network permission", systemImage: "network")
                    Label("Computer password or trusted device pairing", systemImage: "key")
                    Label("Project index and session database access", systemImage: "folder")
                }

                Section("Actions") {
                    Button {
                        Task {
                            await appState.refreshBootstrap()
                        }
                    } label: {
                        Label("Test Connection", systemImage: "antenna.radiowaves.left.and.right")
                    }
                    .disabled(appState.isRefreshingBootstrap)
                }
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Connection")
    }
}
