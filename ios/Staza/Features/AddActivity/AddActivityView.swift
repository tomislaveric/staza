import SwiftUI
import UniformTypeIdentifiers

extension UTType {
    static let fitFile = UTType("world.staza.app.fit") ?? UTType(filenameExtension: "fit") ?? .data
}

struct AddActivityView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppContainer.self) private var container
    @State private var model: AddActivityModel?
    @State private var isPicking = false
    @State private var importedActivity: ActivityHistoryItem?

    var body: some View {
        NavigationStack {
            Group {
                if let importedActivity {
                    ActivityDetailView(activity: importedActivity)
                } else if let model {
                    form(model)
                } else {
                    ProgressView().tint(StazaColor.accent).frame(maxWidth: .infinity, maxHeight: .infinity).stazaScreen()
                }
            }
            .navigationTitle("action.addActivity")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("action.close") { dismiss() }
                }
            }
        }
        .task {
            if model == nil { model = AddActivityModel(api: container.apiClient) }
            await consumePendingImport()
        }
        .onChange(of: container.pendingImport) {
            Task { await consumePendingImport() }
        }
        // A file shared while an upload is running stays queued until the upload ends.
        .onChange(of: model?.isBusy) { _, busy in
            if busy == false { Task { await consumePendingImport() } }
        }
        .onChange(of: model?.state) { _, state in
            if case .imported(let item) = state {
                importedActivity = item
                container.playerDataChanged()
            }
        }
        .interactiveDismissDisabled(model?.isBusy ?? false)
        .presentationBackground(StazaColor.canvas)
    }

    private func consumePendingImport() async {
        guard let model, !model.isBusy, container.pendingImport != nil else { return }
        importedActivity = nil
        await model.importPending(from: container)
    }

    private func form(_ model: AddActivityModel) -> some View {
        @Bindable var model = model
        return ScrollView {
            VStack(alignment: .leading, spacing: StazaSpacing.md) {
                Button { isPicking = true } label: {
                    AddActivityOptionCard(
                        systemImage: model.hasFile ? "doc.fill" : "doc.badge.plus",
                        title: "addActivity.fit.title",
                        caption: fileCaption(),
                        isSelected: hasFile(model.state)
                    )
                }
                .buttonStyle(AddActivityCardButtonStyle())
                .disabled(model.isBusy)
                .accessibilityHint(Text("addActivity.choose"))
                .accessibilityIdentifier("chooseFitButton")

                NavigationLink { StravaImportView() } label: {
                    AddActivityOptionCard(
                        systemImage: "arrow.down.circle",
                        title: "addActivity.strava",
                        caption: "strava.connect.hint",
                        isSelected: false
                    )
                }
                .buttonStyle(AddActivityCardButtonStyle())
                .disabled(model.isBusy)
                .accessibilityIdentifier("stravaImportLink")

                if hasFile(model.state) {
                    SectionHeader("addActivity.sport")
                    Picker("addActivity.sport", selection: $model.sport) {
                        ForEach(ImportSport.allCases) { Text($0.titleKey).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .disabled(model.isBusy)
                    if model.sportDetectionFailed {
                        Label("addActivity.inspectFailed", systemImage: "info.circle")
                            .font(StazaFont.footnote)
                            .foregroundStyle(StazaColor.textMuted)
                            .accessibilityIdentifier("sportDetectionFailed")
                    }
                    status(model.state)
                }
                if case .failed(let message) = model.state {
                    StazaCard(tint: StazaColor.danger) {
                        HStack(alignment: .firstTextBaseline, spacing: StazaSpacing.sm) {
                            Image(systemName: "exclamationmark.triangle.fill").accessibilityHidden(true)
                            Text(verbatim: message).frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .font(StazaFont.subheadline)
                        .foregroundStyle(StazaColor.danger)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(.horizontal, StazaSpacing.md)
            .padding(.vertical, StazaSpacing.md)
            .animation(.snappy, value: hasFile(model.state))
        }
        .stazaScreen()
        .safeAreaInset(edge: .bottom) {
            if hasFile(model.state) {
                Button { Task { await model.upload() } } label: {
                    Label("addActivity.upload", systemImage: "arrow.up.circle.fill")
                }
                .buttonStyle(.stazaPrimaryWide)
                .disabled(model.isBusy)
                .accessibilityIdentifier("uploadFitButton")
                .padding(.horizontal, StazaSpacing.md)
                .padding(.top, StazaSpacing.sm)
                .padding(.bottom, StazaSpacing.sm)
                .background(StazaColor.canvas.opacity(0.94).ignoresSafeArea())
                .overlay(alignment: .top) { Rectangle().fill(StazaColor.border).frame(height: 1) }
            }
        }
        .fileImporter(isPresented: $isPicking, allowedContentTypes: [.fitFile]) { result in
            Task { await handle(result, model: model) }
        }
    }

    // A failed upload keeps the picked file so the user can retry.
    private func hasFile(_ state: AddActivityModel.State) -> Bool {
        if case .idle = state { return false }
        if case .failed = state { return model?.hasFile ?? false }
        return true
    }

    private func fileCaption() -> LocalizedStringKey {
        guard let name = model?.fileName, !name.isEmpty else { return "addActivity.hint" }
        return "addActivity.selected \(name)"
    }

    @ViewBuilder
    private func status(_ state: AddActivityModel.State) -> some View {
        switch state {
        case .uploading(let progress):
            StazaCard {
                VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                    HStack {
                        Text("addActivity.uploading").font(StazaFont.subheadline).foregroundStyle(StazaColor.textPrimary)
                        Spacer()
                        Text(progress, format: .percent.precision(.fractionLength(0)))
                            .font(StazaFont.metric)
                            .foregroundStyle(StazaColor.accent)
                    }
                    StazaProgressBar(value: progress)
                }
            }
            .accessibilityElement(children: .combine)
        case .processing:
            StazaCard {
                HStack(spacing: StazaSpacing.sm) {
                    ProgressView().tint(StazaColor.accent)
                    Text("addActivity.processing").font(StazaFont.subheadline).foregroundStyle(StazaColor.textPrimary)
                }
            }
            .accessibilityElement(children: .combine)
        default: EmptyView()
        }
    }

    private func handle(_ result: Result<URL, Error>, model: AddActivityModel) async {
        switch result {
        case .failure(let error):
            model.selectionFailed(error)
        case .success(let url):
            do {
                let staged = try FitFileStaging.stage(url)
                importedActivity = nil
                await model.select(fileName: url.lastPathComponent, fileURL: staged)
            } catch {
                model.selectionFailed(error)
            }
        }
    }
}
