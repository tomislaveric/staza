import SwiftUI
import UniformTypeIdentifiers

extension UTType {
    static let fitFile = UTType(filenameExtension: "fit") ?? .data
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
                    ProgressView()
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
        }
        .onChange(of: model?.state) { _, state in
            if case .imported(let item) = state { importedActivity = item }
        }
        .interactiveDismissDisabled(model?.isBusy ?? false)
    }

    private func form(_ model: AddActivityModel) -> some View {
        @Bindable var model = model
        return ScrollView {
            VStack(alignment: .leading, spacing: StazaSpacing.md) {
                StazaCard {
                    VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                        Text("addActivity.fit.title").font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                        Text(fileCaption()).font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                        Button { isPicking = true } label: { Label("addActivity.choose", systemImage: "doc.badge.plus") }
                            .buttonStyle(.bordered)
                            .disabled(model.isBusy)
                            .accessibilityIdentifier("chooseFitButton")
                    }
                }
                if hasFile(model.state) {
                    StazaCard {
                        Picker("addActivity.sport", selection: $model.sport) {
                            ForEach(ImportSport.allCases) { Text(LocalizedStringKey("addActivity.sport.\($0.rawValue)")).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .disabled(model.isBusy)
                    }
                    status(model.state)
                    if case .failed(let message) = model.state {
                        Text(message).font(StazaFont.caption).foregroundStyle(.red)
                    }
                    Button { Task { await model.upload() } } label: {
                        Text("addActivity.upload").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.isBusy)
                    .accessibilityIdentifier("uploadFitButton")
                } else if case .failed(let message) = model.state {
                    Text(message).font(StazaFont.caption).foregroundStyle(.red)
                }
            }
            .padding(StazaSpacing.md)
        }
        .background(StazaColor.canvas)
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
            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                ProgressView(value: progress)
                Text("addActivity.uploading").font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
            }
        case .processing:
            HStack(spacing: StazaSpacing.sm) {
                ProgressView()
                Text("addActivity.processing").font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
            }
        default: EmptyView()
        }
    }

    private func handle(_ result: Result<URL, Error>, model: AddActivityModel) async {
        switch result {
        case .failure(let error):
            model.selectionFailed(error)
        case .success(let url):
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            do {
                await model.select(fileName: url.lastPathComponent, data: try Data(contentsOf: url))
            } catch {
                model.selectionFailed(error)
            }
        }
    }
}
