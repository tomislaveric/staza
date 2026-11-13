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
                    ProgressView().frame(maxWidth: .infinity).padding(.top, StazaSpacing.xl)
                case .disabled:
                    card { Text("strava.disabled").font(StazaFont.body).foregroundStyle(StazaColor.textMuted) }
                case .disconnected(let message):
                    connectCard(message)
                case .connecting:
                    HStack(spacing: StazaSpacing.sm) {
                        ProgressView()
                        Text("strava.connecting").font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                    }
                case .connected(let activities):
                    activityList(activities)
                case .failed(let message):
                    card {
                        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                            Text(message).font(StazaFont.body).foregroundStyle(.red)
                            Button("action.retry") { Task { await model?.load() } }.buttonStyle(.bordered)
                        }
                    }
                }
            }
            .padding(StazaSpacing.md)
        }
        .background(StazaColor.canvas)
        .refreshable { await model?.loadActivities() }
    }

    private func card<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        StazaCard { content() }
    }

    private func connectCard(_ message: StravaImportModel.StravaMessage?) -> some View {
        card {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                Text("strava.connect.hint").font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                if let message {
                    Text(LocalizedStringKey(messageKey(message))).font(StazaFont.caption).foregroundStyle(.red)
                }
                Button { Task { await model?.connect() } } label: {
                    Label("strava.connect", systemImage: "link")
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("connectStravaButton")
            }
        }
    }

    private func messageKey(_ message: StravaImportModel.StravaMessage) -> String {
        switch message {
        case .denied: "strava.message.denied"
        case .missingScope: "strava.message.missingScope"
        case .error: "strava.message.error"
        }
    }

    @ViewBuilder
    private func activityList(_ activities: [StravaRecentActivity]) -> some View {
        if let error = model?.importError {
            Text(error).font(StazaFont.caption).foregroundStyle(.red)
        }
        if activities.isEmpty {
            card { Text("strava.empty").font(StazaFont.body).foregroundStyle(StazaColor.textMuted) }
        }
        ForEach(activities) { activity in row(activity) }
        Button("strava.disconnect", role: .destructive) { Task { await model?.disconnect() } }
            .disabled(model?.isBusy ?? false)
            .accessibilityIdentifier("disconnectStravaButton")
    }

    private func row(_ activity: StravaRecentActivity) -> some View {
        StazaCard {
            HStack(spacing: StazaSpacing.sm) {
                VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                    Text(activity.name).font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                    if let caption = caption(activity) {
                        Text(caption).font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                    }
                }
                Spacer()
                if model?.importingID == activity.id {
                    ProgressView()
                } else if activity.isImported {
                    Label("strava.imported", systemImage: "checkmark.circle.fill")
                        .font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                } else {
                    Button("strava.import") { Task { await model?.importActivity(activity) } }
                        .buttonStyle(.bordered)
                        .disabled(activity.beforeJourneyStart || (model?.isBusy ?? false))
                }
            }
        }
    }

    private func caption(_ activity: StravaRecentActivity) -> String? {
        var parts: [String] = []
        if let start = activity.startDate, let date = ISO8601DateFormatter().date(from: start) {
            parts.append(StazaFormat.date(date, locale: locale))
        }
        if let meters = activity.distanceMeters {
            parts.append(StazaFormat.distance(meters: meters, locale: locale))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
