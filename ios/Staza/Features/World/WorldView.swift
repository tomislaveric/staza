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
                Group {
                    if explore.isActive {
                        ExplorePanel(model: explore)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    } else if !model.viewportFailed, let bounds = model.bounds {
                        Button {
                            explore.begin(bounds: bounds, userLocation: userLocation)
                        } label: {
                            Label("explore.start.button", systemImage: "location.north.line.fill")
                        }
                        .buttonStyle(.stazaPrimary)
                        .shadow(color: StazaColor.canvas.opacity(0.5), radius: 12, y: 4)
                        .padding(StazaSpacing.md)
                        .accessibilityIdentifier("exploreThisArea")
                        .transition(.scale(scale: 0.9).combined(with: .opacity))
                    } else if model.viewportFailed {
                        mapNotice("world.viewportFailed", systemImage: "exclamationmark.triangle.fill", tint: StazaColor.danger)
                            .padding(StazaSpacing.md)
                    }
                }
                .animation(.snappy, value: explore.isActive)
            }
            .sheet(item: Binding(get: { model.selection }, set: { model.selection = $0 })) { selection in
                WorldDetailSheet(selection: selection, isQuestTarget: model.isQuestTarget(selection))
                    .presentationDetents([.height(260), .medium])
                    .presentationDragIndicator(.visible)
                    .presentationBackground(StazaColor.canvas)
            }
            .accessibilityIdentifier("worldMap")
        } else {
            ZStack {
                StazaColor.map.ignoresSafeArea()
                if model.basemapFailed {
                    mapNotice("world.mapUnavailable", systemImage: "map", tint: StazaColor.danger)
                } else {
                    HStack(spacing: StazaSpacing.sm) {
                        SwiftUI.ProgressView().tint(StazaColor.accent)
                        Text("world.loading").font(StazaFont.subheadline).foregroundStyle(StazaColor.textMuted)
                    }
                    .padding(.horizontal, StazaSpacing.md)
                    .padding(.vertical, StazaSpacing.sm + StazaSpacing.xs)
                    .stazaGlass(cornerRadius: StazaRadius.card)
                }
            }
        }
    }

    private func mapNotice(_ title: LocalizedStringKey, systemImage: String, tint: Color) -> some View {
        Label {
            Text(title).font(StazaFont.subheadline).foregroundStyle(StazaColor.textPrimary)
        } icon: {
            Image(systemName: systemImage).foregroundStyle(tint)
        }
        .padding(.horizontal, StazaSpacing.md)
        .padding(.vertical, StazaSpacing.sm + StazaSpacing.xs)
        .stazaGlass(cornerRadius: StazaRadius.card)
    }
}
