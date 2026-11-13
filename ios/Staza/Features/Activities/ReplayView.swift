import SwiftUI

struct ReplayView: View {
    @Environment(\.locale) private var locale
    @Environment(AppContainer.self) private var container
    @State private var model: ReplayModel?
    let detail: ActivityDetail

    var body: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.md) {
            if let model {
                content(model)
            }
        }
        .task {
            guard model == nil, let timeline = ReplayTimeline(detail: detail) else { return }
            let created = ReplayModel(api: container.apiClient, timeline: timeline)
            model = created
            await created.loadBasemap()
        }
        .onDisappear { model?.pause() }
        .accessibilityIdentifier("activityDetailReplay")
    }

    @ViewBuilder
    private func content(_ model: ReplayModel) -> some View {
        let shape = RoundedRectangle(cornerRadius: StazaRadius.panel, style: .continuous)
        ZStack(alignment: .bottom) {
            if let basemap = model.basemap, let url = URL(string: basemap.styleUrl) {
                ReplayMapView(styleURL: url, timeline: model.timeline, currentMs: model.currentMs, revealed: model.revealed)
                    .accessibilityIdentifier("replayMap")
            } else {
                StazaColor.map.overlay {
                    if model.basemapFailed {
                        StazaStateView(systemImage: "map", title: Text("activityDetail.replay.mapUnavailable"))
                    } else {
                        StazaLoadingView(title: "activityDetail.loading")
                    }
                }
            }
            controls(model)
                .padding(StazaSpacing.sm)
        }
        .frame(height: 360)
        .clipShape(shape)
        .overlay(shape.strokeBorder(StazaColor.border, lineWidth: 1))

        let revealed = model.revealed
        if !revealed.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(revealed.reversed().enumerated()), id: \.element.id) { index, item in
                    revealRow(item, startMs: model.timeline.startMs, isLast: index == revealed.count - 1)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(.snappy, value: revealed.count)
            .accessibilityIdentifier("replayRevealed")
        }
    }

    private func controls(_ model: ReplayModel) -> some View {
        HStack(spacing: StazaSpacing.md) {
            Button {
                model.toggle()
            } label: {
                Image(systemName: model.isPlaying ? "pause.fill" : (model.isFinished ? "arrow.counterclockwise" : "play.fill"))
                    .font(.title3.weight(.bold))
                    .foregroundStyle(StazaColor.onAccent)
                    .frame(width: 44, height: 44)
                    .background(StazaColor.accent, in: Circle())
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(model.isPlaying ? Text("activityDetail.replay.pause") : Text("activityDetail.replay.play"))
            .accessibilityIdentifier("replayPlayPause")
            Slider(value: Binding(get: { model.progress }, set: { model.scrub(to: $0) }), in: 0...1)
                .tint(StazaColor.accent)
                .accessibilityLabel(Text("activityDetail.replay.scrubber"))
                .accessibilityIdentifier("replayScrubber")
            Text(verbatim: ActivityStyle.duration(seconds: (model.currentMs - model.timeline.startMs) / 1000, locale: locale))
                .font(StazaFont.metricSmall)
                .foregroundStyle(StazaColor.textPrimary)
                .frame(minWidth: 44, alignment: .trailing)
                .accessibilityHidden(true)
        }
        .padding(.leading, StazaSpacing.xs + StazaSpacing.xxs)
        .padding(.trailing, StazaSpacing.md)
        .padding(.vertical, StazaSpacing.xs + StazaSpacing.xxs)
        .stazaGlass(cornerRadius: StazaRadius.panel + StazaSpacing.xs)
    }

    private func revealRow(_ item: ReplayReveal, startMs: Double, isLast: Bool) -> some View {
        let value = detail.events.first { $0.id == item.id }?.value
        let tint = item.kind == .flowline ? StazaColor.accent : ActivityStyle.tint(xp: value ?? 0, isRepeat: item.isRepeat)
        let icon = item.kind == .flowline
            ? ActivityStyle.flowlineIcon
            : ActivityStyle.icon(collectibleType: detail.events.first { $0.id == item.id }?.collectible.type ?? "")
        return HStack(alignment: .top, spacing: StazaSpacing.md) {
            VStack(spacing: 0) {
                IconBadge(systemImage: icon, tint: tint, size: 36)
                if !isLast {
                    Rectangle().fill(StazaColor.border).frame(width: 1).frame(maxHeight: .infinity)
                }
            }
            VStack(alignment: .leading, spacing: StazaSpacing.xxs) {
                Text(item.name)
                    .font(StazaFont.headline)
                    .foregroundStyle(StazaColor.textPrimary)
                    .lineLimit(2)
                HStack(spacing: StazaSpacing.sm) {
                    Text(verbatim: ActivityStyle.duration(seconds: max(0, item.timestampMs - startMs) / 1000, locale: locale))
                        .font(StazaFont.metricSmall)
                        .foregroundStyle(StazaColor.textSubtle)
                    if item.isRepeat {
                        StazaChip("activityDetail.collected.revisit", systemImage: "arrow.counterclockwise")
                    }
                }
            }
            .padding(.top, StazaSpacing.xs)
            .padding(.bottom, isLast ? 0 : StazaSpacing.md)
            Spacer(minLength: StazaSpacing.sm)
            if let value, !item.isRepeat {
                XPValue(xp: value, font: StazaFont.metric.weight(.semibold))
                    .padding(.top, StazaSpacing.sm)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
