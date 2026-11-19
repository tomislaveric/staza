import MapLibre
import SwiftUI
import UIKit

struct ReplayMapView: UIViewRepresentable {
    let styleURL: URL
    let timeline: ReplayTimeline
    let currentMs: Double
    let revealed: [ReplayReveal]
    /// Off for static stills (e.g. Home), so taps fall through to the enclosing card.
    var isInteractive = true
    var palette: MapPalette = .standard

    func makeCoordinator() -> Coordinator { Coordinator(timeline: timeline, palette: palette) }

    func makeUIView(context: Context) -> MLNMapView {
        let map = MLNMapView(frame: .zero, styleURL: styleURL)
        map.delegate = context.coordinator
        map.isRotateEnabled = false
        map.isUserInteractionEnabled = isInteractive
        map.automaticallyAdjustsContentInset = false
        map.logoView.isHidden = false
        return map
    }

    func updateUIView(_ map: MLNMapView, context: Context) {
        context.coordinator.update(map: map, currentMs: currentMs, revealed: revealed)
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        private let timeline: ReplayTimeline
        private let palette: MapPalette
        private var traveled: MLNShapeSource?
        private var flowlines: MLNShapeSource?
        private var head: MLNShapeSource?
        private var items: MLNShapeSource?
        private var pending: (Double, [ReplayReveal])?
        private var lastItemCount = -1
        private var lastFlowlineCount = -1

        init(timeline: ReplayTimeline, palette: MapPalette) {
            self.timeline = timeline
            self.palette = palette
        }

        func mapView(_ map: MLNMapView, didFinishLoading style: MLNStyle) {
            let coords = timeline.route.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
            let position = palette.color(\.position)
            let outline = palette.color(\.casing)

            // Same order as the web replay: subdued full route, travelled route, Flowlines, collectibles, position.
            let routeSource = MLNShapeSource(identifier: "replay-route", shape: MLNPolyline(coordinates: coords, count: UInt(coords.count)), options: nil)
            style.addSource(routeSource)
            StazaMapLayers.addSubduedRoute(to: style, source: routeSource, id: "replay-route", palette: palette)

            let traveledSource = MLNShapeSource(identifier: "replay-traveled", shape: nil, options: nil)
            style.addSource(traveledSource)
            StazaMapLayers.addRoute(to: style, source: traveledSource, id: "replay-traveled", accent: palette.color(\.activityRoute), palette: palette)

            let flowlineSource = MLNShapeSource(identifier: "replay-flowlines", shape: nil, options: nil)
            style.addSource(flowlineSource)
            StazaMapLayers.addFlowlines(to: style, source: flowlineSource, id: "replay-flowlines", palette: palette)

            let itemSource = MLNShapeSource(identifier: "replay-items", shape: nil, options: nil)
            style.addSource(itemSource)
            CollectibleMapIcons.register(on: style)
            let gold = palette.color(\.collectibleVisited)
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
            headHalo.circleRadius = CollectibleMapIcons.zoomStops([9: 9, 15: 16])
            headHalo.circleColor = NSExpression(forConstantValue: position)
            headHalo.circleOpacity = NSExpression(forConstantValue: 0.18)
            style.addLayer(headHalo)
            let headLayer = MLNCircleStyleLayer(identifier: "replay-head-circle", source: headSource)
            headLayer.circleRadius = CollectibleMapIcons.zoomStops([9: 4, 15: 7])
            headLayer.circleColor = NSExpression(forConstantValue: palette.color(\.positionCore))
            headLayer.circleStrokeColor = NSExpression(forConstantValue: position)
            headLayer.circleStrokeWidth = NSExpression(forConstantValue: 2)
            style.addLayer(headLayer)

            traveled = traveledSource
            flowlines = flowlineSource
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
            guard let traveled, let head, let items, let flowlines else {
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
            let segments = revealed.filter { $0.kind == .flowline && $0.path.count >= 2 }
            if segments.count != lastFlowlineCount {
                lastFlowlineCount = segments.count
                flowlines.shape = MLNShapeCollectionFeature(shapes: segments.map { reveal in
                    let coords = reveal.path.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
                    let line = MLNPolylineFeature(coordinates: coords, count: UInt(coords.count))
                    line.attributes = ["completed": true]
                    return line
                })
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
