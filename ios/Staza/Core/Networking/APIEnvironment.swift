import Foundation

/// Deployment origin the app talks to. Debug builds use the local server in the
/// simulator and the DEV stage on a device (where localhost is the phone itself).
/// Override at runtime with the `STAZA_API_BASE_URL` environment variable.
enum APIEnvironment: String, Sendable {
    case development
    case devStage
    case production

    var baseURL: URL {
        switch self {
        case .development: URL(string: "http://localhost:3000")!
        case .devStage: URL(string: "https://dev.play.staza.world")!
        case .production: URL(string: "https://play.staza.world")!
        }
    }

    static var current: APIEnvironment {
        #if DEBUG && targetEnvironment(simulator)
        .development
        #elseif DEBUG
        .devStage
        #else
        .production
        #endif
    }

    static func resolvedBaseURL(
        environment: APIEnvironment = .current,
        processEnvironment: [String: String] = ProcessInfo.processInfo.environment
    ) -> URL {
        if let override = processEnvironment["STAZA_API_BASE_URL"], let url = URL(string: override), url.scheme != nil {
            return url
        }
        return environment.baseURL
    }
}
