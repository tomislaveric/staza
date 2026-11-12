import Foundation
@testable import Staza

final class StubTransport: HTTPTransport, @unchecked Sendable {
    struct Stub { let status: Int; let body: String }
    private let lock = NSLock()
    private var stubs: [Stub]
    private(set) var requests: [URLRequest] = []

    init(_ stubs: [Stub]) { self.stubs = stubs }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let stub: Stub = lock.withLock {
            requests.append(request)
            return stubs.isEmpty ? Stub(status: 500, body: "{}") : stubs.removeFirst()
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: stub.status, httpVersion: nil, headerFields: nil)!
        return (Data(stub.body.utf8), response)
    }

    func authorization(at index: Int) -> String? { requests[index].value(forHTTPHeaderField: "Authorization") }
}

final class MemoryCredentialStore: CredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var value: NativeCredentials?
    init(_ value: NativeCredentials? = nil) { self.value = value }
    func load() -> NativeCredentials? { lock.withLock { value } }
    func save(_ credentials: NativeCredentials) throws { lock.withLock { value = credentials } }
    func clear() { lock.withLock { value = nil } }
}

func makeCredentials(access: String = "access-1", refresh: String = "refresh-1", refreshExpiresIn: TimeInterval = 3600) -> NativeCredentials {
    NativeCredentials(
        accessToken: access,
        accessTokenExpiresAt: Date().addingTimeInterval(900),
        refreshToken: refresh,
        refreshTokenExpiresAt: Date().addingTimeInterval(refreshExpiresIn)
    )
}

func credentialsJSON(access: String, refresh: String) -> String {
    #"{"credentials":{"tokenType":"Bearer","accessToken":"\#(access)","accessTokenExpiresAt":"2030-01-01T00:00:00.000Z","refreshToken":"\#(refresh)","refreshTokenExpiresAt":"2030-02-01T00:00:00Z"}}"#
}

let baseURL = URL(string: "https://example.test")!
struct Ping: Decodable, Equatable { let ok: Bool }
struct Echo: Encodable { let name: String }
