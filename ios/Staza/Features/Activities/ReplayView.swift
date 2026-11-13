import SwiftUI

struct ReplayView: View {
    @Environment(AppContainer.self) private var container
    @State private var model: ReplayModel?
    let detail: ActivityDetail

    var body: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
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
        @Bindable var model = model
        if let basemap = model.basemap, let url = URL(string: basemap.styleUrl) {
            ReplayMapView(styleURL: url, timeline: model.timeline, currentMs: model.currentMs, revealed: model.revealed)
                .frame(height: 320)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .accessibilityIdentifier("replayMap")
        } else {
            StazaCard {
                Text(model.basemapFailed ? "activityDetail.replay.mapUnavailable" : "activityDetail.loading")
                    .font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
            }
        }
        HStack(spacing: StazaSpacing.sm) {
            Button {
                model.toggle()
            } label: {
                Image(systemName: model.isPlaying ? "pause.fill" : (model.isFinished ? "arrow.counterclockwise" : "play.fill"))
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.borderedProminent)
            .accessibilityLabel(model.isPlaying ? Text("activityDetail.replay.pause") : Text("activityDetail.replay.play"))
            .accessibilityIdentifier("replayPlayPause")
            Slider(value: Binding(get: { model.progress }, set: { model.scrub(to: $0) }), in: 0...1)
                .accessibilityLabel(Text("activityDetail.replay.scrubber"))
                .accessibilityIdentifier("replayScrubber")
        }
        let revealed = model.revealed
        if !revealed.isEmpty {
            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                ForEach(revealed.reversed()) { item in
                    HStack {
                        Image(systemName: item.kind == .flowline ? "point.topleft.down.curvedto.point.bottomright.up" : "star.fill")
                            .foregroundStyle(StazaColor.accent)
                        Text(item.name).font(StazaFont.body).foregroundStyle(StazaColor.textPrimary)
                        Spacer()
                        if item.isRepeat {
                            Text("activityDetail.collected.revisit").font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                        }
                    }
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(.default, value: revealed.count)
            .accessibilityIdentifier("replayRevealed")
        }
    }
}
