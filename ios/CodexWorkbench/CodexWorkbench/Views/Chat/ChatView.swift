import Foundation
import SwiftUI
import UniformTypeIdentifiers

struct ChatView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.scenePhase) private var scenePhase
    let thread: ThreadSummary
    @State private var draft = ""
    @State private var attachments: [PendingAttachment] = []
    @State private var availableModels: [ModelOption] = []
    @State private var runtimeInfo: RuntimeInfo?
    @State private var runtimeControls = RuntimeControls()
    @State private var isRuntimeSheetPresented = false
    @State private var runState: ThreadRunState
    @State private var localMessages: [MessageEvent] = []
    @State private var sendQueue: [SendQueueItem] = []
    @State private var isProcessingSendQueue = false
    @State private var isOpeningDesktop = false
    @State private var errorMessage: String?
    @State private var realtimeState = RealtimeState.offline
    @State private var detailRefreshTask: Task<Void, Never>?
    @State private var shouldNotifyRunCompletion = false

    init(thread: ThreadSummary) {
        self.thread = thread
        _runState = State(initialValue: thread.runState)
    }

    var body: some View {
        VStack(spacing: 0) {
            ChatHeader(
                thread: thread,
                selectedModel: selectedModel ?? thread.model,
                runtimeControls: runtimeControls,
                runState: runState,
                realtimeState: realtimeState
            )
            Divider()
            MessageListView(messages: visibleMessages)
            if sendQueue.isEmpty == false {
                SendQueueStrip(
                    items: sendQueue,
                    retry: retryQueueItem,
                    dismiss: dismissQueueItem
                )
            }
            Divider()
            ComposerView(
                draft: $draft,
                selectedModel: selectedModelBinding,
                attachments: $attachments,
                models: availableModels,
                isRunning: runState == .running || runState == .queued,
                maxUploadBytes: maxUploadBytes,
                send: send,
                stop: stop,
                addAttachments: addAttachments,
                removeAttachment: removeAttachment,
                retryAttachment: retryAttachment,
                reportAttachmentError: reportAttachmentError
            )
        }
        .background(WorkbenchTheme.pageBackground)
        .navigationTitle(thread.title)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("Open on Computer", systemImage: "rectangle.connected.to.line.below") {
                    openOnComputer()
                }
                .disabled(isOpeningDesktop)

                Button("Run Controls", systemImage: "slider.horizontal.3") {
                    isRuntimeSheetPresented = true
                }

                Button("Retry", systemImage: "arrow.counterclockwise", action: retry)
            }
        }
        .sheet(isPresented: $isRuntimeSheetPresented) {
            RuntimeControlsSheet(
                controls: $runtimeControls,
                runtimeInfo: runtimeInfo,
                models: availableModels,
                save: saveRuntimeControls
            )
        }
        .task(id: thread.id) {
            await loadThread()
            await loadModels()
            await loadRuntimeControls()
        }
        .task(id: "\(thread.id):realtime") {
            await listenForRealtimeEvents()
        }
        .onChange(of: scenePhase) {
            if scenePhase == .active {
                scheduleDetailRefresh(delayNanoseconds: 50_000_000)
            }
        }
        .onDisappear {
            detailRefreshTask?.cancel()
            detailRefreshTask = nil
        }
        .alert("Chat Error", isPresented: hasErrorMessage) {
            Button("OK", role: .cancel) {
                errorMessage = nil
            }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var visibleMessages: [MessageEvent] {
        localMessages.isEmpty ? appState.messages(for: thread) : localMessages
    }

    private var hasErrorMessage: Binding<Bool> {
        Binding(
            get: { errorMessage != nil },
            set: { if $0 == false { errorMessage = nil } }
        )
    }

    private var maxUploadBytes: Int {
        appState.bootstrapInfo?.limits.upload?.maxFileBytes ?? 25 * 1024 * 1024
    }

    private var selectedModel: String? {
        runtimeControls.model.isEmpty ? nil : runtimeControls.model
    }

    private var selectedModelBinding: Binding<String?> {
        Binding(
            get: { selectedModel },
            set: { runtimeControls.model = $0 ?? "" }
        )
    }

    @MainActor
    private func loadThread() async {
        do {
            let detail = try await appState.apiClient.fetchThread(threadID: thread.id)
            apply(detail)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func loadModels() async {
        do {
            availableModels = try await appState.apiClient.fetchModels()
        } catch {
            availableModels = []
        }
    }

    @MainActor
    private func loadRuntimeControls() async {
        do {
            let info = try await appState.apiClient.threadRuntime(threadID: thread.id)
            applyRuntimeInfo(info)
        } catch {
            if runtimeInfo == nil {
                runtimeControls = RuntimeControls(model: thread.effectiveModel ?? thread.model ?? runtimeControls.model)
            }
        }
    }

    private func saveRuntimeControls(_ controls: RuntimeControls) async throws -> RuntimeInfo {
        let info = try await appState.apiClient.setThreadRuntime(threadID: thread.id, controls: controls)
        await MainActor.run {
            applyRuntimeInfo(info)
        }
        return info
    }

    private func send() {
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard content.isEmpty == false || attachments.isEmpty == false else {
            return
        }
        guard attachments.contains(where: { $0.canSend == false }) == false else {
            errorMessage = "Remove or retry failed attachments before sending."
            return
        }

        let item = SendQueueItem(
            threadId: thread.id,
            text: content,
            attachments: attachments,
            runtime: runtimeControls,
            stage: .queued
        )
        sendQueue.append(item)
        draft = ""
        attachments = []
        processSendQueue()
    }

    private func processSendQueue() {
        guard isProcessingSendQueue == false else {
            return
        }
        isProcessingSendQueue = true

        Task {
            while let queueID = await MainActor.run(body: { sendQueue.first { $0.stage == .queued }?.id }) {
                do {
                    let detail = try await processQueueItemOnNetwork(queueID)
                    await MainActor.run {
                        if let detail {
                            apply(detail)
                        }
                    }
                } catch {
                    await MainActor.run {
                        markQueueItem(queueID, stage: .failed, errorMessage: error.localizedDescription)
                    }
                }
            }

            await MainActor.run {
                isProcessingSendQueue = false
                if sendQueue.contains(where: { $0.stage == .queued }) {
                    processSendQueue()
                }
            }
        }
    }

    private func retryQueueItem(_ queueID: SendQueueItem.ID) {
        markQueueItem(queueID, stage: .queued, errorMessage: nil)
        processSendQueue()
    }

    private func dismissQueueItem(_ queueID: SendQueueItem.ID) {
        sendQueue.removeAll { $0.id == queueID }
    }

    private func processQueueItemOnNetwork(_ queueID: SendQueueItem.ID) async throws -> ThreadDetail? {
        guard let snapshot = await MainActor.run(body: { sendQueue.first { $0.id == queueID } }) else {
            return nil
        }
        let currentRunState = await MainActor.run(body: { runState })

        if currentRunState.isActiveRunState {
            await MainActor.run {
                markQueueItem(queueID, stage: snapshot.attachments.isEmpty ? .sending : .uploading)
            }

            if snapshot.attachments.isEmpty {
                let response = try await appState.apiClient.enqueueFollowUp(
                    threadID: thread.id,
                    message: snapshot.text,
                    runtime: snapshot.runtime
                )
                await MainActor.run {
                    if let nextState = response.state {
                        runState = nextState
                    }
                    markQueueItem(
                        queueID,
                        stage: .followUpQueued,
                        followUpId: response.followUp?.id
                    )
                }
                return nil
            }

            let uploadedFiles = try await uploadAttachments(for: snapshot)
            await MainActor.run {
                markQueueItem(queueID, stage: .sending)
            }
            let detail = try await appState.apiClient.sendMessage(
                threadID: thread.id,
                content: snapshot.text,
                model: snapshot.runtime.model,
                attachments: uploadedFiles,
                runtime: snapshot.runtime
            )
            await MainActor.run {
                markQueueItem(queueID, stage: .followUpQueued)
            }
            return detail
        }

        await MainActor.run {
            markQueueItem(queueID, stage: snapshot.attachments.isEmpty ? .sending : .uploading)
            shouldNotifyRunCompletion = true
        }

        let uploadedFiles = try await uploadAttachments(for: snapshot)
        await MainActor.run {
            markQueueItem(queueID, stage: .sending)
        }

        let detail = try await appState.apiClient.sendMessage(
            threadID: thread.id,
            content: snapshot.text,
            model: snapshot.runtime.model,
            attachments: uploadedFiles,
            runtime: snapshot.runtime
        )

        await MainActor.run {
            markQueueItem(queueID, stage: .submitted)
        }
        return detail
    }

    private func stop() {
        Task {
            await appState.cancel(thread: thread)
        }
    }

    private func retry() {
        runState = .queued
        shouldNotifyRunCompletion = true

        Task {
            do {
                let detail = try await appState.apiClient.retry(threadID: thread.id)
                await MainActor.run {
                    apply(detail)
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    runState = .failed
                }
            }
        }
    }

    private func openOnComputer() {
        guard isOpeningDesktop == false else {
            return
        }
        isOpeningDesktop = true
        errorMessage = nil

        Task {
            do {
                _ = try await appState.apiClient.openDesktopThread(threadID: thread.id)
                await MainActor.run {
                    isOpeningDesktop = false
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isOpeningDesktop = false
                }
            }
        }
    }

    private func addAttachments(_ urls: [URL]) {
        guard urls.isEmpty == false else {
            return
        }

        for url in urls {
            do {
                attachments.append(try makePendingAttachment(from: url))
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func removeAttachment(_ id: PendingAttachment.ID) {
        attachments.removeAll { $0.id == id }
    }

    private func retryAttachment(_ id: PendingAttachment.ID) {
        guard let index = attachments.firstIndex(where: { $0.id == id }) else {
            return
        }
        attachments[index].status = .ready
        attachments[index].uploadedFile = nil
        attachments[index].errorMessage = nil
    }

    private func reportAttachmentError(_ message: String) {
        errorMessage = message
    }

    private func makePendingAttachment(from url: URL) throws -> PendingAttachment {
        let didAccess = url.startAccessingSecurityScopedResource()
        defer {
            if didAccess {
                url.stopAccessingSecurityScopedResource()
            }
        }

        let fileName = url.lastPathComponent.isEmpty ? "attachment" : url.lastPathComponent
        let contentType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let fileSize = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize
        if let fileSize, fileSize > maxUploadBytes {
            return PendingAttachment(
                name: fileName,
                contentType: contentType,
                size: fileSize,
                data: Data(),
                status: .failed,
                uploadedFile: nil,
                errorMessage: "File is larger than \(ByteCountFormatter.string(fromByteCount: Int64(maxUploadBytes), countStyle: .file))."
            )
        }

        let data = try Data(contentsOf: url)
        let isTooLarge = data.count > maxUploadBytes

        return PendingAttachment(
            name: fileName,
            contentType: contentType,
            size: data.count,
            data: data,
            status: isTooLarge ? .failed : .ready,
            uploadedFile: nil,
            errorMessage: isTooLarge ? "File is larger than \(ByteCountFormatter.string(fromByteCount: Int64(maxUploadBytes), countStyle: .file))." : nil
        )
    }

    private func uploadAttachments(for item: SendQueueItem) async throws -> [UploadedFile] {
        var uploadedFiles: [UploadedFile] = []

        for attachment in item.attachments {
            if let uploadedFile = attachment.uploadedFile {
                uploadedFiles.append(uploadedFile)
                continue
            }

            let uploadedFile = try await appState.apiClient.uploadAttachment(
                threadID: thread.id,
                fileName: attachment.name,
                contentType: attachment.contentType,
                data: attachment.data
            )
            uploadedFiles.append(uploadedFile)
        }

        return uploadedFiles
    }

    @MainActor
    private func markQueueItem(
        _ id: SendQueueItem.ID,
        stage: SendQueueStage,
        errorMessage: String? = nil,
        followUpId: String? = nil
    ) {
        guard let index = sendQueue.firstIndex(where: { $0.id == id }) else {
            return
        }
        sendQueue[index].stage = stage
        sendQueue[index].errorMessage = errorMessage
        if let followUpId {
            sendQueue[index].followUpId = followUpId
        }
    }

    @MainActor
    private func updateAttachment(
        _ id: PendingAttachment.ID,
        status: PendingAttachmentStatus,
        uploadedFile: UploadedFile? = nil,
        errorMessage: String? = nil
    ) {
        guard let index = attachments.firstIndex(where: { $0.id == id }) else {
            return
        }
        attachments[index].status = status
        attachments[index].uploadedFile = uploadedFile
        attachments[index].errorMessage = errorMessage
    }

    @MainActor
    private func apply(_ detail: ThreadDetail) {
        let previousState = runState
        localMessages = mergedMessages(current: visibleMessages, incoming: detail.messages)
        appState.messagesByThread[thread.id] = localMessages
        runState = detail.state ?? detail.thread.runState
        appState.runStatesByThread[thread.id] = runState
        appState.selectedThread = detail.thread
        if runtimeControls.model.isEmpty {
            runtimeControls.model = detail.thread.effectiveModel ?? detail.thread.model ?? ""
        }
        notifyIfNeeded(from: previousState, to: runState)
    }

    @MainActor
    private func applyRuntimeInfo(_ info: RuntimeInfo) {
        runtimeInfo = info
        runtimeControls = info.effectiveControls
    }

    @MainActor
    private func listenForRealtimeEvents() async {
        do {
            realtimeState = .connecting
            for try await event in appState.webSocketClient.eventsWithReconnect() {
                await handleRealtimeEvent(event)
            }
        } catch {
            await MainActor.run {
                realtimeState = .offline
            }
            await loadThread()
        }
    }

    @MainActor
    private func handleRealtimeEvent(_ event: WorkbenchSocketEvent) {
        if event.type == .systemConnected {
            realtimeState = .online
            scheduleDetailRefresh(delayNanoseconds: 150_000_000)
            return
        }

        if event.type == .securityDeviceRevoked {
            realtimeState = .offline
            appState.signOut()
            return
        }

        guard event.threadID == nil || event.threadID == thread.id else {
            return
        }

        let previousState = runState

        if let nextState = ThreadRunState.fromSocketPayload(event.statePayload) {
            runState = nextState
        } else if event.type == .runStarted {
            runState = ThreadRunState(threadId: thread.id, phase: "running", canCancel: true)
            shouldNotifyRunCompletion = true
        } else if event.type == .runFinished {
            runState = ThreadRunState(threadId: thread.id, phase: "idle", canCancel: false, canRetry: true)
        } else if event.type == .runFailed {
            runState = ThreadRunState(threadId: thread.id, phase: "failed", canCancel: false, canRetry: true)
            if let message = event.runErrorMessage, message.isEmpty == false {
                errorMessage = message
            }
        }

        if event.type == .modelChanged, let model = event.model {
            runtimeControls.model = model
        }

        if event.type == .runtimeChanged {
            scheduleRuntimeRefresh()
        }

        if event.type == .followUpQueued {
            reconcileFollowUpQueued(event)
        }

        notifyIfNeeded(from: previousState, to: runState, errorMessage: event.runErrorMessage)

        if shouldRefreshDetail(for: event) {
            scheduleDetailRefresh()
        }
    }

    @MainActor
    private func reconcileFollowUpQueued(_ event: WorkbenchSocketEvent) {
        guard let prompt = event.payload?["item"]?["prompt"]?.stringValue,
              let index = sendQueue.firstIndex(where: { item in
                  item.text == prompt && (item.stage == .sending || item.stage == .queued)
              })
        else {
            return
        }
        sendQueue[index].stage = .followUpQueued
        sendQueue[index].followUpId = event.payload?["item"]?["id"]?.stringValue
    }

    @MainActor
    private func notifyIfNeeded(
        from previousState: ThreadRunState,
        to nextState: ThreadRunState,
        errorMessage: String? = nil
    ) {
        guard shouldNotifyRunCompletion else {
            return
        }
        guard previousState.isActiveRunState, nextState.isTerminalRunState else {
            return
        }
        shouldNotifyRunCompletion = false

        let threadTitle = thread.title.isEmpty ? "Codex task" : thread.title
        if nextState == .failed {
            Task {
                await appState.notificationService.notifyThreadFailed(
                    title: "Codex needs attention",
                    body: errorMessage?.isEmpty == false ? errorMessage ?? "\(threadTitle) failed." : "\(threadTitle) failed.",
                    threadID: thread.id
                )
            }
        } else {
            Task {
                await appState.notificationService.notifyThreadCompleted(
                    title: "Codex finished",
                    body: threadTitle,
                    threadID: thread.id
                )
            }
        }
    }

    @MainActor
    private func scheduleDetailRefresh(delayNanoseconds: UInt64 = 250_000_000) {
        detailRefreshTask?.cancel()
        detailRefreshTask = Task {
            try? await Task.sleep(nanoseconds: delayNanoseconds)
            if Task.isCancelled {
                return
            }
            await loadThread()
        }
    }

    private func shouldRefreshDetail(for event: WorkbenchSocketEvent) -> Bool {
        switch event.type {
        case .messageAppended,
             .threadUpdated,
             .threadStatus,
             .runStarted,
             .runFinished,
             .runFailed,
             .runEvent,
             .runOutput,
             .followUpQueued,
             .followUpUpdated,
             .followUpCancelled,
             .followUpReordered,
             .runtimeChanged:
            true
        default:
            false
        }
    }

    @MainActor
    private func scheduleRuntimeRefresh() {
        Task {
            await loadRuntimeControls()
        }
    }
}

private enum RealtimeState: Equatable {
    case offline
    case connecting
    case online
}

private func mergedMessages(current: [MessageEvent], incoming: [MessageEvent]) -> [MessageEvent] {
    var byId: [String: MessageEvent] = [:]
    for message in current {
        byId[message.id] = message
    }
    for message in incoming {
        byId[message.id] = message
    }
    return byId.values.sorted { $0.createdAt < $1.createdAt }
}

private extension ThreadRunState {
    var isActiveRunState: Bool {
        self == .queued || self == .running || self == .starting || self == .cancelling
    }

    var isTerminalRunState: Bool {
        self == .idle || self == .completed || self == .failed || self == .cancelled
    }
}

private struct SendQueueStrip: View {
    let items: [SendQueueItem]
    let retry: (SendQueueItem.ID) -> Void
    let dismiss: (SendQueueItem.ID) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(items) { item in
                HStack(spacing: 10) {
                    queueIcon(for: item.stage)

                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.text.isEmpty ? attachmentOnlyTitle(item) : item.text)
                            .font(.caption.weight(.semibold))
                            .lineLimit(1)
                        Text(queueSubtitle(for: item))
                            .font(.caption2)
                            .foregroundStyle(queueTint(for: item.stage))
                            .lineLimit(2)
                    }

                    Spacer()

                    if item.canRetry {
                        Button {
                            retry(item.id)
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Retry queued message")
                    }

                    if item.canDismiss {
                        Button {
                            dismiss(item.id)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Dismiss queued message")
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(queueTint(for: item.stage).opacity(0.10), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(queueTint(for: item.stage).opacity(0.18))
                }
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(WorkbenchTheme.panel)
    }

    @ViewBuilder
    private func queueIcon(for stage: SendQueueStage) -> some View {
        switch stage {
        case .queued, .uploading, .sending:
            ProgressView()
                .controlSize(.small)
        case .submitted, .followUpQueued:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(WorkbenchTheme.accent)
        case .failed:
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(WorkbenchTheme.danger)
        }
    }

    private func queueSubtitle(for item: SendQueueItem) -> String {
        switch item.stage {
        case .queued:
            "Queued locally on this iPhone."
        case .uploading:
            "Uploading \(item.attachments.count) attachment(s)."
        case .sending:
            "Sending to the Windows computer."
        case .submitted:
            "Delivered to Codex."
        case .followUpQueued:
            "Queued as a follow-up on the computer."
        case .failed:
            return item.errorMessage ?? "Send failed."
        }
    }

    private func queueTint(for stage: SendQueueStage) -> Color {
        switch stage {
        case .failed:
            WorkbenchTheme.danger
        case .queued, .uploading, .sending:
            WorkbenchTheme.warning
        case .submitted, .followUpQueued:
            WorkbenchTheme.accent
        }
    }

    private func attachmentOnlyTitle(_ item: SendQueueItem) -> String {
        if item.attachments.count == 1 {
            return item.attachments[0].name
        }
        return "\(item.attachments.count) attachments"
    }
}

private struct ChatHeader: View {
    let thread: ThreadSummary
    let selectedModel: String?
    let runtimeControls: RuntimeControls
    let runState: ThreadRunState
    let realtimeState: RealtimeState

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
                RealtimePill(state: realtimeState)
                RunStatePill(runState: runState)
            }

            RuntimeSummaryRow(controls: runtimeControls)
            ToolRunStatusPlaceholder(runState: runState)
        }
        .padding(14)
        .background(WorkbenchTheme.panel)
    }
}

private struct RuntimeSummaryRow: View {
    let controls: RuntimeControls

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                StatusPill(text: controls.reasoningEffort, systemImage: "brain", tint: WorkbenchTheme.accent)
                StatusPill(text: accessLabel, systemImage: "lock.shield", tint: accessTint)
                if controls.planMode {
                    StatusPill(text: "Plan", systemImage: "list.bullet.clipboard", tint: WorkbenchTheme.warning)
                }
            }
        }
    }

    private var accessLabel: String {
        switch controls.accessMode {
        case "read-only":
            "Read-only"
        case "full-access":
            "Full access"
        default:
            "Ask first"
        }
    }

    private var accessTint: Color {
        controls.accessMode == "full-access" ? WorkbenchTheme.warning : WorkbenchTheme.accent
    }
}

private struct RealtimePill: View {
    let state: RealtimeState

    var body: some View {
        StatusPill(text: label, systemImage: icon, tint: tint)
    }

    private var label: String {
        switch state {
        case .online:
            "Live"
        case .connecting:
            "Syncing"
        case .offline:
            "Offline"
        }
    }

    private var icon: String {
        switch state {
        case .online:
            "bolt.horizontal.circle"
        case .connecting:
            "arrow.triangle.2.circlepath"
        case .offline:
            "wifi.slash"
        }
    }

    private var tint: Color {
        switch state {
        case .online:
            WorkbenchTheme.accent
        case .connecting:
            WorkbenchTheme.warning
        case .offline:
            WorkbenchTheme.mutedInk
        }
    }
}

private struct RuntimeControlsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var controls: RuntimeControls
    let runtimeInfo: RuntimeInfo?
    let models: [ModelOption]
    let save: (RuntimeControls) async throws -> RuntimeInfo
    @State private var draft: RuntimeControls
    @State private var isSaving = false
    @State private var isFullAccessConfirmationPresented = false
    @State private var errorMessage: String?

    init(
        controls: Binding<RuntimeControls>,
        runtimeInfo: RuntimeInfo?,
        models: [ModelOption],
        save: @escaping (RuntimeControls) async throws -> RuntimeInfo
    ) {
        self._controls = controls
        self.runtimeInfo = runtimeInfo
        self.models = models
        self.save = save
        self._draft = State(initialValue: controls.wrappedValue)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Model") {
                    Picker("Model", selection: modelBinding) {
                        Text("Default model").tag("")
                        ForEach(models) { model in
                            Text(model.displayName).tag(model.id)
                        }
                    }
                    if models.isEmpty {
                        Text("Model list is unavailable. The current default model will be used.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Reasoning") {
                    Picker("Effort", selection: $draft.reasoningEffort) {
                        ForEach(reasoningEfforts, id: \.self) { effort in
                            Text(effort.capitalized).tag(effort)
                        }
                    }
                    .pickerStyle(.segmented)
                    .disabled(runtimeInfo?.capabilities.controls.reasoningEffort.supported == false)
                    unsupportedNote(for: runtimeInfo?.capabilities.controls.reasoningEffort)
                }

                Section("Access") {
                    Picker("Access mode", selection: $draft.accessMode) {
                        ForEach(accessModes) { mode in
                            Text(mode.label).tag(mode.value)
                        }
                    }
                    unsupportedNote(for: runtimeInfo?.capabilities.controls.accessMode)
                    if let warning = selectedAccessMode?.warning, warning.isEmpty == false {
                        Label(warning, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(draft.accessMode == "full-access" ? WorkbenchTheme.warning : .secondary)
                    }
                }

                Section("Planning") {
                    Toggle("Plan Mode", isOn: $draft.planMode)
                        .disabled(runtimeInfo?.capabilities.controls.planMode.supported == false)
                    unsupportedNote(for: runtimeInfo?.capabilities.controls.planMode)
                }

                Section("Delivery") {
                    SettingsRuntimeRow(
                        title: "Send mode",
                        detail: runtimeInfo?.capabilities.sendMode ?? "desktop",
                        systemImage: "desktopcomputer"
                    )
                    if let note = runtimeInfo?.capabilities.controls.steerActiveRun.note, note.isEmpty == false {
                        Text(note)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(WorkbenchTheme.danger)
                    }
                }
            }
            .navigationTitle("Run Controls")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        saveDraft()
                    } label: {
                        if isSaving {
                            ProgressView()
                        } else {
                            Text("Save")
                        }
                    }
                    .disabled(isSaving)
                }
            }
            .onChange(of: controls) {
                draft = controls
            }
            .confirmationDialog(
                "Full access",
                isPresented: $isFullAccessConfirmationPresented,
                titleVisibility: .visible
            ) {
                Button("Save Full Access", role: .destructive) {
                    persistDraft()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(selectedAccessMode?.warning ?? "Only use full access for a trusted local project.")
            }
        }
    }

    private var modelBinding: Binding<String> {
        Binding(
            get: { draft.model },
            set: { draft.model = $0 }
        )
    }

    private var reasoningEfforts: [String] {
        let values = runtimeInfo?.reasoningEfforts ?? ["low", "medium", "high", "xhigh"]
        return values.isEmpty ? ["low", "medium", "high", "xhigh"] : values
    }

    private var accessModes: [RuntimeAccessMode] {
        let values = runtimeInfo?.accessModes ?? RuntimeInfo.defaultAccessModes
        return values.isEmpty ? RuntimeInfo.defaultAccessModes : values
    }

    private var selectedAccessMode: RuntimeAccessMode? {
        accessModes.first { $0.value == draft.accessMode }
    }

    @ViewBuilder
    private func unsupportedNote(for support: RuntimeControlSupport?) -> some View {
        if support?.supported == false {
            Text(support?.note ?? "This control is visible for compatibility, but the current computer transport may ignore it.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private func saveDraft() {
        if draft.accessMode == "full-access" {
            isFullAccessConfirmationPresented = true
            return
        }
        persistDraft()
    }

    private func persistDraft() {
        isSaving = true
        errorMessage = nil
        controls = draft

        Task {
            do {
                _ = try await save(draft)
                await MainActor.run {
                    isSaving = false
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    isSaving = false
                    errorMessage = error.localizedDescription
                }
            }
        }
    }
}

private struct SettingsRuntimeRow: View {
    let title: String
    let detail: String
    let systemImage: String

    var body: some View {
        Label {
            HStack {
                Text(title)
                Spacer()
                Text(detail)
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: systemImage)
                .foregroundStyle(WorkbenchTheme.accent)
        }
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
            "Waiting for the next request."
        } else if runState == .queued {
            "Submitted to the computer queue."
        } else if runState == .running {
            "Codex is running tools or writing a reply."
        } else if runState == .cancelling {
            "Stop requested."
        } else if runState == .failed {
            "The last run failed. You can retry from the toolbar."
        } else if runState == .completed {
            "The last run completed."
        } else if runState == .cancelled {
            "The last run was cancelled."
        } else {
            runState.phase.capitalized
        }
    }
}
