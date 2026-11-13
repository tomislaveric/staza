import SwiftUI

struct ProfileView: View {
    @Environment(AppContainer.self) private var container
    @Environment(AuthState.self) private var authState
    @Environment(\.locale) private var locale
    @State private var model: ProfileModel?
    @State private var stepUpAction: ProfileModel.SensitiveAction?
    @State private var confirmingDelete = false
    @State private var confirmingLogoutAll = false
    @State private var showingExport = false

    var body: some View {
        Group {
            if let model { content(model) } else { Color.clear }
        }
        .navigationTitle("profile.title")
        .navigationBarTitleDisplayMode(.inline)
        .background(StazaColor.canvas)
        .task {
            if model == nil { model = ProfileModel(api: container.apiClient, auth: container.authService) }
            await model?.load()
        }
        .accessibilityIdentifier("profileScreen")
    }

    @ViewBuilder
    private func content(_ model: ProfileModel) -> some View {
        List {
            summarySection(model)
            passkeySection(model)
            dataSection(model)
            sessionSection(model)
            if let error = model.actionError {
                Section { Text(error).foregroundStyle(.red).font(StazaFont.caption) }
            }
        }
        .scrollContentBackground(.hidden)
        .disabled(model.isBusy)
        .sheet(item: $stepUpAction) { action in
            StepUpSheet {
                switch action {
                case .export:
                    await model.exportData()
                    showingExport = model.exportURL != nil
                case .delete:
                    // Let the step-up sheet finish dismissing before presenting the dialog.
                    try? await Task.sleep(for: .milliseconds(500))
                    confirmingDelete = true
                }
            }
        }
        .sheet(isPresented: $showingExport, onDismiss: { model.clearExport() }) {
            if let url = model.exportURL { ExportShareSheet(url: url) }
        }
        .confirmationDialog("profile.delete.confirmTitle", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("profile.delete.confirm", role: .destructive) { Task { await model.deleteAccount() } }
        } message: { Text("profile.delete.confirmBody") }
        .confirmationDialog("profile.logoutAll.confirmTitle", isPresented: $confirmingLogoutAll, titleVisibility: .visible) {
            Button("profile.logoutAll", role: .destructive) { Task { await model.logout(everywhere: true) } }
        }
    }

    @ViewBuilder
    private func summarySection(_ model: ProfileModel) -> some View {
        Section {
            if let profile = model.profile {
                VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                    Text(profile.displayName).font(StazaFont.title)
                    if let email = authState.user?.email {
                        Text(email).font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                    }
                }
                row("profile.level", StazaFormat.number(Double(profile.progress.level), locale: locale))
                row("profile.xp", StazaFormat.number(Double(profile.progress.totalXp), locale: locale))
                row("profile.distance", StazaFormat.distance(meters: profile.distanceMeters, locale: locale))
                row("profile.activities", StazaFormat.number(Double(profile.activityCount), locale: locale))
                row("profile.flowlines", StazaFormat.number(Double(profile.flowlineCount), locale: locale))
                if let stats = profile.collectibles {
                    row("profile.collectibles", "\(stats.discoveredCount)/\(stats.totalCollectibles)")
                }
                if let capabilities = model.capabilities {
                    ForEach(capabilities.titles + capabilities.badges) { entry in
                        Label(entry.label, systemImage: "rosette")
                    }
                }
            } else if model.isLoading {
                SwiftUI.ProgressView()
            } else if model.failed {
                Text("profile.error").foregroundStyle(StazaColor.textMuted)
                Button("quests.retry") { Task { await model.load() } }
            }
        } header: { Text("profile.header") }
    }

    private func passkeySection(_ model: ProfileModel) -> some View {
        Section {
            ForEach(model.passkeys) { passkey in
                VStack(alignment: .leading, spacing: 2) {
                    Text(passkey.name)
                    if let date = Self.parse(passkey.lastUsedAt ?? passkey.createdAt) {
                        Text(StazaFormat.date(date, locale: locale)).font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                    }
                }
                .swipeActions {
                    Button("profile.passkeys.delete", role: .destructive) { Task { await model.deletePasskey(passkey) } }
                }
            }
            if model.passkeys.isEmpty { Text("profile.passkeys.empty").foregroundStyle(StazaColor.textMuted) }
            Button("profile.passkeys.add") { Task { await model.addPasskey() } }
        } header: { Text("profile.passkeys.header") }
    }

    private func dataSection(_ model: ProfileModel) -> some View {
        Section {
            Button("profile.export") { stepUpAction = .export }
                .accessibilityIdentifier("exportDataButton")
            Button("profile.delete", role: .destructive) { stepUpAction = .delete }
                .accessibilityIdentifier("deleteAccountButton")
        } header: { Text("profile.data.header") } footer: { Text("profile.data.footer") }
    }

    private func sessionSection(_ model: ProfileModel) -> some View {
        Section {
            Button("profile.logout") { Task { await model.logout(everywhere: false) } }
                .accessibilityIdentifier("logoutButton")
            Button("profile.logoutAll", role: .destructive) { confirmingLogoutAll = true }
        }
    }

    private func row(_ title: LocalizedStringKey, _ value: String) -> some View {
        LabeledContent(title, value: value)
    }

    private static func parse(_ string: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: string) ?? ISO8601DateFormatter().date(from: string)
    }
}

private struct ExportShareSheet: View {
    let url: URL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: StazaSpacing.md) {
                Text("profile.export.ready").font(StazaFont.body).multilineTextAlignment(.center)
                ShareLink(item: url) { Label("profile.export.share", systemImage: "square.and.arrow.up") }
                    .buttonStyle(.borderedProminent)
            }
            .padding(StazaSpacing.md)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("action.close") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
}
