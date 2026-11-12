import Foundation

/// The standard backend error envelope: `{ "error": "...", "code"?: "..." }`.
struct APIErrorEnvelope: Decodable, Equatable, Sendable {
    let error: String
    let code: String?
}

enum APIError: Error, Equatable, LocalizedError {
    case invalidResponse
    case unauthorized(message: String?)
    case server(status: Int, message: String, code: String?)
    case decoding(String)
    case transport(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: "The server returned an invalid response."
        case .unauthorized(let message): message ?? "Sign in is required."
        case .server(_, let message, _): message
        case .decoding(let detail): "The response could not be read: \(detail)"
        case .transport(let detail): detail
        }
    }
}
