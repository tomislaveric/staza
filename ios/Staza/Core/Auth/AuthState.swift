import Foundation
import Observation

/// Observable signed-in/signed-out state for SwiftUI.
@MainActor
@Observable
final class AuthState {
    enum Status: Equatable {
        case restoring
        case signedOut
        case signedIn
    }

    private(set) var status: Status = .restoring
    private(set) var user: SessionUser?

    var isSignedIn: Bool { status == .signedIn }

    func update(status: Status, user: SessionUser?) {
        self.status = status
        self.user = status == .signedIn ? user : nil
    }
}
