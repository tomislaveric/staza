import SwiftUI

struct WorldView: View {
    @Environment(AppContainer.self) private var container
    @State private var model: WorldModel?

    var body: some View {
        Group {
            if let model { content(model) } else { Color.clear }
        }
        .task {
            guard model == nil else { return }
            let created = WorldModel(api: container.apiClient)
            model = created
            async let basemap: Void = created.loadBasemap()
            async let quests: Void = created.loadQuestTargets()
            _ = await (basemap, quests)
        }
        .accessibilityIdentifier("worldScreen")
    }

    @ViewBuilder
    private func content(_ model: WorldModel) -> some View {
        if let basemap = model.basemap, let url = URL(string: basemap.styleUrl) {
            WorldMapView(
                styleURL: url,
                collectibles: model.collectibles,
                flowlines: model.flowlines,
                questTargets: model.questTargets,
                onViewportChange: { model.viewportChanged($0) },
                onSelect: { model.select($0, id: $1) }
            )
            .ignoresSafeArea(edges: .top)
            .overlay(alignment: .bottom) {
                if model.viewportFailed {
                    Text("world.viewportFailed")
                        .font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                        .padding(StazaSpacing.sm)
                        .background(.regularMaterial, in: Capsule())
                        .padding(StazaSpacing.md)
                }
            }
            .sheet(item: Binding(get: { model.selection }, set: { model.selection = $0 })) { selection in
                WorldDetailSheet(selection: selection, isQuestTarget: model.isQuestTarget(selection))
                    .presentationDetents([.height(260), .medium])
                    .presentationDragIndicator(.visible)
            }
            .accessibilityIdentifier("worldMap")
        } else {
            StazaCard {
                Text(model.basemapFailed ? "world.mapUnavailable" : "world.loading")
                    .font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
            }
            .padding(StazaSpacing.md)
        }
    }
}
