import SwiftUI

struct StravaImportView: View {
    @Environment(\.locale) private var locale
    @Environment(AppContainer.self) private var container
    @State private var model: StravaImportModel?

    var body: some View {
        Group {
            if let imported = model?.imported {
                ActivityDetailView(activity: imported)
            } else {
                content
            }
        }
        .navigationTitle("strava.title")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: model?.imported) { _, imported in
            if imported != nil { container.playerDataChanged() }
        }
        .task {
            if model == nil {
                let model = StravaImportModel(api: container.apiClient, authenticator: SystemStravaWebAuthenticator())
                self.model = model
                await model.load()
            }
        }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: StazaSpacing.md) {
                switch model?.state ?? .loading {
                case .loading:
                    StazaLoadingView(title: "strava.loading")
                case .disabled:
                    StazaStateView(systemImage: "bolt.horizontal.circle", title: Text("strava.disabled"))
                case .disconnected(let message):
                    connectCard(message)
                case .connecting:
                    StazaLoadingView(title: "strava.connecting")
                case .connected(let activities):
                    activityList(activities)
                case .failed(let message):
                    StazaErrorView(title: "strava.title", message: message, retryTitle: "action.retry") {
                        Task { await model?.load() }
                    }
                }
            }
            .padding(StazaSpacing.md)
        }
        .stazaScreen()
        .refreshable { await model?.loadActivities() }
    }

    private func connectCard(_ message: StravaImportModel.StravaMessage?) -> some View {
        StazaCard(padding: StazaSpacing.lg) {
            VStack(alignment: .leading, spacing: StazaSpacing.md) {
                IconBadge(systemImage: "figure.outdoor.cycle", size: 56)
                VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                    Text("strava.title").font(StazaFont.title).foregroundStyle(StazaColor.textPrimary)
                    Text("strava.connect.hint").font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                }
                if let message {
                    Label(messageKey(message), systemImage: "exclamationmark.triangle.fill")
                        .font(StazaFont.subheadline)
                        .foregroundStyle(StazaColor.danger)
                }
                Button { Task { await model?.connect() } } label: {
                    Label("strava.connect", systemImage: "link")
                }
                .buttonStyle(.stazaPrimaryWide)
                .accessibilityIdentifier("connectStravaButton")
            }
        }
    }

    private func messageKey(_ message: StravaImportModel.StravaMessage) -> LocalizedStringKey {
        switch message {
        case .denied: "strava.message.denied"
        case .missingScope: "strava.message.missingScope"
        case .error: "strava.message.error"
        }
    }

    @ViewBuilder
    private func activityList(_ activities: [StravaRecentActivity]) -> some View {
        if let error = model?.importError {
            StazaCard(tint: StazaColor.danger) {
                Label { Text(verbatim: error) } icon: { Image(systemName: "exclamationmark.triangle.fill") }
                    .font(StazaFont.subheadline)
                    .foregroundStyle(StazaColor.danger)
            }
        }
        if activities.isEmpty {
            StazaStateView(systemImage: "point.topleft.down.to.point.bottomright.curvepath", title: Text("strava.empty"))
        } else {
            SectionHeader("strava.title")
            ForEach(activities) { activity in row(activity) }
        }
        Button("strava.disconnect", role: .destructive) { Task { await model?.disconnect() } }
            .buttonStyle(.stazaDestructive)
            .disabled(model?.isBusy ?? false)
            .accessibilityIdentifier("disconnectStravaButton")
            .padding(.top, StazaSpacing.md)
    }

    private func row(_ activity: StravaRecentActivity) -> some View {
        StazaCard(tint: activity.isImported ? StazaColor.success : nil) {
            HStack(alignment: .center, spacing: StazaSpacing.md) {
                VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                    if let date = date(activity) {
                        OverlineText(verbatim: date)
                    }
                    Text(activity.name)
                        .font(StazaFont.headline)
                        .foregroundStyle(StazaColor.textPrimary)
                        .lineLimit(2)
                    let metrics = metrics(activity)
                    if !metrics.isEmpty { MetricLine(items: metrics) }
                }
                .accessibilityElement(children: .combine)
                Spacer(minLength: StazaSpacing.sm)
                if model?.importingID == activity.id {
                    ProgressView().tint(StazaColor.accent)
                } else if activity.isImported {
                    StazaChip("strava.imported", systemImage: "checkmark", tint: StazaColor.success)
                } else {
                    Button("strava.import") { Task { await model?.importActivity(activity) } }
                        .buttonStyle(.stazaSecondary)
                        .disabled(activity.beforeJourneyStart || (model?.isBusy ?? false))
                }
            }
        }
        .opacity(activity.beforeJourneyStart && !activity.isImported ? 0.6 : 1)
    }

    private func date(_ activity: StravaRecentActivity) -> String? {
        guard let start = activity.startDate, let date = ISO8601DateFormatter().date(from: start) else { return nil }
        return StazaFormat.date(date, locale: locale)
    }

    private func metrics(_ activity: StravaRecentActivity) -> [String] {
        var parts: [String] = []
        if let meters = activity.distanceMeters {
            parts.append(StazaFormat.distance(meters: meters, locale: locale))
        }
        if let seconds = activity.movingTimeSeconds, seconds > 0 {
            parts.append(Duration.seconds(seconds).formatted(.units(allowed: [.hours, .minutes], width: .abbreviated)))
        }
        return parts
    }
}
