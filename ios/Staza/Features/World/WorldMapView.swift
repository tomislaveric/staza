import CoreLocation
import MapLibre
import SwiftUI
import UIKit

/// How the map follows the user, cycled by the World locate button.
enum WorldTracking: Equatable, Sendable {
    case none, follow, heading

    /// Apple Maps order: start following, then add heading, then back to following.
    var next: WorldTracking { self == .follow ? .heading : .follow }

    var systemImage: String {
        switch self {
        case .none: "location"
        case .follow: "location.fill"
        case .heading: "location.north.line.fill"
        }
    }

    fileprivate var mapMode: MLNUserTrackingMode {
        switch self {
        case .none: .none
        case .follow: .follow
        case .heading: .followWithHeading
        }
    }

    fileprivate init(_ mode: MLNUserTrackingMode) {
        switch mode {
        case .follow: self = .follow
        case .followWithHeading, .followWithCourse: self = .heading
        default: self = .none
        }
    }
}

struct WorldMapView: UIViewRepresentable {
    let styleURL: URL
    let collectibles: [WorldCollectible]
    let flowlines: [WorldFlowline]
    let questTargets: QuestTargets
    var route: [CLLocationCoordinate2D] = []
    var selectedCollectibleId: String? = nil
    let onViewportChange: (WorldBounds) -> Void
    let onSelect: (WorldSelectionKind, String) -> Void
    var onUserLocation: (GeoPoint?) -> Void = { _ in }
    @Binding var tracking: WorldTracking
    /// Height covered by the bottom sheet; the map keeps its focus above it.
    var bottomInset: CGFloat = 0
    /// Coordinates to fit into view, e.g. a highlighted exploration's targets.
    var focus: [CLLocationCoordinate2D] = []
    var onLocationDenied: (Bool) -> Void = { _ in }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> MLNMapView {
        let map = MLNMapView(frame: .zero, styleURL: styleURL)
        map.delegate = context.coordinator
        map.isRotateEnabled = false
        map.automaticallyAdjustsContentInset = false
        map.logoView.isHidden = false
        map.showsUserLocation = true
        map.zoomLevel = 12
        map.contentInset = UIEdgeInsets(top: 0, left: 0, bottom: bottomInset, right: 0)
        map.userTrackingMode = tracking.mapMode
        context.coordinator.appliedInset = bottomInset
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        for recognizer in map.gestureRecognizers ?? [] where (recognizer as? UITapGestureRecognizer)?.numberOfTapsRequired == 2 {
            tap.require(toFail: recognizer)
        }
        map.addGestureRecognizer(tap)
        context.coordinator.requestLocationAccess()
        return map
    }

    func updateUIView(_ map: MLNMapView, context: Context) {
        let coordinator = context.coordinator
        coordinator.onViewportChange = onViewportChange
        coordinator.onSelect = onSelect
        coordinator.onUserLocation = onUserLocation
        coordinator.onTrackingChange = { tracking = $0 }
        coordinator.onLocationDenied = onLocationDenied
        coordinator.data = (collectibles, flowlines, questTargets, selectedCollectibleId)
        if abs(coordinator.appliedInset - bottomInset) > 0.5 {
            coordinator.appliedInset = bottomInset
            map.setContentInset(UIEdgeInsets(top: 0, left: 0, bottom: bottomInset, right: 0), animated: true, completionHandler: nil)
        }
        if WorldTracking(map.userTrackingMode) != tracking {
            map.setUserTrackingMode(tracking.mapMode, animated: true, completionHandler: nil)
        }
        coordinator.setRoute(route, on: map)
        coordinator.setFocus(focus, on: map)
        coordinator.refresh()
    }

    final class Coordinator: NSObject, MLNMapViewDelegate, CLLocationManagerDelegate {
        var onViewportChange: (WorldBounds) -> Void = { _ in }
        var onTrackingChange: (WorldTracking) -> Void = { _ in }
        var onLocationDenied: (Bool) -> Void = { _ in }
        var appliedInset: CGFloat = 0
        private var focus: [CLLocationCoordinate2D] = []
        var onSelect: (WorldSelectionKind, String) -> Void = { _, _ in }
        var onUserLocation: (GeoPoint?) -> Void = { _ in }
        var data: (collectibles: [WorldCollectible], flowlines: [WorldFlowline], quest: QuestTargets, selectedId: String?) = ([], [], .empty, nil)

        private let locationManager = CLLocationManager()
        private var collectibleSource: MLNShapeSource?
        private var flowlineSource: MLNShapeSource?
        private var questFlowlineSource: MLNShapeSource?
        private var routeSource: MLNShapeSource?
        private var route: [CLLocationCoordinate2D] = []

        func requestLocationAccess() {
            locationManager.delegate = self
            if locationManager.authorizationStatus == .notDetermined {
                locationManager.requestWhenInUseAuthorization()
            }
        }

        func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
            let denied = manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted
            DispatchQueue.main.async { [onLocationDenied] in onLocationDenied(denied) }
        }

        func mapView(_ map: MLNMapView, didChange mode: MLNUserTrackingMode, animated: Bool) {
            let tracking = WorldTracking(mode)
            DispatchQueue.main.async { [onTrackingChange] in onTrackingChange(tracking) }
        }

        /// Line width interpolated by zoom, matching the web Fartlek line stops so lines stay thin when zoomed out.
        static func zoomWidth(_ stops: [Double: Double]) -> NSExpression {
            NSExpression(
                format: "mgl_interpolate:withCurveType:parameters:stops:($zoomLevel, 'linear', nil, %@)",
                stops.reduce(into: [NSNumber: NSNumber]()) { $0[NSNumber(value: $1.key)] = NSNumber(value: $1.value) }
            )
        }

        func mapView(_ map: MLNMapView, didFinishLoading style: MLNStyle) {
            let accent = UIColor(StazaColor.accent)
            let flowline = UIColor(StazaColor.rarityRare)
            let proposed = UIColor(StazaColor.rarityEpic)
            let canvas = UIColor(StazaColor.canvas)

            let flowlines = MLNShapeSource(identifier: "world-flowlines", shape: nil, options: nil)
            style.addSource(flowlines)
            let flowlineLayer = MLNLineStyleLayer(identifier: "world-flowlines-line", source: flowlines)
            flowlineLayer.lineColor = NSExpression(forConstantValue: flowline)
            flowlineLayer.lineWidth = Self.zoomWidth([9: 1.2, 12: 1.8, 15: 2.6, 17: 3.4])
            flowlineLayer.lineOpacity = NSExpression(forConstantValue: 0.85)
            flowlineLayer.lineCap = NSExpression(forConstantValue: "round")
            flowlineLayer.lineJoin = NSExpression(forConstantValue: "round")
            style.addLayer(flowlineLayer)

            let questFlowlines = MLNShapeSource(identifier: "world-quest-flowlines", shape: nil, options: nil)
            style.addSource(questFlowlines)
            let questFlowlineLayer = MLNLineStyleLayer(identifier: "world-quest-flowlines-line", source: questFlowlines)
            questFlowlineLayer.lineColor = NSExpression(forConstantValue: accent)
            questFlowlineLayer.lineWidth = Self.zoomWidth([9: 1.8, 12: 2.6, 15: 3.6, 17: 4.6])
            questFlowlineLayer.lineCap = NSExpression(forConstantValue: "round")
            questFlowlineLayer.lineJoin = NSExpression(forConstantValue: "round")
            style.addLayer(questFlowlineLayer)

            let routeSource = MLNShapeSource(identifier: "explore-route", shape: nil, options: nil)
            style.addSource(routeSource)
            let casing = MLNLineStyleLayer(identifier: "explore-route-casing", source: routeSource)
            casing.lineColor = NSExpression(forConstantValue: canvas)
            casing.lineWidth = NSExpression(forConstantValue: 8)
            casing.lineCap = NSExpression(forConstantValue: "round")
            casing.lineJoin = NSExpression(forConstantValue: "round")
            style.addLayer(casing)
            let routeLayer = MLNLineStyleLayer(identifier: "explore-route-line", source: routeSource)
            routeLayer.lineColor = NSExpression(forConstantValue: proposed)
            routeLayer.lineWidth = NSExpression(forConstantValue: 5)
            routeLayer.lineCap = NSExpression(forConstantValue: "round")
            routeLayer.lineJoin = NSExpression(forConstantValue: "round")
            style.addLayer(routeLayer)
            self.routeSource = routeSource

            // Collectibles draw above routes: fallback circles, highlight rings, then category icons.
            let collectibles = MLNShapeSource(identifier: "world-collectibles", shape: nil, options: nil)
            style.addSource(collectibles)
            CollectibleMapIcons.register(on: style)

            let circle = MLNCircleStyleLayer(identifier: Self.circleLayer, source: collectibles)
            circle.predicate = NSPredicate(format: "icon == ''")
            circle.circleRadius = CollectibleMapIcons.circleRadius
            circle.circleColor = NSExpression(format: "TERNARY(found == YES, %@, %@)", CollectibleMapIcons.foundColor, CollectibleMapIcons.unfoundFill)
            circle.circleOpacity = NSExpression(format: "TERNARY(found == YES, 1, 0.88)")
            circle.circleStrokeWidth = CollectibleMapIcons.zoomStops([9: 1, 12: 1.4, 15: 1.8, 17: 2])
            circle.circleStrokeColor = NSExpression(format: "TERNARY(found == YES, %@, %@)", UIColor(StazaColor.map), CollectibleMapIcons.mutedColor)
            circle.circleStrokeOpacity = NSExpression(forConstantValue: 0.95)
            style.addLayer(circle)

            let highlights: [(id: String, predicate: String, color: UIColor, scale: Double, emphasis: Double)] = [
                ("quest", "questTarget == YES AND selected == NO", accent, 1, 0),
                ("selected", "selected == YES", CollectibleMapIcons.selectedColor, 1.15, 1)
            ]
            for highlight in highlights {
                let glow = MLNCircleStyleLayer(identifier: "world-collectibles-\(highlight.id)-glow", source: collectibles)
                glow.predicate = NSPredicate(format: highlight.predicate)
                glow.circleRadius = CollectibleMapIcons.zoomStops([9: 17, 12: 21, 15: 25, 17: 29], scale: highlight.scale)
                glow.circleColor = NSExpression(forConstantValue: highlight.color)
                glow.circleOpacity = NSExpression(forConstantValue: 0.08 + 0.12 * highlight.emphasis)
                glow.circleStrokeWidth = NSExpression(forConstantValue: 1)
                glow.circleStrokeColor = NSExpression(forConstantValue: highlight.color)
                glow.circleStrokeOpacity = NSExpression(forConstantValue: 0.28 + 0.52 * highlight.emphasis)
                style.addLayer(glow)
                let ring = MLNCircleStyleLayer(identifier: "world-collectibles-\(highlight.id)-ring", source: collectibles)
                ring.predicate = NSPredicate(format: highlight.predicate)
                ring.circleRadius = CollectibleMapIcons.zoomStops([9: 12.5, 12: 15, 15: 17, 17: 19.5], scale: highlight.scale)
                ring.circleColor = NSExpression(forConstantValue: highlight.color)
                ring.circleOpacity = NSExpression(forConstantValue: 0.14 + 0.14 * highlight.emphasis)
                ring.circleStrokeWidth = NSExpression(forConstantValue: 2 + highlight.emphasis)
                ring.circleStrokeColor = NSExpression(forConstantValue: highlight.color)
                ring.circleStrokeOpacity = NSExpression(forConstantValue: 0.95)
                style.addLayer(ring)
            }

            let icons = MLNSymbolStyleLayer(identifier: Self.iconLayer, source: collectibles)
            icons.predicate = NSPredicate(format: "icon != ''")
            icons.iconImageName = NSExpression(forKeyPath: "icon")
            icons.iconScale = CollectibleMapIcons.iconScale
            icons.iconAllowsOverlap = NSExpression(forConstantValue: true)
            icons.iconIgnoresPlacement = NSExpression(forConstantValue: true)
            icons.iconOpacity = NSExpression(format: "TERNARY(found == YES, 1, 0.88)")
            style.addLayer(icons)

            collectibleSource = collectibles
            flowlineSource = flowlines
            questFlowlineSource = questFlowlines
            refresh()
            applyRoute(on: map)
            reportViewport(map)
        }

        @objc func handleTap(_ gesture: UITapGestureRecognizer) {
            guard gesture.state == .ended, let map = gesture.view as? MLNMapView else { return }
            let point = gesture.location(in: map)
            let hitArea = CGRect(x: point.x - 22, y: point.y - 22, width: 44, height: 44)
            let groups: [(WorldSelectionKind, Set<String>)] = [
                (.collectible, [Self.iconLayer, Self.circleLayer]),
                (.flowline, ["world-quest-flowlines-line", "world-flowlines-line"])
            ]
            for (kind, layers) in groups {
                let hit = map.visibleFeatures(in: hitArea, styleLayerIdentifiers: layers)
                    .compactMap { $0.attribute(forKey: "id") as? String }.first
                if let hit {
                    onSelect(kind, hit)
                    return
                }
            }
        }

        func mapView(_ map: MLNMapView, regionDidChangeAnimated animated: Bool) {
            reportViewport(map)
        }

        func refresh() {
            guard let collectibleSource, let flowlineSource, let questFlowlineSource else { return }
            collectibleSource.shape = Self.points(data.collectibles, quest: data.quest.collectibles, selectedId: data.selectedId)
            flowlineSource.shape = Self.lines(data.flowlines)
            questFlowlineSource.shape = Self.lines(data.quest.flowlines)
        }

        func setRoute(_ coordinates: [CLLocationCoordinate2D], on map: MLNMapView) {
            let changed = coordinates.count != route.count
                || coordinates.first?.latitude != route.first?.latitude
                || coordinates.last?.latitude != route.last?.latitude
                || coordinates.count > 1 && coordinates[coordinates.count / 2].longitude != route[route.count / 2].longitude
            guard changed else { return }
            route = coordinates
            applyRoute(on: map)
        }

        private func applyRoute(on map: MLNMapView) {
            guard let routeSource else { return }
            guard route.count >= 2 else {
                routeSource.shape = nil
                return
            }
            routeSource.shape = MLNPolylineFeature(coordinates: route, count: UInt(route.count))
            fit(route, on: map)
        }

        func setFocus(_ coordinates: [CLLocationCoordinate2D], on map: MLNMapView) {
            let same = coordinates.count == focus.count && zip(coordinates, focus).allSatisfy {
                $0.latitude == $1.latitude && $0.longitude == $1.longitude
            }
            guard !same else { return }
            focus = coordinates
            if !coordinates.isEmpty { fit(coordinates, on: map) }
        }

        /// Fits coordinates into the part of the map not covered by the sheet (the content inset).
        private func fit(_ coordinates: [CLLocationCoordinate2D], on map: MLNMapView) {
            guard let first = coordinates.first else { return }
            if coordinates.count == 1 {
                map.setCenter(first, zoomLevel: max(map.zoomLevel, 13), animated: true)
                return
            }
            var minLat = 90.0, maxLat = -90.0, minLon = 180.0, maxLon = -180.0
            for point in coordinates {
                minLat = min(minLat, point.latitude); maxLat = max(maxLat, point.latitude)
                minLon = min(minLon, point.longitude); maxLon = max(maxLon, point.longitude)
            }
            let bounds = MLNCoordinateBounds(
                sw: CLLocationCoordinate2D(latitude: minLat, longitude: minLon),
                ne: CLLocationCoordinate2D(latitude: maxLat, longitude: maxLon)
            )
            map.setVisibleCoordinateBounds(bounds, edgePadding: UIEdgeInsets(top: 80, left: 40, bottom: 40, right: 40), animated: true, completionHandler: nil)
        }

        private func reportViewport(_ map: MLNMapView) {
            let location = locationManager.location?.coordinate
            let point = location.flatMap { CLLocationCoordinate2DIsValid($0) ? GeoPoint(lat: $0.latitude, lon: $0.longitude) : nil }
            DispatchQueue.main.async { [onUserLocation] in onUserLocation(point) }
            let bounds = map.visibleCoordinateBounds
            onViewportChange(WorldBounds(west: bounds.sw.longitude, south: bounds.sw.latitude, east: bounds.ne.longitude, north: bounds.ne.latitude))
        }

        private static let circleLayer = "world-collectibles-circle"
        private static let iconLayer = "world-collectibles-icon"

        /// One feature per collectible; quest targets missing from the viewport list are appended.
        private static func points(_ items: [WorldCollectible], quest: [WorldCollectible], selectedId: String?) -> MLNShape? {
            let questIds = Set(quest.map(\.id))
            let itemIds = Set(items.map(\.id))
            let all = items + quest.filter { !itemIds.contains($0.id) }
            guard !all.isEmpty else { return nil }
            return MLNShapeCollectionFeature(shapes: all.map { item in
                let point = MLNPointFeature()
                point.coordinate = CLLocationCoordinate2D(latitude: item.latitude, longitude: item.longitude)
                point.attributes = [
                    "id": item.id,
                    "found": item.found,
                    "questTarget": questIds.contains(item.id),
                    "selected": item.id == selectedId,
                    "icon": CollectibleMapIcons.imageName(category: WorldCategory.of(item), found: item.found) ?? ""
                ]
                return point
            })
        }

        private static func lines(_ items: [WorldFlowline]) -> MLNShape? {
            let features: [MLNPolylineFeature] = items.compactMap { item in
                let coords = item.coordinates
                guard coords.count >= 2 else { return nil }
                let line = MLNPolylineFeature(coordinates: coords, count: UInt(coords.count))
                line.attributes = ["id": item.id, "completed": item.completed]
                return line
            }
            return features.isEmpty ? nil : MLNShapeCollectionFeature(shapes: features)
        }
    }
}
