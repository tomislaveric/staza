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
        .stazaScreen()
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
                Section {
                    Label { Text(verbatim: error) } icon: { Image(systemName: "exclamationmark.triangle.fill") }
                        .font(StazaFont.subheadline)
                        .foregroundStyle(StazaColor.danger)
                }
                .listRowBackground(StazaColor.danger.opacity(0.12))
            }
        }
        .listRowSeparatorTint(StazaColor.border)
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
            Group {
                if let profile = model.profile {
                    VStack(alignment: .leading, spacing: StazaSpacing.md) {
                        headerCard(profile)
                        statsCard(profile)
                        if let capabilities = model.capabilities, !(capabilities.titles + capabilities.badges).isEmpty {
                            StazaCard {
                                MoreFlowLayout {
                                    ForEach(capabilities.titles) { entry in
                                        StazaChip(verbatim: entry.label, systemImage: "crown.fill", tint: StazaColor.accent)
                                    }
                                    ForEach(capabilities.badges) { entry in
                                        StazaChip(verbatim: entry.label, systemImage: "rosette", tint: StazaColor.rarityEpic)
                                    }
                                }
                            }
                        }
                    }
                } else if model.isLoading {
                    StazaLoadingView(title: "more.profile.loading")
                } else if model.failed {
                    StazaStateView(systemImage: "exclamationmark.triangle.fill", tint: StazaColor.danger, title: Text("profile.error")) {
                        Button("quests.retry") { Task { await model.load() } }.buttonStyle(.stazaSecondary)
                    }
                }
            }
            .listRowInsets(EdgeInsets(top: StazaSpacing.sm, leading: 0, bottom: StazaSpacing.sm, trailing: 0))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        } header: { OverlineText("profile.header") }
    }

    private func headerCard(_ profile: PlayerProfile) -> some View {
        StazaCard {
            HStack(spacing: StazaSpacing.md) {
                MoreAvatar(name: profile.displayName, size: 64)
                VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                    Text(verbatim: profile.displayName)
                        .font(StazaFont.title)
                        .foregroundStyle(StazaColor.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    if let email = authState.user?.email {
                        Text(verbatim: email)
                            .font(StazaFont.subheadline)
                            .foregroundStyle(StazaColor.textMuted)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    StazaChip(
                        verbatim: "\(String(localized: "profile.level")) \(StazaFormat.number(Double(profile.progress.level), locale: locale))",
                        systemImage: "star.fill",
                        tint: StazaColor.accent
                    )
                    .padding(.top, StazaSpacing.xxs)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func statsCard(_ profile: PlayerProfile) -> some View {
        StazaCard {
            Grid(alignment: .leading, horizontalSpacing: StazaSpacing.md, verticalSpacing: StazaSpacing.md) {
                GridRow {
                    StatTile(label: "profile.xp", value: StazaFormat.number(Double(profile.progress.totalXp), locale: locale), tint: StazaColor.accent)
                    StatTile(label: "profile.distance", value: StazaFormat.distance(meters: profile.distanceMeters, locale: locale))
                }
                GridRow {
                    StatTile(label: "profile.activities", value: StazaFormat.number(Double(profile.activityCount), locale: locale))
                    StatTile(label: "profile.flowlines", value: StazaFormat.number(Double(profile.flowlineCount), locale: locale))
                }
                if let stats = profile.collectibles {
                    GridRow {
                        StatTile(
                            label: "profile.collectibles",
                            value: "\(StazaFormat.number(Double(stats.discoveredCount), locale: locale))/\(StazaFormat.number(Double(stats.totalCollectibles), locale: locale))",
                            tint: StazaColor.rarityRare
                        )
                        .gridCellColumns(2)
                    }
                }
            }
        }
    }

    private func passkeySection(_ model: ProfileModel) -> some View {
        Section {
            ForEach(model.passkeys) { passkey in
                HStack(spacing: StazaSpacing.md) {
                    IconBadge(systemImage: "person.badge.key.fill", size: 32)
                    VStack(alignment: .leading, spacing: StazaSpacing.xxs) {
                        Text(passkey.name).font(StazaFont.body).foregroundStyle(StazaColor.textPrimary)
                        if let date = Self.parse(passkey.lastUsedAt ?? passkey.createdAt) {
                            Text(StazaFormat.date(date, locale: locale)).font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                        }
                    }
                }
                .swipeActions {
                    Button("profile.passkeys.delete", role: .destructive) { Task { await model.deletePasskey(passkey) } }
                }
            }
            if model.passkeys.isEmpty {
                Text("profile.passkeys.empty").font(StazaFont.subheadline).foregroundStyle(StazaColor.textMuted)
            }
            Button { Task { await model.addPasskey() } } label: {
                MoreIconRow(title: "profile.passkeys.add", systemImage: "plus", titleColor: StazaColor.accent)
            }
        } header: { OverlineText("profile.passkeys.header") }
        .listRowBackground(StazaColor.surface)
    }

    private func dataSection(_ model: ProfileModel) -> some View {
        Section {
            Button { stepUpAction = .export } label: {
                MoreIconRow(title: "profile.export", systemImage: "square.and.arrow.up", tint: StazaColor.rarityRare)
            }
            .accessibilityIdentifier("exportDataButton")
            Button(role: .destructive) { stepUpAction = .delete } label: {
                MoreIconRow(title: "profile.delete", systemImage: "trash", tint: StazaColor.danger, titleColor: StazaColor.danger)
            }
            .accessibilityIdentifier("deleteAccountButton")
        } header: { OverlineText("profile.data.header") } footer: {
            Text("profile.data.footer").font(StazaFont.footnote).foregroundStyle(StazaColor.textSubtle)
        }
        .listRowBackground(StazaColor.surface)
    }

    private func sessionSection(_ model: ProfileModel) -> some View {
        Section {
            Button { Task { await model.logout(everywhere: false) } } label: {
                MoreIconRow(title: "profile.logout", systemImage: "rectangle.portrait.and.arrow.right", tint: StazaColor.textMuted)
            }
            .accessibilityIdentifier("logoutButton")
            Button(role: .destructive) { confirmingLogoutAll = true } label: {
                MoreIconRow(title: "profile.logoutAll", systemImage: "iphone.slash", tint: StazaColor.danger, titleColor: StazaColor.danger)
            }
        }
        .listRowBackground(StazaColor.surface)
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
                IconBadge(systemImage: "doc.zipper", tint: StazaColor.success, size: 64)
                Text("profile.export.ready")
                    .font(StazaFont.title3)
                    .foregroundStyle(StazaColor.textPrimary)
                    .multilineTextAlignment(.center)
                ShareLink(item: url) { Label("profile.export.share", systemImage: "square.and.arrow.up") }
                    .buttonStyle(.stazaPrimaryWide)
                    .padding(.top, StazaSpacing.sm)
            }
            .padding(StazaSpacing.lg)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .stazaScreen()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("action.close") { dismiss() } } }
        }
        .presentationDetents([.medium])
        .presentationBackground(StazaColor.canvas)
    }
}
