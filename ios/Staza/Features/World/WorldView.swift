import CoreLocation
import SwiftUI

struct WorldView: View {
    @Environment(AppContainer.self) private var container
    @Environment(\.openURL) private var openURL
    @State private var model: WorldModel?
    @State private var explore: ExploreModel?
    @State private var sheet = WorldSheetModel()
    @State private var userLocation: GeoPoint?
    @State private var tracking = WorldTracking.follow
    @State private var locationDenied = false
    @State private var showsLocationAlert = false
    @State private var sheetHeight: CGFloat = 0

    var body: some View {
        Group {
            if let model, let explore { content(model, explore) } else { Color.clear }
        }
        // Also reruns after mutations elsewhere (README "Data refresh"); the basemap loads once.
        .task(id: container.dataRevision) {
            if model == nil {
                model = WorldModel(api: container.apiClient)
                explore = ExploreModel(api: container.apiClient)
            }
            async let basemap: Void = model?.loadBasemap() ?? ()
            async let playerData: Void = reloadPlayerData()
            _ = await (basemap, playerData)
        }
        .accessibilityIdentifier("worldScreen")
    }

    private func reloadPlayerData() async {
        guard let model, let explore else { return }
        async let quests: Void = model.loadQuestTargets()
        async let capabilities: Void = model.loadCapabilities()
        _ = await (quests, capabilities)
        await model.loadPlannedRoutes()
        explore.showPlannedRoute(model.preferredPlannedRoute)
    }

    @ViewBuilder
    private func content(_ model: WorldModel, _ explore: ExploreModel) -> some View {
        if let basemap = model.basemap, let url = URL(string: basemap.styleUrl) {
            ZStack(alignment: .bottom) {
                WorldMapView(
                    styleURL: url,
                    collectibles: model.visibleCollectibles,
                    flowlines: model.visibleFlowlines,
                    questTargets: model.mapQuestTargets,
                    route: explore.displayedRoute,
                    onViewportChange: { model.viewportChanged($0) },
                    onSelect: { model.select($0, id: $1) },
                    onUserLocation: { userLocation = $0 },
                    tracking: $tracking,
                    bottomInset: sheetHeight,
                    focus: focus(model),
                    onLocationDenied: { locationDenied = $0 }
                )
                .ignoresSafeArea(edges: .top)
                .overlay(alignment: .topTrailing) { locateButton.padding(StazaSpacing.md) }
                .accessibilityIdentifier("worldMap")

                StazaBottomSheet(detent: $sheet.detent, onHeightChange: { sheetHeight = $0 }) {
                    sheetHeader(model, explore)
                } content: {
                    sheetContent(model, explore)
                }
                .accessibilityIdentifier("worldSheet")
            }
            .onChange(of: model.selection) { _, selection in
                if let selection { withAnimation(.snappy) { sheet.showDetail(selection) } }
            }
            .onChange(of: explore.isActive) { _, active in
                withAnimation(.snappy) { active ? sheet.startExplore() : sheet.endExplore() }
            }
            .onChange(of: explore.selectedId) { _, selected in
                if selected != nil { withAnimation(.snappy) { sheet.revealMap() } }
            }
            .onChange(of: model.highlightedInstanceId) { _, _ in
                if !explore.isActive { explore.showPlannedRoute(model.preferredPlannedRoute) }
            }
            .alert("world.locate.denied.title", isPresented: $showsLocationAlert) {
                Button("world.locate.denied.settings") {
                    if let settings = URL(string: UIApplication.openSettingsURLString) { openURL(settings) }
                }
                Button("world.locate.denied.cancel", role: .cancel) {}
            } message: {
                Text("world.locate.denied.message")
            }
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

    // MARK: Sheet

    @ViewBuilder
    private func sheetHeader(_ model: WorldModel, _ explore: ExploreModel) -> some View {
        switch sheet.mode {
        case .browse:
            WorldBrowseHeader(model: model) {
                guard let bounds = model.bounds else { return }
                model.clearHighlight()
                explore.begin(bounds: bounds, userLocation: userLocation)
            }
        case .explore:
            ExploreSheetHeader(model: explore)
        case .detail(let selection):
            WorldDetailHeader(selection: selection, isQuestTarget: model.isQuestTarget(selection)) {
                model.selection = nil
                withAnimation(.snappy) { sheet.closeDetail() }
            }
        }
    }

    @ViewBuilder
    private func sheetContent(_ model: WorldModel, _ explore: ExploreModel) -> some View {
        switch sheet.mode {
        case .browse:
            WorldBrowseContent(model: model, onChanged: { container.playerDataChanged() })
        case .explore:
            ExplorePanel(model: explore)
        case .detail(let selection):
            WorldDetailBody(selection: selection, isQuestTarget: model.isQuestTarget(selection))
        }
    }

    /// Fits the highlighted exploration's targets into view.
    private func focus(_ model: WorldModel) -> [CLLocationCoordinate2D] {
        guard let targets = model.highlightedTargets else { return [] }
        return targets.collectibles.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
            + targets.flowlines.flatMap(\.coordinates)
    }

    // MARK: Locate

    private var locateButton: some View {
        Button {
            if locationDenied {
                showsLocationAlert = true
            } else {
                tracking = tracking.next
            }
        } label: {
            Image(systemName: locationDenied ? "location.slash" : tracking.systemImage)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(tracking == .none || locationDenied ? StazaColor.textPrimary : StazaColor.accent)
                .contentTransition(.symbolEffect(.replace))
                .frame(width: 48, height: 48)
                .stazaGlass(cornerRadius: StazaRadius.card)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: tracking)
        .accessibilityLabel(Text("world.locate"))
        .accessibilityValue(Text(trackingLabel))
        .accessibilityIdentifier("worldLocate")
    }

    private var trackingLabel: LocalizedStringKey {
        if locationDenied { return "world.locate.state.denied" }
        switch tracking {
        case .none: return "world.locate.state.none"
        case .follow: return "world.locate.state.follow"
        case .heading: return "world.locate.state.heading"
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
