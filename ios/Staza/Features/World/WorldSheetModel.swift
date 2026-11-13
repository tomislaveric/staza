import Foundation
import Observation

/// What the World bottom sheet shows, and how far it is expanded.
@MainActor
@Observable
final class WorldSheetModel {
    enum Mode: Equatable {
        case browse
        case explore
        case detail(WorldSelection)
    }

    var detent = StazaSheetDetent.peek
    private(set) var mode = Mode.browse
    /// Mode to return to when a detail is closed.
    private var underlying = Mode.browse

    var selection: WorldSelection? {
        if case .detail(let selection) = mode { return selection }
        return nil
    }

    func showDetail(_ selection: WorldSelection) {
        if case .detail = mode {} else { underlying = mode }
        mode = .detail(selection)
        if detent == .peek { detent = .medium }
    }

    func closeDetail() {
        guard case .detail = mode else { return }
        mode = underlying
    }

    func startExplore() {
        underlying = .explore
        mode = .explore
        detent = .medium
    }

    /// Explore ended (cancelled or confirmed); a detail opened on top of it stays open.
    func endExplore() {
        underlying = .browse
        if mode == .explore {
            mode = .browse
            detent = .medium
        }
    }

    /// Collapses the sheet so a newly drawn route is visible above it.
    func revealMap() {
        if detent == .large { detent = .medium }
    }
}
