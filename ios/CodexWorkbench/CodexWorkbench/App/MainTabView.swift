import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            ProjectsSplitView()
                .tabItem {
                    Label("Chats", systemImage: "bubble.left.and.bubble.right")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
        }
    }
}
