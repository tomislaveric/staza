import Foundation

/// Deployment origin the app talks to. Override at runtime with the
/// `STAZA_API_BASE_URL` environment variable (useful for simulators/tests).
enum APIEnvironment: String, Sendable {
    case development
    case production

    var baseURL: URL {
        switch self {
        case .development: URL(string: "http://localhost:3000")!
        case .production: URL(string: "https://play.staza.world")!
        }
    }

    static var current: APIEnvironment {
        #if DEBUG
        .development
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
