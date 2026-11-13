import MapLibre
import SwiftUI
import UIKit

struct ReplayMapView: UIViewRepresentable {
    let styleURL: URL
    let timeline: ReplayTimeline
    let currentMs: Double
    let revealed: [ReplayReveal]

    func makeCoordinator() -> Coordinator { Coordinator(timeline: timeline) }

    func makeUIView(context: Context) -> MLNMapView {
        let map = MLNMapView(frame: .zero, styleURL: styleURL)
        map.delegate = context.coordinator
        map.isRotateEnabled = false
        map.automaticallyAdjustsContentInset = false
        map.logoView.isHidden = false
        return map
    }

    func updateUIView(_ map: MLNMapView, context: Context) {
        context.coordinator.update(map: map, currentMs: currentMs, revealed: revealed)
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        private let timeline: ReplayTimeline
        private var traveled: MLNShapeSource?
        private var head: MLNShapeSource?
        private var items: MLNShapeSource?
        private var pending: (Double, [ReplayReveal])?
        private var lastItemCount = -1

        init(timeline: ReplayTimeline) { self.timeline = timeline }

        func mapView(_ map: MLNMapView, didFinishLoading style: MLNStyle) {
            let coords = timeline.route.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
            let accent = UIColor(StazaColor.route)
            let untravelled = UIColor(StazaColor.textSubtle)
            let outline = UIColor(StazaColor.canvas)

            let routeSource = MLNShapeSource(identifier: "replay-route", shape: MLNPolyline(coordinates: coords, count: UInt(coords.count)), options: nil)
            style.addSource(routeSource)
            let routeLayer = MLNLineStyleLayer(identifier: "replay-route-line", source: routeSource)
            routeLayer.lineColor = NSExpression(forConstantValue: untravelled.withAlphaComponent(0.7))
            routeLayer.lineWidth = NSExpression(forConstantValue: 4)
            routeLayer.lineCap = NSExpression(forConstantValue: "round")
            routeLayer.lineJoin = NSExpression(forConstantValue: "round")
            style.addLayer(routeLayer)

            let traveledSource = MLNShapeSource(identifier: "replay-traveled", shape: nil, options: nil)
            style.addSource(traveledSource)
            let traveledLayer = MLNLineStyleLayer(identifier: "replay-traveled-line", source: traveledSource)
            traveledLayer.lineColor = NSExpression(forConstantValue: accent)
            traveledLayer.lineWidth = NSExpression(forConstantValue: 5)
            traveledLayer.lineCap = NSExpression(forConstantValue: "round")
            traveledLayer.lineJoin = NSExpression(forConstantValue: "round")
            style.addLayer(traveledLayer)

            let itemSource = MLNShapeSource(identifier: "replay-items", shape: nil, options: nil)
            style.addSource(itemSource)
            CollectibleMapIcons.register(on: style)
            let gold = CollectibleMapIcons.foundColor
            let haloLayer = MLNCircleStyleLayer(identifier: "replay-items-halo", source: itemSource)
            haloLayer.circleRadius = CollectibleMapIcons.zoomStops([9: 13, 12: 16, 15: 19, 17: 22])
            haloLayer.circleColor = NSExpression(forConstantValue: gold)
            haloLayer.circleOpacity = NSExpression(forConstantValue: 0.12)
            haloLayer.circleStrokeWidth = NSExpression(forConstantValue: 1.5)
            haloLayer.circleStrokeColor = NSExpression(forConstantValue: gold)
            haloLayer.circleStrokeOpacity = NSExpression(forConstantValue: 0.6)
            style.addLayer(haloLayer)
            let itemLayer = MLNCircleStyleLayer(identifier: "replay-items-circle", source: itemSource)
            itemLayer.predicate = NSPredicate(format: "icon == ''")
            itemLayer.circleRadius = CollectibleMapIcons.circleRadius
            itemLayer.circleColor = NSExpression(forConstantValue: gold)
            itemLayer.circleStrokeColor = NSExpression(forConstantValue: outline)
            itemLayer.circleStrokeWidth = CollectibleMapIcons.zoomStops([9: 1, 12: 1.4, 15: 1.8, 17: 2])
            style.addLayer(itemLayer)
            let iconLayer = MLNSymbolStyleLayer(identifier: "replay-items-icon", source: itemSource)
            iconLayer.predicate = NSPredicate(format: "icon != ''")
            iconLayer.iconImageName = NSExpression(forKeyPath: "icon")
            iconLayer.iconScale = CollectibleMapIcons.iconScale
            iconLayer.iconAllowsOverlap = NSExpression(forConstantValue: true)
            iconLayer.iconIgnoresPlacement = NSExpression(forConstantValue: true)
            style.addLayer(iconLayer)

            let headSource = MLNShapeSource(identifier: "replay-head", shape: nil, options: nil)
            style.addSource(headSource)
            let headHalo = MLNCircleStyleLayer(identifier: "replay-head-halo", source: headSource)
            headHalo.circleRadius = NSExpression(forConstantValue: 18)
            headHalo.circleColor = NSExpression(forConstantValue: accent.withAlphaComponent(0.25))
            style.addLayer(headHalo)
            let headLayer = MLNCircleStyleLayer(identifier: "replay-head-circle", source: headSource)
            headLayer.circleRadius = NSExpression(forConstantValue: 8)
            headLayer.circleColor = NSExpression(forConstantValue: accent)
            headLayer.circleStrokeColor = NSExpression(forConstantValue: outline)
            headLayer.circleStrokeWidth = NSExpression(forConstantValue: 3)
            style.addLayer(headLayer)

            traveled = traveledSource
            head = headSource
            items = itemSource

            let bounds = coords.reduce(into: MLNCoordinateBounds(sw: coords[0], ne: coords[0])) { b, c in
                b.sw = CLLocationCoordinate2D(latitude: min(b.sw.latitude, c.latitude), longitude: min(b.sw.longitude, c.longitude))
                b.ne = CLLocationCoordinate2D(latitude: max(b.ne.latitude, c.latitude), longitude: max(b.ne.longitude, c.longitude))
            }
            let camera = map.cameraThatFitsCoordinateBounds(bounds, edgePadding: UIEdgeInsets(top: 40, left: 40, bottom: 40, right: 40))
            map.setCamera(camera, animated: false)

            if let pending { update(map: map, currentMs: pending.0, revealed: pending.1) }
        }

        func update(map: MLNMapView, currentMs: Double, revealed: [ReplayReveal]) {
            guard let traveled, let head, let items else {
                pending = (currentMs, revealed)
                return
            }
            let path = timeline.traveled(atMs: currentMs).map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
            traveled.shape = path.count >= 2 ? MLNPolyline(coordinates: path, count: UInt(path.count)) : nil
            if let last = path.last {
                let point = MLNPointFeature()
                point.coordinate = last
                head.shape = point
            } else {
                head.shape = nil
            }
            let located = revealed.filter { $0.coordinate != nil }
            if located.count != lastItemCount {
                lastItemCount = located.count
                items.shape = MLNShapeCollectionFeature(shapes: located.map { reveal in
                    let point = MLNPointFeature()
                    point.coordinate = CLLocationCoordinate2D(latitude: reveal.coordinate!.latitude, longitude: reveal.coordinate!.longitude)
                    point.attributes = ["icon": CollectibleMapIcons.imageName(category: reveal.category, found: true) ?? ""]
                    return point
                })
            }
        }
    }
}
