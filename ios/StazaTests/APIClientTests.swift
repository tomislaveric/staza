import XCTest
@testable import Staza

final class APIClientTests: XCTestCase {
    private struct FixedToken: TokenProvider {
        var token: String? = "tok"
        func accessToken() async -> String? { token }
        func refreshAfterUnauthorized(rejectedToken: String?) async -> String? { nil }
        func sessionRejected() async {}
    }

    func testGetAttachesBearerAndDecodes() async throws {
        let transport = StubTransport([.init(status: 200, body: #"{"ok":true}"#)])
        let client = APIClient(baseURL: baseURL, transport: transport, tokenProvider: FixedToken())
        let result: Ping = try await client.get("/api/ping", query: [URLQueryItem(name: "a", value: "1")])
        XCTAssertEqual(result, Ping(ok: true))
        XCTAssertEqual(transport.authorization(at: 0), "Bearer tok")
        XCTAssertEqual(transport.requests[0].url?.absoluteString, "https://example.test/api/ping?a=1")
        XCTAssertEqual(transport.requests[0].httpMethod, "GET")
    }

    func testPostSendsJSONBody() async throws {
        let transport = StubTransport([.init(status: 200, body: #"{"ok":true}"#)])
        let client = APIClient(baseURL: baseURL, transport: transport, tokenProvider: FixedToken())
        let _: Ping = try await client.post("/api/x", body: Echo(name: "n"))
        XCTAssertEqual(transport.requests[0].httpMethod, "POST")
        XCTAssertEqual(transport.requests[0].value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(String(data: transport.requests[0].httpBody!, encoding: .utf8), #"{"name":"n"}"#)
    }

    func testErrorEnvelopeIsDecoded() async {
        let transport = StubTransport([.init(status: 409, body: #"{"error":"Duplicate.","code":"duplicate"}"#)])
        let client = APIClient(baseURL: baseURL, transport: transport, tokenProvider: FixedToken())
        do {
            let _: Ping = try await client.get("/api/x")
            XCTFail("expected error")
        } catch {
            XCTAssertEqual(error as? APIError, .server(status: 409, message: "Duplicate.", code: "duplicate"))
        }
    }

    func testEmptyBodyDecodesToEmptyResponse() async throws {
        let transport = StubTransport([.init(status: 204, body: "")])
        let client = APIClient(baseURL: baseURL, transport: transport, tokenProvider: FixedToken())
        let _: EmptyResponse = try await client.post("/api/auth/logout")
    }

    func testUnauthorizedWithoutTokenDoesNotRetry() async {
        let transport = StubTransport([.init(status: 401, body: #"{"error":"Sign in is required."}"#)])
        let client = APIClient(baseURL: baseURL, transport: transport, tokenProvider: FixedToken(token: nil))
        do {
            let _: Ping = try await client.get("/api/x")
            XCTFail("expected error")
        } catch {
            XCTAssertEqual(error as? APIError, .unauthorized(message: "Sign in is required."))
            XCTAssertEqual(transport.requests.count, 1)
        }
    }
}
