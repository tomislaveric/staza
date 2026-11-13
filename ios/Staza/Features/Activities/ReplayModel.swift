import Foundation
import Observation

struct Basemap: Decodable, Equatable, Sendable {
    let styleUrl: String
    let attribution: String?
}

@MainActor
@Observable
final class ReplayModel {
    static let playbackSeconds = 30.0

    let timeline: ReplayTimeline
    private(set) var basemap: Basemap?
    private(set) var basemapFailed = false
    private(set) var isPlaying = false
    var progress: Double = 0

    private let api: APIClient
    private var task: Task<Void, Never>?

    init(api: APIClient, timeline: ReplayTimeline) {
        self.api = api
        self.timeline = timeline
    }

    var currentMs: Double { timeline.absoluteTime(progress: progress) }
    var revealed: [ReplayReveal] { timeline.revealed(atMs: currentMs) }
    var isFinished: Bool { progress >= 1 }

    func loadBasemap() async {
        guard basemap == nil else { return }
        do {
            basemap = try await api.get("/api/world/basemap")
            basemapFailed = false
        } catch is CancellationError {
            return
        } catch {
            basemapFailed = true
        }
    }

    func play() {
        guard timeline.isPlayable, !isPlaying else { return }
        if isFinished { progress = 0 }
        isPlaying = true
        task = Task { [weak self] in
            let step = 1.0 / 30.0
            while let self, self.isPlaying, !Task.isCancelled {
                try? await Task.sleep(for: .seconds(step))
                guard self.isPlaying else { return }
                self.advance(by: step / Self.playbackSeconds)
            }
        }
    }

    func pause() {
        isPlaying = false
        task?.cancel()
        task = nil
    }

    func toggle() { isPlaying ? pause() : play() }

    func scrub(to value: Double) {
        progress = min(max(value, 0), 1)
    }

    func advance(by delta: Double) {
        progress = min(progress + delta, 1)
        if progress >= 1 { pause() }
    }
}
