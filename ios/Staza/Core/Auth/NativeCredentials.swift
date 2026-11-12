import Foundation

/// Credentials returned by the backend for native clients (`X-Staza-Client: native`).
struct NativeCredentials: Codable, Equatable, Sendable {
    let tokenType: String
    let accessToken: String
    let accessTokenExpiresAt: Date
    let refreshToken: String
    let refreshTokenExpiresAt: Date

    init(
        tokenType: String = "Bearer",
        accessToken: String,
        accessTokenExpiresAt: Date,
        refreshToken: String,
        refreshTokenExpiresAt: Date
    ) {
        self.tokenType = tokenType
        self.accessToken = accessToken
        self.accessTokenExpiresAt = accessTokenExpiresAt
        self.refreshToken = refreshToken
        self.refreshTokenExpiresAt = refreshTokenExpiresAt
    }

    private enum CodingKeys: String, CodingKey {
        case tokenType, accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        tokenType = try container.decodeIfPresent(String.self, forKey: .tokenType) ?? "Bearer"
        accessToken = try container.decode(String.self, forKey: .accessToken)
        refreshToken = try container.decode(String.self, forKey: .refreshToken)
        accessTokenExpiresAt = try Self.decodeDate(container, .accessTokenExpiresAt)
        refreshTokenExpiresAt = try Self.decodeDate(container, .refreshTokenExpiresAt)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(tokenType, forKey: .tokenType)
        try container.encode(accessToken, forKey: .accessToken)
        try container.encode(refreshToken, forKey: .refreshToken)
        try container.encode(Self.format(accessTokenExpiresAt), forKey: .accessTokenExpiresAt)
        try container.encode(Self.format(refreshTokenExpiresAt), forKey: .refreshTokenExpiresAt)
    }

    var refreshTokenIsExpired: Bool { refreshTokenExpiresAt <= Date() }

    private static func decodeDate(_ container: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys) throws -> Date {
        let raw = try container.decode(String.self, forKey: key)
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: raw) ?? ISO8601DateFormatter().date(from: raw) { return date }
        throw DecodingError.dataCorruptedError(forKey: key, in: container, debugDescription: "Invalid ISO-8601 date: \(raw)")
    }

    private static func format(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

struct SessionUser: Codable, Equatable, Sendable {
    let email: String
    let emailVerified: Bool
}

/// `GET /api/auth/session`
struct SessionResponse: Decodable, Sendable {
    let authenticated: Bool
    let user: SessionUser?
}

struct RefreshRequest: Encodable, Sendable { let refreshToken: String }
struct RefreshResponse: Decodable, Sendable { let credentials: NativeCredentials }
