import SwiftUI

struct ActivityDetailView: View {
    @Environment(\.locale) private var locale
    @Environment(AppContainer.self) private var container
    @State private var model: ActivityDetailModel?
    let activity: ActivityHistoryItem

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: StazaSpacing.md) {
                switch model?.state ?? .loading {
                case .loading:
                    header(title: activity.title, date: activity.startedDate, meters: activity.distanceMeters,
                           seconds: activity.durationSeconds, xp: activity.xpEarned)
                    StazaLoadingView(title: "activityDetail.loading")
                case .failed(let message):
                    StazaErrorView(title: "activityDetail.error.title", message: message) {
                        Task { await model?.load() }
                    }
                case .loaded(let detail):
                    header(title: detail.title, date: detail.startedDate, meters: detail.distanceMeters,
                           seconds: detail.durationSeconds, xp: detail.xpEarned)
                    if let model {
                        sections(detail, model: model)
                    }
                }
            }
            .padding(.horizontal, StazaSpacing.md)
            .padding(.vertical, StazaSpacing.sm)
        }
        .stazaScreen()
        .navigationTitle(activity.title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            let model = self.model ?? ActivityDetailModel(api: container.apiClient, activityId: activity.id)
            self.model = model
            await model.load()
        }
        .refreshable { await model?.load() }
    }

    private func header(title: String, date: Date?, meters: Double?, seconds: Double?, xp: Double) -> some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            if let date {
                OverlineText(verbatim: ActivityStyle.overlineDate(date, locale: locale))
            }
            Text(title)
                .font(StazaFont.title)
                .foregroundStyle(StazaColor.textPrimary)
            HStack(alignment: .lastTextBaseline, spacing: StazaSpacing.md) {
                ActivityDistanceLine(meters: meters, seconds: seconds)
                Spacer(minLength: StazaSpacing.sm)
                VStack(alignment: .trailing, spacing: StazaSpacing.xxs) {
                    OverlineText("activityDetail.xpEarned")
                    XPValue(xp: xp, font: StazaFont.metricLarge)
                }
            }
        }
        .padding(.vertical, StazaSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("activityDetailHeader")
    }

    @ViewBuilder
    private func sections(_ detail: ActivityDetail, model: ActivityDetailModel) -> some View {
        @Bindable var model = model
        Picker("activityDetail.sections", selection: $model.section) {
            Text("activityDetail.tab.replay").tag(ActivityDetailSection.replay)
            Text("activityDetail.tab.collected").tag(ActivityDetailSection.collected)
            Text("activityDetail.tab.nearMisses").tag(ActivityDetailSection.nearMisses)
        }
        .pickerStyle(.segmented)
        .controlSize(.large)
        .accessibilityIdentifier("activityDetailSections")

        switch model.section {
        case .replay:
            if ReplayTimeline(detail: detail) != nil {
                ReplayView(detail: detail)
            } else {
                emptyState("activityDetail.replay.unavailable", systemImage: "map", id: "activityDetailReplay")
            }
        case .collected:
            if detail.events.isEmpty {
                emptyState("activityDetail.collected.empty", systemImage: "sparkles", id: "activityDetailCollectedEmpty")
            } else {
                VStack(spacing: StazaSpacing.sm) {
                    ForEach(detail.events) { event in collectedRow(event) }
                }
            }
        case .nearMisses:
            if detail.nearMisses.isEmpty {
                emptyState("activityDetail.nearMisses.empty", systemImage: "scope", id: "activityDetailNearMissesEmpty")
            } else {
                VStack(spacing: StazaSpacing.sm) {
                    ForEach(detail.nearMisses) { miss in nearMissRow(miss) }
                }
            }
        }
    }

    private func collectedRow(_ event: ActivityDetailEvent) -> some View {
        let tint = ActivityStyle.tint(xp: event.value, isRepeat: event.isRepeat)
        return StazaCard(padding: StazaSpacing.sm + StazaSpacing.xs) {
            HStack(spacing: StazaSpacing.md) {
                IconBadge(systemImage: ActivityStyle.icon(collectibleType: event.collectible.type), tint: tint, size: 40)
                VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                    Text(event.collectible.name)
                        .font(StazaFont.headline)
                        .foregroundStyle(StazaColor.textPrimary)
                        .lineLimit(2)
                    if event.isRepeat {
                        StazaChip("activityDetail.collected.revisit", systemImage: "arrow.counterclockwise")
                    }
                }
                Spacer(minLength: StazaSpacing.sm)
                if !event.isRepeat {
                    XPValue(xp: event.value, font: StazaFont.metric.weight(.semibold))
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func nearMissRow(_ miss: ActivityNearMiss) -> some View {
        StazaCard(padding: StazaSpacing.sm + StazaSpacing.xs) {
            HStack(spacing: StazaSpacing.md) {
                IconBadge(systemImage: "scope", tint: StazaColor.markerRing, size: 40)
                VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                    Text(miss.name)
                        .font(StazaFont.headline)
                        .foregroundStyle(StazaColor.textPrimary)
                        .lineLimit(2)
                    Text("activities.row.xp \(StazaFormat.number(miss.value, locale: locale))")
                        .font(StazaFont.metricSmall)
                        .foregroundStyle(StazaColor.textSubtle)
                }
                Spacer(minLength: StazaSpacing.sm)
                Text(verbatim: StazaFormat.distance(meters: miss.minimumDistanceMeters, locale: locale))
                    .font(StazaFont.title3.monospacedDigit())
                    .foregroundStyle(StazaColor.textPrimary)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func emptyState(_ key: LocalizedStringKey, systemImage: String, id: String) -> some View {
        StazaCard {
            StazaStateView(systemImage: systemImage, title: Text(key))
        }
        .accessibilityIdentifier(id)
    }
}
