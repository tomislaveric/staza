import AuthenticationServices
import Foundation
import Observation
import UIKit

struct StravaStatusResponse: Decodable, Equatable, Sendable {
    let enabled: Bool
    let status: String
}

struct StravaRecentActivity: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let sportType: String?
    let activityType: String
    let startDate: String?
    let distanceMeters: Double?
    let movingTimeSeconds: Double?
    let beforeJourneyStart: Bool
    let importedActivityId: String?

    var isImported: Bool { importedActivityId != nil }
}

struct StravaRecentActivitiesResponse: Decodable, Equatable, Sendable {
    let activities: [StravaRecentActivity]
}

private struct AuthorizeRequest: Encodable { let locale: String; let client = "native" }
private struct AuthorizeResponse: Decodable { let authorizationUrl: String }
private struct NativeCompleteRequest: Encodable { let code: String; let state: String; let scope: String? }
private struct NativeCompleteResponse: Decodable { let outcome: String }

enum StravaAuthError: Error, Equatable {
    case cancelled
    case failed(String)
}

/// Boundary around `ASWebAuthenticationSession` so the flow can be tested.
@MainActor
protocol StravaWebAuthenticating {
    /// Returns the callback URL once the system browser redirects to `callbackScheme`.
    func authenticate(url: URL, callbackScheme: String) async throws -> URL
}

@MainActor
final class SystemStravaWebAuthenticator: NSObject, StravaWebAuthenticating, ASWebAuthenticationPresentationContextProviding {
    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { callback, error in
                if let callback {
                    continuation.resume(returning: callback)
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    continuation.resume(throwing: StravaAuthError.cancelled)
                } else {
                    continuation.resume(throwing: StravaAuthError.failed(error?.localizedDescription ?? "Strava sign-in failed."))
                }
            }
            session.presentationContextProvider = self
            if !session.start() { continuation.resume(throwing: StravaAuthError.failed("Strava sign-in could not start.")) }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        return scene?.keyWindow ?? ASPresentationAnchor()
    }
}

@MainActor
@Observable
final class StravaImportModel {
    enum State: Equatable {
        case loading
        case disabled
        case disconnected(message: StravaMessage?)
        case connecting
        case connected([StravaRecentActivity])
        case failed(String)
    }

    enum StravaMessage: Equatable {
        case denied, missingScope, error
    }

    static let callbackScheme = "staza"

    private(set) var state: State = .loading
    private(set) var importingID: String?
    private(set) var importError: String?
    private(set) var imported: ActivityHistoryItem?
    private let api: APIClient
    private let authenticator: StravaWebAuthenticating
    private let locale: String

    init(api: APIClient, authenticator: StravaWebAuthenticating, locale: String = Locale.current.language.languageCode?.identifier == "de" ? "de" : "en") {
        self.api = api
        self.authenticator = authenticator
        self.locale = locale
    }

    var isBusy: Bool { state == .connecting || importingID != nil }

    func load() async {
        state = .loading
        do {
            let status: StravaStatusResponse = try await api.get("/api/integrations/strava")
            guard status.enabled else { state = .disabled; return }
            if status.status == "connected" {
                await loadActivities()
            } else {
                state = .disconnected(message: status.status == "reconnect_required" ? .error : nil)
            }
        } catch {
            state = .failed(describe(error))
        }
    }

    func connect() async {
        guard !isBusy else { return }
        state = .connecting
        do {
            let authorize: AuthorizeResponse = try await api.post(
                "/api/integrations/strava/authorize",
                body: AuthorizeRequest(locale: locale)
            )
            guard let url = URL(string: authorize.authorizationUrl) else { throw APIError.invalidResponse }
            let callback = try await authenticator.authenticate(url: url, callbackScheme: Self.callbackScheme)
            let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
            func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
            var outcome = value("outcome")
            // The browser only hands the code back; this session completes the link so it cannot be
            // finished on behalf of another account.
            if outcome == nil, let code = value("code"), let state = value("state") {
                let completion: NativeCompleteResponse = try await api.post(
                    "/api/integrations/strava/native/complete",
                    body: NativeCompleteRequest(code: code, state: state, scope: value("scope"))
                )
                outcome = completion.outcome
            }
            switch outcome {
            case "connected": await loadActivities()
            case "denied": state = .disconnected(message: .denied)
            case "missing_scope": state = .disconnected(message: .missingScope)
            default: state = .disconnected(message: .error)
            }
        } catch StravaAuthError.cancelled {
            state = .disconnected(message: nil)
        } catch {
            state = .failed(describe(error))
        }
    }

    func loadActivities() async {
        do {
            let response: StravaRecentActivitiesResponse = try await api.get("/api/integrations/strava/activities")
            state = .connected(response.activities)
        } catch let APIError.server(_, _, code) where code == "reconnect_required" || code == "not_connected" {
            state = .disconnected(message: code == "reconnect_required" ? .error : nil)
        } catch {
            state = .failed(describe(error))
        }
    }

    func importActivity(_ activity: StravaRecentActivity) async {
        guard importingID == nil else { return }
        importingID = activity.id
        importError = nil
        defer { importingID = nil }
        do {
            let response: ImportedActivityResponse = try await api.post("/api/integrations/strava/activities/\(activity.id)/import", as: ImportedActivityResponse.self)
            imported = try await api.get("/api/activities/\(response.activity.id)", as: ActivityHistoryItem.self)
            await loadActivities()
        } catch {
            importError = describe(error)
        }
    }

    func disconnect() async {
        guard !isBusy else { return }
        do {
            try await api.delete("/api/integrations/strava")
            state = .disconnected(message: nil)
        } catch {
            importError = describe(error)
        }
    }

    private func describe(_ error: Error) -> String {
        if case StravaAuthError.failed(let message) = error { return message }
        return (error as? APIError)?.errorDescription ?? error.localizedDescription
    }
}
