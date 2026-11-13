import CoreLocation
import MapLibre
import SwiftUI
import UIKit

struct WorldMapView: UIViewRepresentable {
    let styleURL: URL
    let collectibles: [WorldCollectible]
    let flowlines: [WorldFlowline]
    let questTargets: QuestTargets
    var route: [CLLocationCoordinate2D] = []
    let onViewportChange: (WorldBounds) -> Void
    let onSelect: (WorldSelectionKind, String) -> Void
    var onUserLocation: (GeoPoint?) -> Void = { _ in }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> MLNMapView {
        let map = MLNMapView(frame: .zero, styleURL: styleURL)
        map.delegate = context.coordinator
        map.isRotateEnabled = false
        map.automaticallyAdjustsContentInset = false
        map.logoView.isHidden = false
        map.showsUserLocation = true
        map.userTrackingMode = .follow
        map.zoomLevel = 12
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
        coordinator.data = (collectibles, flowlines, questTargets)
        coordinator.setRoute(route, on: map)
        coordinator.refresh()
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        var onViewportChange: (WorldBounds) -> Void = { _ in }
        var onSelect: (WorldSelectionKind, String) -> Void = { _, _ in }
        var onUserLocation: (GeoPoint?) -> Void = { _ in }
        var data: (collectibles: [WorldCollectible], flowlines: [WorldFlowline], quest: QuestTargets) = ([], [], .empty)

        private let locationManager = CLLocationManager()
        private var collectibleSource: MLNShapeSource?
        private var flowlineSource: MLNShapeSource?
        private var questSource: MLNShapeSource?
        private var questFlowlineSource: MLNShapeSource?
        private var routeSource: MLNShapeSource?
        private var route: [CLLocationCoordinate2D] = []

        func requestLocationAccess() {
            if locationManager.authorizationStatus == .notDetermined {
                locationManager.requestWhenInUseAuthorization()
            }
        }

        func mapView(_ map: MLNMapView, didFinishLoading style: MLNStyle) {
            let accent = UIColor(StazaColor.accent)
            let foundColor = UIColor(StazaColor.success)
            let unfoundColor = UIColor(StazaColor.textMuted)
            let flowline = UIColor(StazaColor.rarityRare)
            let proposed = UIColor(StazaColor.rarityEpic)
            let canvas = UIColor(StazaColor.canvas)

            let flowlines = MLNShapeSource(identifier: "world-flowlines", shape: nil, options: nil)
            style.addSource(flowlines)
            let flowlineLayer = MLNLineStyleLayer(identifier: "world-flowlines-line", source: flowlines)
            flowlineLayer.lineColor = NSExpression(forConstantValue: flowline)
            flowlineLayer.lineWidth = NSExpression(forConstantValue: 3)
            flowlineLayer.lineOpacity = NSExpression(forConstantValue: 0.85)
            flowlineLayer.lineCap = NSExpression(forConstantValue: "round")
            flowlineLayer.lineJoin = NSExpression(forConstantValue: "round")
            style.addLayer(flowlineLayer)

            let questFlowlines = MLNShapeSource(identifier: "world-quest-flowlines", shape: nil, options: nil)
            style.addSource(questFlowlines)
            let questFlowlineLayer = MLNLineStyleLayer(identifier: "world-quest-flowlines-line", source: questFlowlines)
            questFlowlineLayer.lineColor = NSExpression(forConstantValue: accent)
            questFlowlineLayer.lineWidth = NSExpression(forConstantValue: 5)
            questFlowlineLayer.lineCap = NSExpression(forConstantValue: "round")
            questFlowlineLayer.lineJoin = NSExpression(forConstantValue: "round")
            style.addLayer(questFlowlineLayer)

            let collectibles = MLNShapeSource(identifier: "world-collectibles", shape: nil, options: nil)
            style.addSource(collectibles)
            for (id, found, color) in [("unfound", false, unfoundColor), ("found", true, foundColor)] {
                let layer = MLNCircleStyleLayer(identifier: "world-collectibles-\(id)", source: collectibles)
                layer.predicate = NSPredicate(format: "found == %@", NSNumber(value: found))
                layer.circleRadius = NSExpression(forConstantValue: found ? 6 : 7)
                layer.circleColor = NSExpression(forConstantValue: color)
                layer.circleOpacity = NSExpression(forConstantValue: found ? 0.9 : 1)
                layer.circleStrokeColor = NSExpression(forConstantValue: canvas)
                layer.circleStrokeWidth = NSExpression(forConstantValue: 2)
                style.addLayer(layer)
            }

            let quest = MLNShapeSource(identifier: "world-quest-collectibles", shape: nil, options: nil)
            style.addSource(quest)
            let questLayer = MLNCircleStyleLayer(identifier: "world-quest-collectibles-circle", source: quest)
            questLayer.circleRadius = NSExpression(forConstantValue: 9)
            questLayer.circleColor = NSExpression(forConstantValue: accent)
            questLayer.circleStrokeColor = NSExpression(forConstantValue: canvas)
            questLayer.circleStrokeWidth = NSExpression(forConstantValue: 3)
            style.addLayer(questLayer)

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

            collectibleSource = collectibles
            flowlineSource = flowlines
            questSource = quest
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
                (.collectible, ["world-quest-collectibles-circle", "world-collectibles-unfound", "world-collectibles-found"]),
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
            guard let collectibleSource, let flowlineSource, let questSource, let questFlowlineSource else { return }
            collectibleSource.shape = Self.points(data.collectibles)
            questSource.shape = Self.points(data.quest.collectibles)
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
            var minLat = 90.0, maxLat = -90.0, minLon = 180.0, maxLon = -180.0
            for point in route {
                minLat = min(minLat, point.latitude); maxLat = max(maxLat, point.latitude)
                minLon = min(minLon, point.longitude); maxLon = max(maxLon, point.longitude)
            }
            let bounds = MLNCoordinateBounds(
                sw: CLLocationCoordinate2D(latitude: minLat, longitude: minLon),
                ne: CLLocationCoordinate2D(latitude: maxLat, longitude: maxLon)
            )
            map.setVisibleCoordinateBounds(bounds, edgePadding: UIEdgeInsets(top: 80, left: 40, bottom: 380, right: 40), animated: true, completionHandler: nil)
        }

        private func reportViewport(_ map: MLNMapView) {
            let location = locationManager.location?.coordinate
            let point = location.flatMap { CLLocationCoordinate2DIsValid($0) ? GeoPoint(lat: $0.latitude, lon: $0.longitude) : nil }
            DispatchQueue.main.async { [onUserLocation] in onUserLocation(point) }
            let bounds = map.visibleCoordinateBounds
            onViewportChange(WorldBounds(west: bounds.sw.longitude, south: bounds.sw.latitude, east: bounds.ne.longitude, north: bounds.ne.latitude))
        }

        private static func points(_ items: [WorldCollectible]) -> MLNShape? {
            guard !items.isEmpty else { return nil }
            return MLNShapeCollectionFeature(shapes: items.map { item in
                let point = MLNPointFeature()
                point.coordinate = CLLocationCoordinate2D(latitude: item.latitude, longitude: item.longitude)
                point.attributes = ["id": item.id, "found": item.found]
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
