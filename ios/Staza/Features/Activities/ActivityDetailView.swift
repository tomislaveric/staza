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
                    ProgressView("activityDetail.loading")
                        .frame(maxWidth: .infinity)
                        .padding(.top, StazaSpacing.xl)
                case .failed(let message):
                    errorCard(message)
                case .loaded(let detail):
                    header(title: detail.title, date: detail.startedDate, meters: detail.distanceMeters,
                           seconds: detail.durationSeconds, xp: detail.xpEarned)
                    if let model {
                        sections(detail, model: model)
                    }
                }
            }
            .padding(StazaSpacing.md)
        }
        .background(StazaColor.canvas)
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
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                HStack(alignment: .firstTextBaseline) {
                    Text(title).font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                    Spacer()
                    Text("activities.row.xp \(StazaFormat.number(xp, locale: locale))")
                        .font(StazaFont.caption.weight(.semibold))
                        .foregroundStyle(StazaColor.accent)
                }
                HStack {
                    if let date { Text(StazaFormat.date(date, locale: locale)) }
                    if let meters { Text(StazaFormat.distance(meters: meters, locale: locale)) }
                }
                .font(StazaFont.caption)
                .foregroundStyle(StazaColor.textMuted)
            }
        }
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
        .accessibilityIdentifier("activityDetailSections")

        switch model.section {
        case .replay:
            StazaCard {
                Text("activityDetail.replay.placeholder").font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
            }
            .accessibilityIdentifier("activityDetailReplay")
        case .collected:
            if detail.events.isEmpty {
                emptyCard("activityDetail.collected.empty", id: "activityDetailCollectedEmpty")
            } else {
                ForEach(detail.events) { event in collectedRow(event) }
            }
        case .nearMisses:
            if detail.nearMisses.isEmpty {
                emptyCard("activityDetail.nearMisses.empty", id: "activityDetailNearMissesEmpty")
            } else {
                ForEach(detail.nearMisses) { miss in nearMissRow(miss) }
            }
        }
    }

    private func collectedRow(_ event: ActivityDetailEvent) -> some View {
        StazaCard {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                    Text(event.collectible.name).font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                    if event.isRepeat {
                        Text("activityDetail.collected.revisit").font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                    }
                }
                Spacer()
                if !event.isRepeat {
                    Text("activities.row.xp \(StazaFormat.number(event.value, locale: locale))")
                        .font(StazaFont.caption.weight(.semibold))
                        .foregroundStyle(StazaColor.accent)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func nearMissRow(_ miss: ActivityNearMiss) -> some View {
        StazaCard {
            HStack(alignment: .firstTextBaseline) {
                Text(miss.name).font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                Spacer()
                Text(StazaFormat.distance(meters: miss.minimumDistanceMeters, locale: locale))
                    .font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func emptyCard(_ key: LocalizedStringKey, id: String) -> some View {
        StazaCard {
            Text(key).font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
        }
        .accessibilityIdentifier(id)
    }

    private func errorCard(_ message: String) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                Text("activityDetail.error.title").font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                Text(message).font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                Button("home.error.retry") { Task { await model?.load() } }
                    .buttonStyle(.bordered)
            }
        }
    }
}
