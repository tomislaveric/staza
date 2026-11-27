import CoreLocation
import SwiftUI

/// Explore: plan a route on the map. POIs can be chosen as the destination or added as stops; cycling
/// routes then offer nearby Flowlines as optional enhancements.
struct WorldView: View {
    @Environment(AppContainer.self) private var container
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model: WorldModel?
    @State private var planner: RoutePlannerModel?
    @State private var detent = StazaSheetDetent.medium
    @State private var userLocation: GeoPoint?
    @State private var tracking = WorldTracking.follow
    @State private var locationDenied = false
    @State private var showsLocationAlert = false
    @State private var sheetHeight: CGFloat = 0
    /// Coordinates the map frames on request, e.g. a focused stop or tapped POI.
    @State private var framed: [CLLocationCoordinate2D] = []
    @State private var focusRequest = 0
    @State private var centering: Task<Void, Never>?

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
            guard let model, let planner else { return }
            async let basemap: Void = model.loadBasemap()
            async let explorations: Void = model.loadExplorations()
            // Saved Exploration routes come with the viewport.
            async let viewport: Void = model.reloadViewport()
            _ = await (basemap, explorations, viewport)
            planner.showPlannedRoute(model.highlightedRoute)
        }
        .accessibilityIdentifier("worldScreen")
    }

    @ViewBuilder
    private func content(_ model: WorldModel, _ planner: RoutePlannerModel) -> some View {
        if let basemap = model.basemap, let url = URL(string: basemap.styleUrl) {
            ZStack(alignment: .bottom) {
                WorldMapView(
                    styleURL: url,
                    collectibles: model.collectibles,
                    stopIds: Set(planner.stops.map(\.key)),
                    selectedCollectibleId: model.selection?.id ?? planner.focusedCollectibleId,
                    flowlines: planner.flowlineEnhancements.map(\.flowline),
                    selectedFlowlineIds: planner.selectedEnhancementIds.union(planner.focusedFlowlineId.map { [$0] } ?? []),
                    explorationRoutes: model.explorationRoutes,
                    route: planner.displayedRoute,
                    onViewportChange: { model.viewportChanged($0) },
                    onVisibleAreaChange: { model.visibleArea = $0 },
                    onSelectCollectible: { id in
                        planner.mapSelected(collectibleId: id)
                        model.selection = model.collectible(id: id)
                    },
                    onSelectFlowline: { id in
                        planner.mapSelected(flowlineId: id)
                        toggleEnhancement(id, planner)
                    },
                    onMapTap: { point in
                        if model.selection != nil { model.selection = nil } else { planner.mapTapped(point) }
                    },
                    picksPoint: planner.mapMode != nil,
                    onUserLocation: { userLocation = $0 },
                    tracking: $tracking,
                    bottomInset: sheetHeight,
                    focus: framed,
                    focusRequest: focusRequest,
                    focusFill: 0.5,
                    onLocationDenied: { locationDenied = $0 },
                    palette: basemap.mapPalette
                )
                .ignoresSafeArea(edges: .top)
                .overlay { aimOverlay(planner) }
                .overlay(alignment: .topTrailing) { locateButton.padding(StazaSpacing.md) }
                .accessibilityIdentifier("worldMap")

                StazaBottomSheet(detent: $detent, maxDetent: model.selection == nil ? .large : .medium,
                                 onHeightChange: { sheetHeight = $0 }) {
                    sheetHeader(model, planner)
                } content: {
                    sheetContent(model, planner)
                }
                .accessibilityIdentifier("worldSheet")
            }
            .onChange(of: userLocation) { _, location in if let location { planner.locate(location) } }
            .onChange(of: model.selection) { _, item in
                guard let item else { return }
                withAnimation(.snappy) { if detent == .peek { detent = .medium } }
                center(on: [item.coordinate])
            }
            .onChange(of: planner.generateRequest) { _, _ in generate(model, planner) }
            .onChange(of: planner.focusRequest) { _, _ in
                let points = planner.focusedPoints
                guard !points.isEmpty else { return }
                revealMap()
                center(on: points.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) })
            }
            .onChange(of: planner.proposal?.id) { _, proposal in if proposal != nil { revealMap() } }
            .onChange(of: model.highlightedInstanceId) { _, _ in planner.showPlannedRoute(model.highlightedRoute) }
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

    // MARK: Planning

    /// Generates the route towards the aim: the center of the map the sheet does not cover.
    private func generate(_ model: WorldModel, _ planner: RoutePlannerModel) {
        guard let aim = (model.visibleArea ?? model.bounds)?.center else { return }
        model.clearHighlight()
        Task { await planner.generate(toward: aim) }
    }

    private func reset(_ model: WorldModel, _ planner: RoutePlannerModel) {
        model.clearHighlight()
        model.selection = nil
        planner.reset(start: userLocation ?? planner.start)
    }

    private func toggleEnhancement(_ id: String, _ planner: RoutePlannerModel) {
        let selected = planner.selectedEnhancementIds.contains(id)
        Task { await planner.setFlowlineEnhancement(id, enabled: !selected) }
    }

    private func detailAction(for item: WorldCollectible, _ planner: RoutePlannerModel) -> WorldDetailAction {
        planner.canEditStops ? .toggleStop(inRoute: planner.contains(.collectible(item))) : .routeHere
    }

    private func perform(_ action: WorldDetailAction, on item: WorldCollectible, _ model: WorldModel, _ planner: RoutePlannerModel) {
        switch action {
        case .routeHere: planner.setDestination(item)
        case .toggleStop: planner.toggle(.collectible(item))
        }
        model.selection = nil
    }

    /// Nothing planned yet: the saved routes are listed below the planner.
    private func isFresh(_ planner: RoutePlannerModel) -> Bool {
        !planner.generated && planner.proposal == nil && planner.stops.isEmpty && planner.status == .idle
    }

    /// The aim icon marks the target in the middle of the uncovered map until a route or POI destination
    /// exists: the turning point of a round trip or the end of an A→B route.
    @ViewBuilder
    private func aimOverlay(_ planner: RoutePlannerModel) -> some View {
        let aims = planner.destinationId == nil && (planner.routeType == .roundTrip || planner.end == nil)
        if aims && !planner.generated && planner.proposal == nil {
            ZStack(alignment: .top) {
                // Full map height like the map's own frame, so the target sits in the middle of the uncovered map.
                GeometryReader { geometry in
                    Image(systemName: "scope")
                        .font(.title)
                        .foregroundStyle(StazaColor.accent)
                        .shadow(color: .black.opacity(0.25), radius: 2)
                        .position(x: geometry.size.width / 2, y: max(0, geometry.size.height - sheetHeight) / 2)
                }
                .ignoresSafeArea(edges: .top)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
                Label("planner.area.caption", systemImage: "scope")
                    .font(StazaFont.footnote.weight(.semibold))
                    .foregroundStyle(StazaColor.textPrimary)
                    .padding(.horizontal, StazaSpacing.sm)
                    .padding(.vertical, StazaSpacing.xs)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.top, StazaSpacing.md)
                    .allowsHitTesting(false)
                    .accessibilityIdentifier("plannerAreaCaption")
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }

    /// Centers the map on coordinates once the sheet has settled, so the fit uses the visible area above it.
    private func center(on coordinates: [CLLocationCoordinate2D]) {
        centering?.cancel()
        centering = Task { @MainActor in
            try? await Task.sleep(for: reduceMotion ? .milliseconds(250) : .milliseconds(450))
            guard !Task.isCancelled else { return }
            framed = coordinates
            focusRequest += 1
        }
    }

    /// Collapses the sheet so a newly drawn route or focused stop is visible above it.
    private func revealMap() {
        withAnimation(.snappy) { if detent == .large { detent = .medium } }
    }

    // MARK: Sheet

    @ViewBuilder
    private func sheetHeader(_ model: WorldModel, _ planner: RoutePlannerModel) -> some View {
        if let item = model.selection {
            WorldDetailHeader(item: item) { model.selection = nil }
        } else {
            RoutePlannerHeader(planner: planner, onReset: { reset(model, planner) })
        }
    }

    @ViewBuilder
    private func sheetContent(_ model: WorldModel, _ planner: RoutePlannerModel) -> some View {
        if let item = model.selection {
            let action = detailAction(for: item, planner)
            WorldDetailBody(item: item, action: action) { perform(action, on: item, model, planner) }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                RoutePlannerPanel(
                    planner: planner,
                    userLocation: userLocation,
                    onSave: {
                        Task { if await planner.save() { container.playerDataChanged() } }
                    }
                )
                if isFresh(planner) {
                    SavedExplorationsList(model: model, onChanged: { container.playerDataChanged() })
                }
            }
        }
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
