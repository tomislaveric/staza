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
                    StazaLoadingView(title: "activities.loading")
                case .failed(let message):
                    StazaErrorView(title: "activities.error.title", message: message) {
                        Task { await model?.load() }
                    }
                case .loaded(let content):
                    if content.activities.isEmpty {
                        StazaStateView(systemImage: "figure.outdoor.cycle", tint: StazaColor.accent, title: Text("activities.empty"))
                            .accessibilityIdentifier("activitiesEmpty")
                    } else {
                        summaryRow(content.summary)
                        ForEach(content.activities) { activity in row(activity) }
                    }
                }
            }
            .padding(.horizontal, StazaSpacing.md)
            .padding(.vertical, StazaSpacing.sm)
        }
        .stazaScreen()
        .navigationDestination(for: ActivityHistoryItem.self) { ActivityDetailView(activity: $0) }
        .task(id: container.dataRevision) {
            let model = self.model ?? ActivitiesModel(api: container.apiClient)
            self.model = model
            await model.load()
        }
        .refreshable { await model?.load() }
    }

    private func summaryRow(_ summary: ActivityHistorySummary) -> some View {
        StazaCard {
            HStack(alignment: .top, spacing: StazaSpacing.md) {
                StatTile(label: "profile.activities", value: StazaFormat.number(Double(summary.count), locale: locale))
                StatTile(label: "profile.distance", value: StazaFormat.distance(meters: summary.distanceMeters, locale: locale))
                StatTile(label: "profile.xp", value: StazaFormat.number(summary.xp, locale: locale), tint: StazaColor.accent)
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
            HStack(alignment: .center, spacing: StazaSpacing.md) {
                VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                    if let date = activity.startedDate {
                        OverlineText(verbatim: ActivityStyle.overlineDate(date, locale: locale))
                    }
                    Text(activity.title)
                        .font(StazaFont.headline)
                        .foregroundStyle(StazaColor.textPrimary)
                        .lineLimit(2)
                    ActivityDistanceLine(meters: activity.distanceMeters, seconds: activity.durationSeconds)
                }
                Spacer(minLength: StazaSpacing.sm)
                XPValue(xp: activity.xpEarned)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(StazaColor.textSubtle)
                    .accessibilityHidden(true)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: StazaRadius.card, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    NavigationStack {
        ActivitiesView().navigationTitle("progress.allActivities")
    }
    .environment(AppContainer())
    .preferredColorScheme(.dark)
}
