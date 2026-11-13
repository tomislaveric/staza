import CoreLocation
import MapLibre
import SwiftUI
import UIKit

struct WorldMapView: UIViewRepresentable {
    let styleURL: URL
    let collectibles: [WorldCollectible]
    let flowlines: [WorldFlowline]
    let questTargets: QuestTargets
    let onViewportChange: (WorldBounds) -> Void
    let onSelect: (WorldSelectionKind, String) -> Void

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
        coordinator.data = (collectibles, flowlines, questTargets)
        coordinator.refresh()
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        var onViewportChange: (WorldBounds) -> Void = { _ in }
        var onSelect: (WorldSelectionKind, String) -> Void = { _, _ in }
        var data: (collectibles: [WorldCollectible], flowlines: [WorldFlowline], quest: QuestTargets) = ([], [], .empty)

        private let locationManager = CLLocationManager()
        private var collectibleSource: MLNShapeSource?
        private var flowlineSource: MLNShapeSource?
        private var questSource: MLNShapeSource?
        private var questFlowlineSource: MLNShapeSource?

        func requestLocationAccess() {
            if locationManager.authorizationStatus == .notDetermined {
                locationManager.requestWhenInUseAuthorization()
            }
        }

        func mapView(_ map: MLNMapView, didFinishLoading style: MLNStyle) {
            let accent = UIColor(StazaColor.accent)
            let white = UIColor.white

            let flowlines = MLNShapeSource(identifier: "world-flowlines", shape: nil, options: nil)
            style.addSource(flowlines)
            let flowlineLayer = MLNLineStyleLayer(identifier: "world-flowlines-line", source: flowlines)
            flowlineLayer.lineColor = NSExpression(forConstantValue: UIColor.systemBlue)
            flowlineLayer.lineWidth = NSExpression(forConstantValue: 3)
            flowlineLayer.lineOpacity = NSExpression(forConstantValue: 0.8)
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
            for (id, found, color) in [("unfound", false, UIColor.systemOrange), ("found", true, UIColor.systemYellow)] {
                let layer = MLNCircleStyleLayer(identifier: "world-collectibles-\(id)", source: collectibles)
                layer.predicate = NSPredicate(format: "found == %@", NSNumber(value: found))
                layer.circleRadius = NSExpression(forConstantValue: 7)
                layer.circleColor = NSExpression(forConstantValue: color)
                layer.circleStrokeColor = NSExpression(forConstantValue: white)
                layer.circleStrokeWidth = NSExpression(forConstantValue: 2)
                style.addLayer(layer)
            }

            let quest = MLNShapeSource(identifier: "world-quest-collectibles", shape: nil, options: nil)
            style.addSource(quest)
            let questLayer = MLNCircleStyleLayer(identifier: "world-quest-collectibles-circle", source: quest)
            questLayer.circleRadius = NSExpression(forConstantValue: 9)
            questLayer.circleColor = NSExpression(forConstantValue: accent)
            questLayer.circleStrokeColor = NSExpression(forConstantValue: white)
            questLayer.circleStrokeWidth = NSExpression(forConstantValue: 3)
            style.addLayer(questLayer)

            collectibleSource = collectibles
            flowlineSource = flowlines
            questSource = quest
            questFlowlineSource = questFlowlines
            refresh()
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

        private func reportViewport(_ map: MLNMapView) {
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
