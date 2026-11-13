import Foundation

/// Abstraction over URLSession so tests can stub the network.
protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
    /// `progress` reports the fraction (0...1) of the request body sent.
    func send(_ request: URLRequest, progress: (@Sendable (Double) -> Void)?) async throws -> (Data, HTTPURLResponse)
}

extension HTTPTransport {
    func send(_ request: URLRequest, progress: (@Sendable (Double) -> Void)?) async throws -> (Data, HTTPURLResponse) {
        try await send(request)
    }
}

private final class UploadProgressDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    let handler: @Sendable (Double) -> Void
    init(_ handler: @escaping @Sendable (Double) -> Void) { self.handler = handler }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard totalBytesExpectedToSend > 0 else { return }
        handler(Double(totalBytesSent) / Double(totalBytesExpectedToSend))
    }
}

extension URLSession: HTTPTransport {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        return (data, http)
    }

    func send(_ request: URLRequest, progress: (@Sendable (Double) -> Void)?) async throws -> (Data, HTTPURLResponse) {
        let delegate = progress.map(UploadProgressDelegate.init)
        let (data, response) = try await data(for: request, delegate: delegate)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        return (data, http)
    }
}
