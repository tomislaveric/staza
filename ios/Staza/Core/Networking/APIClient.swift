import Foundation

struct EmptyResponse: Codable, Sendable {}

/// Async/await JSON client. Attaches bearer credentials, decodes the
/// `{ "error" }` envelope, and on 401 asks the token provider to refresh and
/// retries the request at most once.
final class APIClient: Sendable {
    private let baseURL: URL
    private let transport: HTTPTransport
    private let tokenProvider: TokenProvider
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(
        baseURL: URL,
        transport: HTTPTransport = URLSession.shared,
        tokenProvider: TokenProvider = NoTokenProvider()
    ) {
        self.baseURL = baseURL
        self.transport = transport
        self.tokenProvider = tokenProvider
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    func get<Response: Decodable>(_ path: String, query: [URLQueryItem] = [], as type: Response.Type = Response.self) async throws -> Response {
        try await perform(method: "GET", path: path, query: query, body: Optional<EmptyResponse>.none, authenticated: true)
    }

    func post<Body: Encodable, Response: Decodable>(
        _ path: String,
        body: Body,
        authenticated: Bool = true,
        as type: Response.Type = Response.self
    ) async throws -> Response {
        try await perform(method: "POST", path: path, query: [], body: body, authenticated: authenticated)
    }

    func post<Response: Decodable>(_ path: String, as type: Response.Type = Response.self) async throws -> Response {
        try await perform(method: "POST", path: path, query: [], body: Optional<EmptyResponse>.none, authenticated: true)
    }

    /// Multipart upload of a single file plus text fields. Retries once after a token refresh.
    func upload<Response: Decodable>(
        _ path: String,
        file: MultipartFile,
        fields: [String: String] = [:],
        headers: [String: String] = [:],
        progress: (@Sendable (Double) -> Void)? = nil,
        as type: Response.Type = Response.self
    ) async throws -> Response {
        let multipart = MultipartBody(file: file, fields: fields)
        func attempt(token: String?) async throws -> Response {
            var request = try makeRequest(method: "POST", path: path, query: [], body: Optional<EmptyResponse>.none, token: token)
            request.setValue(multipart.contentType, forHTTPHeaderField: "Content-Type")
            for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
            request.httpBody = multipart.data
            return try await execute(request, progress: progress)
        }
        let token = await tokenProvider.accessToken()
        do {
            return try await attempt(token: token)
        } catch APIError.unauthorized(let message) {
            guard token != nil, let refreshed = await tokenProvider.refreshAfterUnauthorized(rejectedToken: token) else {
                throw APIError.unauthorized(message: message)
            }
            do {
                return try await attempt(token: refreshed)
            } catch APIError.unauthorized(let retryMessage) {
                await tokenProvider.sessionRejected()
                throw APIError.unauthorized(message: retryMessage)
            }
        }
    }

    func delete(_ path: String) async throws {
        let _: EmptyResponse = try await perform(method: "DELETE", path: path, query: [], body: Optional<EmptyResponse>.none, authenticated: true)
    }

    private func perform<Body: Encodable, Response: Decodable>(
        method: String,
        path: String,
        query: [URLQueryItem],
        body: Body?,
        authenticated: Bool
    ) async throws -> Response {
        let token = authenticated ? await tokenProvider.accessToken() : nil
        let request = try makeRequest(method: method, path: path, query: query, body: body, token: token)
        do {
            return try await execute(request)
        } catch APIError.unauthorized(let message) where authenticated {
            // A 401 without a token being sent means we are signed out; nothing to refresh.
            guard token != nil else { throw APIError.unauthorized(message: message) }
            guard let refreshed = await tokenProvider.refreshAfterUnauthorized(rejectedToken: token) else {
                throw APIError.unauthorized(message: message)
            }
            let retry = try makeRequest(method: method, path: path, query: query, body: body, token: refreshed)
            do {
                return try await execute(retry)
            } catch APIError.unauthorized(let retryMessage) {
                await tokenProvider.sessionRejected()
                throw APIError.unauthorized(message: retryMessage)
            }
        }
    }

    private func makeRequest<Body: Encodable>(
        method: String,
        path: String,
        query: [URLQueryItem],
        body: Body?,
        token: String?
    ) throws -> URLRequest {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)
        if !query.isEmpty { components?.queryItems = query }
        guard let url = components?.url else { throw APIError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("native", forHTTPHeaderField: "X-Staza-Client")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(body)
        }
        return request
    }

    private func execute<Response: Decodable>(_ request: URLRequest, progress: (@Sendable (Double) -> Void)? = nil) async throws -> Response {
        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await transport.send(request, progress: progress)
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.transport(error.localizedDescription)
        }

        guard (200..<300).contains(http.statusCode) else {
            let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data)
            if http.statusCode == 401 { throw APIError.unauthorized(message: envelope?.error) }
            throw APIError.server(
                status: http.statusCode,
                message: envelope?.error ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode),
                code: envelope?.code
            )
        }
        if data.isEmpty || http.statusCode == 204, let empty = EmptyResponse() as? Response { return empty }
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }
}
