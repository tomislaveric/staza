import SwiftUI

struct ActivitiesView: View {
    @Environment(\.locale) private var locale
    @Environment(AppContainer.self) private var container
    @State private var model: ActivitiesModel?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: StazaSpacing.md) {
                switch model?.state ?? .loading {
                case .loading:
                    ProgressView("activities.loading")
                        .frame(maxWidth: .infinity)
                        .padding(.top, StazaSpacing.xl)
                case .failed(let message):
                    errorCard(message)
                case .loaded(let content):
                    if content.activities.isEmpty {
                        StazaCard {
                            Text("activities.empty").font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                        }
                        .accessibilityIdentifier("activitiesEmpty")
                    } else {
                        summaryCard(content.summary)
                        ForEach(content.activities) { activity in row(activity) }
                    }
                }
            }
            .padding(StazaSpacing.md)
        }
        .background(StazaColor.canvas)
        .navigationDestination(for: ActivityHistoryItem.self) { ActivityDetailView(activity: $0) }
        .task {
            let model = self.model ?? ActivitiesModel(api: container.apiClient)
            self.model = model
            await model.load()
        }
        .refreshable { await model?.load() }
    }

    private func summaryCard(_ summary: ActivityHistorySummary) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                Text("activities.summary.count \(StazaFormat.number(Double(summary.count), locale: locale))")
                    .font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                Text("activities.summary.totals \(StazaFormat.distance(meters: summary.distanceMeters, locale: locale)) \(StazaFormat.number(summary.xp, locale: locale))")
                    .font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func row(_ activity: ActivityHistoryItem) -> some View {
        NavigationLink(value: activity) { rowCard(activity) }
            .buttonStyle(.plain)
    }

    private func rowCard(_ activity: ActivityHistoryItem) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                HStack(alignment: .firstTextBaseline) {
                    Text(activity.title).font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                    Spacer()
                    Text("activities.row.xp \(StazaFormat.number(activity.xpEarned, locale: locale))")
                        .font(StazaFont.caption.weight(.semibold))
                        .foregroundStyle(StazaColor.accent)
                }
                HStack {
                    if let date = activity.startedDate { Text(StazaFormat.date(date, locale: locale)) }
                    if let meters = activity.distanceMeters { Text(StazaFormat.distance(meters: meters, locale: locale)) }
                }
                .font(StazaFont.caption)
                .foregroundStyle(StazaColor.textMuted)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func errorCard(_ message: String) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                Text("activities.error.title").font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                Text(message).font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                Button("home.error.retry") { Task { await model?.load() } }
                    .buttonStyle(.bordered)
            }
        }
    }
}
