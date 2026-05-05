import SwiftUI

struct MessageListView: View {
    let messages: [MessageEvent]
    @State private var isPinnedToBottom = true
    @State private var showJumpToLatest = false

    var body: some View {
        ScrollViewReader { proxy in
            GeometryReader { viewport in
                let viewportHeight = viewport.size.height

                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(messages) { message in
                            MessageBubble(message: message)
                                .id(message.id)
                        }

                        BottomSentinel()
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                }
                .coordinateSpace(name: "message-scroll")
                .background(WorkbenchTheme.pageBackground)
                .overlay {
                    if messages.isEmpty {
                        ContentUnavailableView("No Messages Yet", systemImage: "text.bubble")
                    } else if showJumpToLatest {
                        jumpToLatestButton(proxy: proxy)
                    }
                }
                .onPreferenceChange(BottomEdgePreferenceKey.self) { bottomEdge in
                    let distanceFromBottom = bottomEdge - viewportHeight
                    let pinned = distanceFromBottom < 160
                    isPinnedToBottom = pinned
                    if pinned {
                        showJumpToLatest = false
                    }
                }
                .onChange(of: latestMessageFingerprint) {
                    followLatestIfNeeded(proxy: proxy)
                }
                .onAppear {
                    scrollToBottom(proxy: proxy, animated: false)
                }
            }
        }
    }

    private var latestMessageFingerprint: String {
        guard let message = messages.last else {
            return "empty"
        }
        return [
            message.id,
            String(message.content.count),
            String(message.attachmentIDs.count)
        ].joined(separator: ":")
    }

    private func jumpToLatestButton(proxy: ScrollViewProxy) -> some View {
        VStack {
            Spacer()
            Button {
                scrollToBottom(proxy: proxy, animated: true)
            } label: {
                Label("Latest", systemImage: "arrow.down")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .foregroundStyle(.white)
                    .background(WorkbenchTheme.accent, in: Capsule())
                    .shadow(color: .black.opacity(0.16), radius: 12, y: 6)
            }
            .padding(.bottom, 12)
        }
    }

    private func followLatestIfNeeded(proxy: ScrollViewProxy) {
        guard messages.last?.id != nil else {
            return
        }
        if isPinnedToBottom {
            scrollToBottom(proxy: proxy, animated: false)
        } else {
            showJumpToLatest = true
        }
    }

    private func scrollToBottom(proxy: ScrollViewProxy, animated: Bool) {
        guard let lastID = messages.last?.id else {
            return
        }
        let scroll = {
            proxy.scrollTo(lastID, anchor: .bottom)
            showJumpToLatest = false
            isPinnedToBottom = true
        }
        if animated {
            withAnimation(.snappy(duration: 0.24)) {
                scroll()
            }
        } else {
            scroll()
        }
    }
}

private struct BottomSentinel: View {
    var body: some View {
        Color.clear
            .frame(height: 1)
            .background {
                GeometryReader { geometry in
                    Color.clear.preference(
                        key: BottomEdgePreferenceKey.self,
                        value: geometry.frame(in: .named("message-scroll")).maxY
                    )
                }
            }
    }
}

private struct BottomEdgePreferenceKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct MessageBubble: View {
    let message: MessageEvent

    private var isUser: Bool {
        message.role == .user
    }

    private var isTool: Bool {
        message.role == .tool
    }

    var body: some View {
        HStack {
            if isUser {
                Spacer(minLength: 44)
            }

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Label(message.role.rawValue.capitalized, systemImage: roleIcon)
                        .font(.caption.weight(.semibold))
                    Text(message.createdAt, style: .time)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Text(message.content)
                    .textSelection(.enabled)

                if message.attachmentIDs.isEmpty == false {
                    AttachmentIDStrip(attachmentIDs: message.attachmentIDs)
                }
            }
            .padding(12)
            .foregroundStyle(isUser ? .white : WorkbenchTheme.ink)
            .background(backgroundStyle, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(isUser ? Color.clear : WorkbenchTheme.line)
            }

            if isUser == false {
                Spacer(minLength: 44)
            }
        }
    }

    private var roleIcon: String {
        switch message.role {
        case .user:
            "person.fill"
        case .assistant:
            "sparkles"
        case .system:
            "gearshape"
        case .tool:
            "terminal"
        }
    }

    private var backgroundStyle: Color {
        if isUser {
            WorkbenchTheme.accent
        } else if isTool {
            WorkbenchTheme.accentSoft.opacity(0.75)
        } else {
            WorkbenchTheme.panel
        }
    }
}

private struct AttachmentIDStrip: View {
    let attachmentIDs: [String]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack {
                ForEach(attachmentIDs, id: \.self) { attachmentID in
                    Label(attachmentID, systemImage: "paperclip")
                        .font(.caption)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(.black.opacity(0.07), in: Capsule())
                }
            }
        }
    }
}
