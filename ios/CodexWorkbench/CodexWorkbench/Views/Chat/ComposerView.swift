import Foundation
import SwiftUI
import UniformTypeIdentifiers

struct ComposerView: View {
    @Binding var draft: String
    @Binding var selectedModel: String?
    @Binding var attachments: [PendingAttachment]
    let models: [ModelOption]
    let isRunning: Bool
    let maxUploadBytes: Int
    let send: () -> Void
    let stop: () -> Void
    let addAttachments: ([URL]) -> Void
    let removeAttachment: (PendingAttachment.ID) -> Void
    let retryAttachment: (PendingAttachment.ID) -> Void
    let reportAttachmentError: (String) -> Void
    @State private var isImporterPresented = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                ModelMenu(selectedModel: $selectedModel, models: models)
                Spacer()
                Text(uploadLimitLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            if attachments.isEmpty == false {
                AttachmentStrip(
                    attachments: attachments,
                    maxUploadBytes: maxUploadBytes,
                    removeAttachment: removeAttachment,
                    retryAttachment: retryAttachment
                )
            }

            HStack(alignment: .bottom, spacing: 10) {
                Button {
                    isImporterPresented = true
                } label: {
                    Image(systemName: "paperclip")
                        .font(.title3)
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("Attach file")

                TextField("Message Codex", text: $draft, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...5)

                Button(action: isRunning ? stop : send) {
                    Image(systemName: isRunning ? "stop.fill" : "arrow.up")
                        .font(.headline)
                        .frame(width: 20, height: 20)
                }
                .buttonStyle(.borderedProminent)
                .tint(isRunning ? WorkbenchTheme.danger : WorkbenchTheme.accent)
                .disabled(isSendDisabled)
                .accessibilityLabel(isRunning ? "Stop response" : "Send message")
            }
        }
        .padding()
        .background(WorkbenchTheme.panel)
        .fileImporter(isPresented: $isImporterPresented, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls):
                addAttachments(urls)
            case .failure(let error):
                reportAttachmentError(error.localizedDescription)
            }
        }
    }

    private var isSendDisabled: Bool {
        guard isRunning == false else {
            return false
        }
        let hasContent = draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        let hasAttachments = attachments.isEmpty == false
        let hasBlockedAttachment = attachments.contains { $0.canSend == false }
        return (hasContent == false && hasAttachments == false) || hasBlockedAttachment
    }

    private var uploadLimitLabel: String {
        "Up to \(ByteCountFormatter.string(fromByteCount: Int64(maxUploadBytes), countStyle: .file)) each"
    }
}

private struct AttachmentStrip: View {
    let attachments: [PendingAttachment]
    let maxUploadBytes: Int
    let removeAttachment: (PendingAttachment.ID) -> Void
    let retryAttachment: (PendingAttachment.ID) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(attachments) { attachment in
                    PendingAttachmentCard(
                        attachment: attachment,
                        canRetry: attachment.status == .failed && attachment.size <= maxUploadBytes,
                        remove: { removeAttachment(attachment.id) },
                        retry: { retryAttachment(attachment.id) }
                    )
                }
            }
            .padding(.vertical, 2)
        }
    }
}

private struct PendingAttachmentCard: View {
    let attachment: PendingAttachment
    let canRetry: Bool
    let remove: () -> Void
    let retry: () -> Void

    var body: some View {
        HStack(spacing: 9) {
            statusIcon

            VStack(alignment: .leading, spacing: 3) {
                Text(attachment.name)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(statusTint)
                    .lineLimit(1)
            }
            .frame(maxWidth: 210, alignment: .leading)

            if canRetry {
                Button(action: retry) {
                    Image(systemName: "arrow.clockwise")
                        .font(.caption.weight(.bold))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Retry upload")
            }

            Button(action: remove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove attachment")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .foregroundStyle(WorkbenchTheme.ink)
        .background(statusTint.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(statusTint.opacity(0.20))
        }
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch attachment.status {
        case .uploading:
            ProgressView()
                .controlSize(.small)
        case .uploaded:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(WorkbenchTheme.accent)
        case .failed:
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(WorkbenchTheme.danger)
        case .ready:
            Image(systemName: "doc.fill")
                .foregroundStyle(WorkbenchTheme.accent)
        }
    }

    private var subtitle: String {
        let size = ByteCountFormatter.string(fromByteCount: Int64(attachment.size), countStyle: .file)
        switch attachment.status {
        case .ready:
            return "\(size) - ready"
        case .uploading:
            return "\(size) - uploading"
        case .uploaded:
            return "\(size) - attached"
        case .failed:
            return attachment.errorMessage ?? "\(size) - failed"
        }
    }

    private var statusTint: Color {
        switch attachment.status {
        case .failed:
            WorkbenchTheme.danger
        case .uploading:
            WorkbenchTheme.warning
        case .ready, .uploaded:
            WorkbenchTheme.accent
        }
    }
}

private struct ModelMenu: View {
    @Binding var selectedModel: String?
    let models: [ModelOption]

    var body: some View {
        Menu {
            Button("Default") {
                selectedModel = nil
            }
            ForEach(models) { model in
                Button(model.displayName) {
                    selectedModel = model.id
                }
            }
        } label: {
            Label(selectedTitle, systemImage: "cpu")
                .font(.caption.weight(.semibold))
        }
        .buttonStyle(.bordered)
    }

    private var selectedTitle: String {
        guard let selectedModel else {
            return "Default model"
        }
        return models.first { $0.id == selectedModel }?.displayName ?? selectedModel
    }
}
