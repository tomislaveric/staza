import Foundation
import Observation

/// What the World bottom sheet shows, and how far it is expanded.
@MainActor
@Observable
final class WorldSheetModel {
    enum Mode: Equatable {
        case browse
        /// "View discoveries": what the visible area holds, with its revealed Flowlines.
        case discoveries
        /// The manual "Plan a route" planner.
        case planner
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

    /// Discoveries never replace the planner; while planning they open from the planner's detail instead.
    func showDiscoveries() {
        guard underlying != .planner, mode != .planner else { return }
        underlying = .discoveries
        mode = .discoveries
        if detent == .peek { detent = .medium }
    }

    func closeDiscoveries() {
        underlying = .browse
        if mode == .discoveries { mode = .browse }
    }

    func startPlanner() {
        underlying = .planner
        mode = .planner
        detent = .medium
    }

    /// The planner closed (cancelled or confirmed); a detail opened on top of it stays open.
    func endPlanner() {
        underlying = .browse
        if mode == .planner {
            mode = .browse
            detent = .medium
        }
    }

    /// Collapses the sheet so a newly drawn route or framed Flowline is visible above it.
    func revealMap() {
        if detent == .large { detent = .medium }
    }
}
