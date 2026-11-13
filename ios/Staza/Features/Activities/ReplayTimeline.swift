import Foundation

struct ReplayTrackPoint: Decodable, Equatable, Sendable {
    let latitude: Double
    let longitude: Double
    let timestampMs: Double
}

struct ReplayFlowline: Decodable, Equatable, Sendable {
    let fartlekName: String
    let completedAtTimestampMs: Double
}

struct ReplayCoordinate: Equatable, Sendable {
    let latitude: Double
    let longitude: Double
}

struct ReplayReveal: Equatable, Identifiable, Sendable {
    enum Kind: Equatable, Sendable { case collectible, flowline }
    let id: String
    let name: String
    let kind: Kind
    let isRepeat: Bool
    let timestampMs: Double
    let coordinate: ReplayCoordinate?
    var category: String? = nil
}

/// Timestamp-driven replay state derived from the activity track and its events.
struct ReplayTimeline: Equatable, Sendable {
    let route: [ReplayTrackPoint]
    let reveals: [ReplayReveal]

    var startMs: Double { route.first?.timestampMs ?? 0 }
    var endMs: Double { route.last?.timestampMs ?? 0 }
    var durationMs: Double { max(0, endMs - startMs) }
    var isPlayable: Bool { route.count >= 2 && durationMs > 0 }

    init(route: [ReplayTrackPoint], reveals: [ReplayReveal]) {
        let sorted = route.sorted { $0.timestampMs < $1.timestampMs }
        self.route = sorted
        self.reveals = reveals.sorted { $0.timestampMs < $1.timestampMs }
    }

    init?(detail: ActivityDetail) {
        guard let route = detail.replay?.activity?.route, route.count >= 2 else { return nil }
        let events = detail.events.compactMap { event -> ReplayReveal? in
            guard let ts = event.activityTimestamp else { return nil }
            var coordinate: ReplayCoordinate?
            if let lat = event.latitude, let lon = event.longitude { coordinate = ReplayCoordinate(latitude: lat, longitude: lon) }
            return ReplayReveal(id: event.id, name: event.collectible.name, kind: .collectible,
                                isRepeat: event.isRepeat, timestampMs: ts, coordinate: coordinate, category: event.category)
        }
        let flowlines = (detail.replay?.activityResult?.fartlekCompletions ?? []).enumerated().map { index, item in
            ReplayReveal(id: "flowline-\(index)", name: item.fartlekName, kind: .flowline,
                         isRepeat: false, timestampMs: item.completedAtTimestampMs, coordinate: nil)
        }
        self.init(route: route, reveals: events + flowlines)
    }

    func absoluteTime(progress: Double) -> Double {
        startMs + durationMs * min(max(progress, 0), 1)
    }

    /// Interpolated position along the track at the given absolute time.
    func position(atMs time: Double) -> ReplayCoordinate? {
        guard let first = route.first, let last = route.last else { return nil }
        if time <= first.timestampMs { return ReplayCoordinate(latitude: first.latitude, longitude: first.longitude) }
        if time >= last.timestampMs { return ReplayCoordinate(latitude: last.latitude, longitude: last.longitude) }
        var low = 0, high = route.count - 1
        while high - low > 1 {
            let mid = (low + high) / 2
            if route[mid].timestampMs <= time { low = mid } else { high = mid }
        }
        let a = route[low], b = route[high]
        let span = b.timestampMs - a.timestampMs
        let f = span > 0 ? (time - a.timestampMs) / span : 0
        return ReplayCoordinate(latitude: a.latitude + (b.latitude - a.latitude) * f,
                                longitude: a.longitude + (b.longitude - a.longitude) * f)
    }

    /// Route points already travelled at `time`, ending at the interpolated position.
    func traveled(atMs time: Double) -> [ReplayCoordinate] {
        var points = route.prefix { $0.timestampMs <= time }.map { ReplayCoordinate(latitude: $0.latitude, longitude: $0.longitude) }
        if let current = position(atMs: time), points.last != current { points.append(current) }
        return points
    }

    func revealed(atMs time: Double) -> [ReplayReveal] {
        reveals.filter { $0.timestampMs <= time }
    }
}
