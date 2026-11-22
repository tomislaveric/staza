import CoreLocation
import SwiftUI

struct WorldView: View {
    @Environment(AppContainer.self) private var container
    @Environment(\.openURL) private var openURL
    @State private var model: WorldModel?
    @State private var planner: RoutePlannerModel?
    @State private var sheet = WorldSheetModel()
    @State private var userLocation: GeoPoint?
    @State private var tracking = WorldTracking.follow
    @State private var locationDenied = false
    @State private var showsLocationAlert = false
    @State private var sheetHeight: CGFloat = 0
    /// Coordinates the map frames on request, e.g. a Flowline shown from the discoveries.
    @State private var framed: [CLLocationCoordinate2D] = []
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if let model, let planner { content(model, planner) } else { Color.clear }
        }
        // Also reruns after mutations elsewhere (README "Data refresh"); the basemap loads once.
        .task(id: container.dataRevision) {
            if model == nil {
                model = WorldModel(api: container.apiClient)
                planner = RoutePlannerModel(api: container.apiClient)
            }
            async let basemap: Void = model?.loadBasemap() ?? ()
            async let playerData: Void = reloadPlayerData()
            _ = await (basemap, playerData)
        }
        .accessibilityIdentifier("worldScreen")
    }

    private func reloadPlayerData() async {
        guard let model, let planner else { return }
        async let quests: Void = model.loadQuestTargets()
        async let capabilities: Void = model.loadCapabilities()
        // Saved Exploration routes come with the viewport.
        async let viewport: Void = model.reloadViewport()
        _ = await (quests, capabilities, viewport)
        await model.loadPlannedRoutes()
        planner.showPlannedRoute(model.preferredPlannedRoute)
    }

    @ViewBuilder
    private func content(_ model: WorldModel, _ planner: RoutePlannerModel) -> some View {
        if let basemap = model.basemap, let url = URL(string: basemap.styleUrl) {
            ZStack(alignment: .bottom) {
                WorldMapView(
                    styleURL: url,
                    collectibles: model.visibleCollectibles,
                    flowlines: model.visibleFlowlines,
                    explorationRoutes: model.explorationRoutes,
                    exploreFrame: model.exploreFrame,
                    questTargets: planner.isActive ? plannerTargets(planner) : (revealedTargets(model) ?? model.mapQuestTargets),
                    route: planner.displayedRoute,
                    selectedCollectibleId: model.selection.flatMap { selection -> String? in
                        if case .collectible(let item) = selection { return item.id }
                        return nil
                    },
                    onViewportChange: { model.viewportChanged($0) },
                    onSelect: { kind, id in select(kind, id: id, model, planner) },
                    onMapTap: { planner.mapTapped($0) },
                    onUserLocation: { userLocation = $0 },
                    tracking: $tracking,
                    bottomInset: sheetHeight,
                    focus: framed.isEmpty ? focus(model) : framed,
                    onLocationDenied: { locationDenied = $0 },
                    palette: basemap.mapPalette
                )
                .ignoresSafeArea(edges: .top)
                .overlay(alignment: .topTrailing) { locateButton.padding(StazaSpacing.md) }
                .accessibilityIdentifier("worldMap")

                StazaBottomSheet(detent: $sheet.detent, onHeightChange: { sheetHeight = $0 }) {
                    sheetHeader(model, planner)
                } content: {
                    sheetContent(model, planner)
                }
                .accessibilityIdentifier("worldSheet")
            }
            .onChange(of: model.exploreState) { _, state in exploreFinished(state, model) }
            .onChange(of: model.selection) { _, selection in
                if let selection { withAnimation(.snappy) { sheet.showDetail(selection) } }
            }
            .onChange(of: planner.isActive) { _, active in
                withAnimation(.snappy) { active ? sheet.startPlanner() : sheet.endPlanner() }
                if !active {
                    // Closing or saving the route ends the Explore session.
                    model.endExploreSession()
                    planner.showPlannedRoute(model.preferredPlannedRoute)
                }
            }
            .onChange(of: planner.proposal?.id) { _, proposal in
                if proposal != nil { withAnimation(.snappy) { sheet.revealMap() } }
            }
            .onChange(of: model.highlightedInstanceId) { _, _ in
                framed = []
                if !planner.isActive { planner.showPlannedRoute(model.preferredPlannedRoute) }
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

    // MARK: Explore

    /// Explore finished: the sheet opens the result at half height and the map frames the opportunities.
    private func exploreFinished(_ state: ExploreState?, _ model: WorldModel) {
        guard let state, state != .exploring, !(planner?.isActive ?? false) else { return }
        if case .result = state {
            let points = model.sessionFlowlines.flatMap(\.coordinates)
                + model.sessionCollectibles.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
            if !points.isEmpty { framed = points }
        }
        withAnimation(.snappy) {
            sheet.showDiscoveries()
            sheet.detent = .medium
        }
    }

    /// Opportunity Flowlines stay emphasised while the Explore result is open.
    private func revealedTargets(_ model: WorldModel) -> QuestTargets? {
        guard sheet.mode == .discoveries, case .result? = model.exploreState else { return nil }
        let ids = Set(model.sessionFlowlines.map(\.id))
        guard !ids.isEmpty else { return nil }
        return QuestTargets(collectibles: [], flowlines: model.visibleFlowlines.filter { ids.contains($0.id) })
    }

    private func explore(_ model: WorldModel) {
        model.clearHighlight()
        Task { await model.exploreArea(reduceMotion: reduceMotion) }
    }

    /// Frames an area three times as large around the current one.
    private func zoomOut(_ model: WorldModel) {
        guard let bounds = model.bounds else { return }
        let halfLat = (bounds.north - bounds.south) * 1.5, halfLon = (bounds.east - bounds.west) * 1.5
        let center = CLLocationCoordinate2D(latitude: (bounds.south + bounds.north) / 2, longitude: (bounds.west + bounds.east) / 2)
        framed = [
            CLLocationCoordinate2D(latitude: max(-85, center.latitude - halfLat), longitude: max(-180, center.longitude - halfLon)),
            CLLocationCoordinate2D(latitude: min(85, center.latitude + halfLat), longitude: min(180, center.longitude + halfLon))
        ]
    }

    /// "Generate route": opens the route editor and generates one route for the chosen intent in the explored
    /// area. Without a located start inside the area, the editor asks for a start on the map first.
    private func generateRoute(_ model: WorldModel, _ planner: RoutePlannerModel) {
        guard let bounds = model.sessionBounds ?? model.bounds else { return }
        let start = userLocation.flatMap { bounds.contains($0) ? $0 : nil }
        openPlanner(model, planner, start: start)
        guard start != nil else { return }
        Task { await planner.suggest(in: bounds, catalog: model.collectible(id:)) }
    }

    /// "Plan a route": opens the route editor with the stops added so far; the Explore session stays open.
    private func openPlanner(_ model: WorldModel, _ planner: RoutePlannerModel) {
        openPlanner(model, planner, start: userLocation)
    }

    private func openPlanner(_ model: WorldModel, _ planner: RoutePlannerModel, start: GeoPoint?) {
        model.dismissExplore()
        model.selection = nil
        model.clearHighlight()
        framed = []
        planner.open(start: start)
    }

    /// While the planner adds Flowlines or collectibles, map taps add them as stops; otherwise they open details.
    private func select(_ kind: WorldSelectionKind, id: String, _ model: WorldModel, _ planner: RoutePlannerModel) {
        switch (kind, planner.isActive ? planner.mapMode : nil) {
        case (.flowline, .addFlowline?):
            if let flowline = model.flowline(id: id) { planner.toggle(.flowline(flowline)) }
        case (.collectible, .addCollectible?):
            if let item = model.collectible(id: id) { planner.toggle(.collectible(item)) }
        default:
            model.select(kind, id: id)
        }
    }

    /// The planner's stops, emphasised on the map like quest targets.
    private func plannerTargets(_ planner: RoutePlannerModel) -> QuestTargets {
        var collectibles: [WorldCollectible] = []
        var flowlines: [WorldFlowline] = []
        for stop in planner.stops {
            switch stop {
            case .collectible(let item): collectibles.append(item)
            case .flowline(let flowline): flowlines.append(flowline)
            case .waypoint: break
            }
        }
        return QuestTargets(collectibles: collectibles, flowlines: flowlines)
    }

    private func stop(for selection: WorldSelection) -> PlannerStop {
        switch selection {
        case .collectible(let item): .collectible(item)
        case .flowline(let flowline): .flowline(flowline)
        }
    }

    // MARK: Sheet

    @ViewBuilder
    private func sheetHeader(_ model: WorldModel, _ planner: RoutePlannerModel) -> some View {
        switch sheet.mode {
        case .browse:
            WorldBrowseHeader(
                model: model,
                routeStops: planner.stops.count,
                onExplore: { explore(model) },
                onPlanRoute: { openPlanner(model, planner) }
            )
        case .discoveries:
            DiscoveriesHeader(routeStops: planner.stops.count, onPlanRoute: { openPlanner(model, planner) }) {
                framed = []
                model.endExploreSession()
                withAnimation(.snappy) { sheet.closeDiscoveries() }
            }
        case .planner:
            RoutePlannerHeader(planner: planner)
        case .detail(let selection):
            WorldDetailHeader(selection: selection, isQuestTarget: model.isQuestTarget(selection)) {
                model.selection = nil
                withAnimation(.snappy) { sheet.closeDetail() }
            }
        }
    }

    @ViewBuilder
    private func sheetContent(_ model: WorldModel, _ planner: RoutePlannerModel) -> some View {
        switch sheet.mode {
        case .browse:
            WorldBrowseContent(model: model, onChanged: { container.playerDataChanged() })
        case .discoveries:
            DiscoveriesContent(
                model: model,
                planner: planner,
                origin: userLocation,
                onGenerate: { generateRoute(model, planner) },
                onViewOpportunities: { withAnimation(.snappy) { sheet.detent = .large } },
                onViewOnMap: { flowline in
                    framed = flowline.coordinates
                    model.select(.flowline, id: flowline.id)
                },
                onZoomOut: { zoomOut(model) }
            )
        case .planner:
            RoutePlannerPanel(
                planner: planner,
                userLocation: userLocation,
                onSuggest: {
                    guard let bounds = model.sessionBounds ?? model.bounds else { return }
                    Task { await planner.suggest(in: bounds, catalog: model.collectible(id:)) }
                },
                onSave: {
                    Task { if await planner.save() { container.playerDataChanged() } }
                }
            )
        case .detail(let selection):
            let stop = stop(for: selection)
            WorldDetailBody(
                selection: selection,
                isQuestTarget: model.isQuestTarget(selection),
                inRoute: planner.contains(stop),
                onToggleRoute: { planner.toggle(stop) }
            )
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
