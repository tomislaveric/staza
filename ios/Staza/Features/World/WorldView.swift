import SwiftUI

struct WorldView: View {
    @Environment(AppContainer.self) private var container
    @State private var model: WorldModel?
    @State private var explore: ExploreModel?
    @State private var userLocation: GeoPoint?

    var body: some View {
        Group {
            if let model, let explore { content(model, explore) } else { Color.clear }
        }
        .task {
            guard model == nil else { return }
            let created = WorldModel(api: container.apiClient)
            model = created
            let exploration = ExploreModel(api: container.apiClient)
            explore = exploration
            async let basemap: Void = created.loadBasemap()
            async let quests: Void = created.loadQuestTargets()
            _ = await (basemap, quests)
            await exploration.loadPlannedRoute(instanceIds: created.activeInstanceIds)
        }
        .accessibilityIdentifier("worldScreen")
    }

    @ViewBuilder
    private func content(_ model: WorldModel, _ explore: ExploreModel) -> some View {
        if let basemap = model.basemap, let url = URL(string: basemap.styleUrl) {
            WorldMapView(
                styleURL: url,
                collectibles: model.collectibles,
                flowlines: model.flowlines,
                questTargets: model.questTargets,
                route: explore.displayedRoute,
                onViewportChange: { model.viewportChanged($0) },
                onSelect: { model.select($0, id: $1) },
                onUserLocation: { userLocation = $0 }
            )
            .ignoresSafeArea(edges: .top)
            .overlay(alignment: .bottom) {
                if explore.isActive {
                    ExplorePanel(model: explore)
                } else if !model.viewportFailed, let bounds = model.bounds {
                    Button {
                        explore.begin(bounds: bounds, userLocation: userLocation)
                    } label: {
                        Label("explore.start.button", systemImage: "location.north.line")
                    }
                    .buttonStyle(.borderedProminent)
                    .padding(StazaSpacing.md)
                    .accessibilityIdentifier("exploreThisArea")
                } else if model.viewportFailed {
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
