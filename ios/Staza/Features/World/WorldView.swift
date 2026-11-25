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
    @State private var focusRequest = 0
    @State private var centering: Task<Void, Never>?
    /// Share of the visible map a focus fit may fill; a selected item gets room around it.
    @State private var focusFill: CGFloat = 1
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
                    exploreOutline: model.exploreOutline,
                    questTargets: planner.isActive ? plannerTargets(planner) : model.mapQuestTargets,
                    route: planner.displayedRoute,
                    selection: planner.isActive ? plannerSelection(planner) : model.selection,
                    onViewportChange: { model.viewportChanged($0) },
                    onExploreCircleChange: { model.exploreCircle = $0 },
                    onVisibleAreaChange: { model.visibleArea = $0 },
                    onSelect: { kind, id in select(kind, id: id, model, planner) },
                    onMapTap: { planner.mapTapped($0) },
                    picksPoint: planner.isActive && planner.mapMode != nil,
                    onUserLocation: { userLocation = $0 },
                    tracking: $tracking,
                    bottomInset: sheetHeight,
                    focus: framed.isEmpty ? focus(model) : framed,
                    focusRequest: focusRequest,
                    focusFill: focusFill,
                    onLocationDenied: { locationDenied = $0 },
                    palette: basemap.mapPalette
                )
                .ignoresSafeArea(edges: .top)
                .overlay(alignment: .topTrailing) { locateButton.padding(StazaSpacing.md) }
                .accessibilityIdentifier("worldMap")

                StazaBottomSheet(detent: $sheet.detent, maxDetent: sheet.selection == nil ? .large : .medium,
                                 onHeightChange: { sheetHeight = $0 }) {
                    sheetHeader(model, planner)
                } content: {
                    sheetContent(model, planner)
                }
                .accessibilityIdentifier("worldSheet")
            }
            .onChange(of: model.exploreState) { _, state in exploreFinished(state, model) }
            .onChange(of: model.selection) { _, selection in
                guard let selection else { return }
                withAnimation(.snappy) { sheet.showDetail(selection) }
                center(on: selection)
            }
            .onChange(of: planner.isActive) { _, active in
                withAnimation(.snappy) { active ? sheet.startPlanner() : sheet.endPlanner() }
                if !active {
                    // Closing or saving the route ends the Explore session.
                    model.endExploreSession()
                    planner.showPlannedRoute(model.preferredPlannedRoute)
                }
            }
            .onChange(of: planner.focusRequest) { _, _ in
                guard let stop = planner.focusedStop else { return }
                withAnimation(.snappy) { sheet.revealMap() }
                center(on: stop.points.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) })
            }
            .onChange(of: planner.proposal?.id) { _, proposal in
                if proposal != nil { withAnimation(.snappy) { sheet.revealMap() } }
            }
            .onChange(of: model.highlightedInstanceId) { _, _ in
                focusFill = 1
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
            // The whole explored area stays in view; without an outline, everything it found.
            let points = !model.exploreOutline.isEmpty ? model.exploreOutline
                : model.sessionFlowlines.flatMap(\.coordinates)
                + model.sessionCollectibles.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
            if !points.isEmpty {
                focusFill = 1
                framed = points
            }
        }
        withAnimation(.snappy) {
            sheet.showDiscoveries()
            sheet.detent = .medium
        }
    }

    /// Opportunity Flowlines stay emphasised while the Explore result is open.
    /// Centers the map on a selected Flowline or collectible once the sheet has settled at its
    /// new height, so the fit uses the final visible area above it.
    private func center(on selection: WorldSelection) {
        switch selection {
        case .flowline(let flowline): center(on: flowline.coordinates)
        case .collectible(let item): center(on: [item.coordinate])
        }
    }

    private func center(on coordinates: [CLLocationCoordinate2D]) {
        centering?.cancel()
        centering = Task { @MainActor in
            try? await Task.sleep(for: Self.sheetSettleDelay(reduceMotion: reduceMotion))
            guard !Task.isCancelled else { return }
            focusFill = Self.selectionFill
            framed = coordinates
            focusRequest += 1
        }
    }

    /// A selected Flowline spans about half of the visible map.
    private static let selectionFill: CGFloat = 0.5

    /// Slightly longer than the sheet's snap animation.
    private static func sheetSettleDelay(reduceMotion: Bool) -> Duration {
        reduceMotion ? .milliseconds(250) : .milliseconds(450)
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

    /// "Plan a route": opens the route editor with the stops added so far; the Explore session stays open.
    /// During a session the player's position is the start only inside the explored area; otherwise
    /// the planner asks for a start on the map.
    private func openPlanner(_ model: WorldModel, _ planner: RoutePlannerModel) {
        let start = model.sessionBounds.map { bounds in userLocation.flatMap { bounds.contains($0) ? $0 : nil } } ?? userLocation
        openPlanner(model, planner, start: start)
    }

    private func openPlanner(_ model: WorldModel, _ planner: RoutePlannerModel, start: GeoPoint?) {
        model.dismissExplore()
        model.selection = nil
        model.clearHighlight()
        framed = []
        planner.open(start: start)
    }

    /// Planner map taps add stops directly unless the player is explicitly picking an endpoint.
    private func select(_ kind: WorldSelectionKind, id: String, _ model: WorldModel, _ planner: RoutePlannerModel) {
        if planner.isActive {
            switch kind {
            case .flowline:
                if let flowline = model.flowline(id: id) { planner.mapSelected(.flowline(flowline)) }
            case .collectible:
                if let item = model.collectible(id: id) { planner.mapSelected(.collectible(item)) }
            }
            return
        }
        model.select(kind, id: id)
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

    /// The stop tapped in the planner list gets the map's selection halo; waypoints are only centered.
    private func plannerSelection(_ planner: RoutePlannerModel) -> WorldSelection? {
        switch planner.focusedStop {
        case .flowline(let flowline)?: .flowline(flowline)
        case .collectible(let item)?: .collectible(item)
        case .waypoint?, nil: nil
        }
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
            DiscoveriesHeader(
                routeStops: planner.stops.count,
                isExploring: model.isExploring,
                onPlanRoute: { openPlanner(model, planner) },
                onExplore: { explore(model) }
            )
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
                onViewOnMap: { selection in
                    switch selection {
                    case .flowline(let flowline): model.select(.flowline, id: flowline.id)
                    case .collectible(let item): model.select(.collectible, id: item.id)
                    }
                    // Re-selecting the current item does not change the selection; center on it anyway.
                    center(on: selection)
                },
                onZoomOut: { zoomOut(model) },
                onEnd: {
                    framed = []
                    model.endExploreSession()
                    withAnimation(.snappy) { sheet.closeDiscoveries() }
                }
            )
        case .planner:
            RoutePlannerPanel(
                planner: planner,
                userLocation: userLocation,
                onSuggest: {
                    // The explored area, else the map the sheet does not cover.
                    guard let bounds = model.sessionBounds ?? model.visibleArea ?? model.bounds else { return }
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
