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
        _ = await (quests, capabilities)
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
                    questTargets: planner.isActive ? plannerTargets(planner) : model.mapQuestTargets,
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

                exploreOverlay(model, planner)
                    .padding(.horizontal, StazaSpacing.md)
                    .padding(.bottom, sheetHeight + StazaSpacing.sm)
                    .animation(reduceMotion ? nil : .snappy, value: model.exploreState)
            }
            .onChange(of: model.selection) { _, selection in
                if let selection { withAnimation(.snappy) { sheet.showDetail(selection) } }
            }
            .onChange(of: planner.isActive) { _, active in
                withAnimation(.snappy) { active ? sheet.startPlanner() : sheet.endPlanner() }
                if !active { planner.showPlannedRoute(model.preferredPlannedRoute) }
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

    /// The map's Explore button, or the card with what Explore found. Hidden while planning or in a detail.
    @ViewBuilder
    private func exploreOverlay(_ model: WorldModel, _ planner: RoutePlannerModel) -> some View {
        let browsing = sheet.mode == .browse || sheet.mode == .discoveries
        if browsing && !planner.isActive {
            if let state = model.exploreState, state != .exploring {
                ExploreResultCard(
                    state: state,
                    onViewDiscoveries: {
                        model.dismissExplore()
                        withAnimation(.snappy) { sheet.showDiscoveries() }
                    },
                    onPlanRoute: { openPlanner(model, planner) },
                    onZoomOut: {
                        model.dismissExplore()
                        zoomOut(model)
                    },
                    onShowKnown: { showKnownFlowlines(model) },
                    onDismiss: { model.dismissExplore() }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
            } else {
                ExploreCTA(
                    action: model.exploreAction,
                    isExploring: model.isExploring,
                    routeStops: planner.stops.count,
                    onExplore: { explore(model) },
                    onPlanRoute: { openPlanner(model, planner) }
                )
                .transition(.opacity)
            }
        }
    }

    private func explore(_ model: WorldModel) {
        switch model.exploreAction {
        case .zoomIn: return
        case .showFlowlines: showKnownFlowlines(model)
        case .explore, .exploreNew:
            model.clearHighlight()
            Task { await model.exploreArea(reduceMotion: reduceMotion) }
        }
    }

    /// Frames the area's revealed Flowlines and lists them; nothing is discovered again.
    private func showKnownFlowlines(_ model: WorldModel) {
        model.dismissExplore()
        framed = model.flowlines.flatMap(\.coordinates)
        withAnimation(.snappy) { sheet.showDiscoveries() }
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

    /// "Plan a route": opens the manual planner with the stops added so far. Never builds a route itself.
    private func openPlanner(_ model: WorldModel, _ planner: RoutePlannerModel) {
        model.dismissExplore()
        model.selection = nil
        model.clearHighlight()
        framed = []
        planner.open(start: userLocation)
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
            WorldBrowseHeader(model: model)
        case .discoveries:
            DiscoveriesHeader {
                framed = []
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
            DiscoveriesContent(model: model, planner: planner, origin: userLocation) { flowline in
                framed = flowline.coordinates
                model.select(.flowline, id: flowline.id)
            }
        case .planner:
            RoutePlannerPanel(
                planner: planner,
                userLocation: userLocation,
                onSuggest: {
                    guard let bounds = model.bounds else { return }
                    Task { await planner.suggest(in: bounds, catalog: model.collectible(id:)) }
                },
                onConfirm: {
                    Task { if await planner.confirm() { container.playerDataChanged() } }
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
