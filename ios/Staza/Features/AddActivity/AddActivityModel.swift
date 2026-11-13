import Foundation
import Observation

enum ImportSport: String, CaseIterable, Identifiable, Sendable {
    case cycling, running, hiking
    var id: String { rawValue }
}

struct ImportedActivityResponse: Decodable, Sendable {
    struct Activity: Decodable, Sendable { let id: String }
    let activity: Activity
}

private struct InspectResponse: Decodable, Sendable { let sport: String? }

@MainActor
@Observable
final class AddActivityModel {
    enum State: Equatable {
        case idle
        case ready(fileName: String)
        case uploading(progress: Double)
        case processing
        case failed(String)
        case imported(ActivityHistoryItem)
    }

    private(set) var state: State = .idle
    var sport: ImportSport = .cycling
    private var file: Data?
    private(set) var fileName = ""
    private let api: APIClient
    private let idempotencyKey = UUID().uuidString

    init(api: APIClient) { self.api = api }

    var hasFile: Bool { file != nil }

    var isBusy: Bool {
        switch state {
        case .uploading, .processing: true
        default: false
        }
    }

    func select(fileName: String, data: Data) async {
        self.fileName = fileName
        file = data
        state = .ready(fileName: fileName)
        let inspected: InspectResponse? = try? await api.upload(
            "/api/activities/inspect",
            file: MultipartFile(fieldName: "fit", fileName: fileName, mimeType: "application/octet-stream", data: data)
        )
        if let declared = inspected?.sport.flatMap(ImportSport.init(rawValue:)) { sport = declared }
    }

    func selectionFailed(_ error: Error) {
        state = .failed(error.localizedDescription)
    }

    func upload() async {
        guard let file, !isBusy else { return }
        state = .uploading(progress: 0)
        do {
            let response: ImportedActivityResponse = try await api.upload(
                "/api/activities/import",
                file: MultipartFile(fieldName: "fit", fileName: fileName, mimeType: "application/octet-stream", data: file),
                fields: ["sport": sport.rawValue],
                headers: ["Idempotency-Key": idempotencyKey],
                progress: { [weak self] fraction in
                    Task { @MainActor in self?.uploadProgressed(fraction) }
                }
            )
            state = .processing
            let activities: [ActivityHistoryItem] = try await api.get("/api/activities")
            guard let item = activities.first(where: { $0.id == response.activity.id }) else {
                throw APIError.invalidResponse
            }
            state = .imported(item)
        } catch {
            state = .failed((error as? APIError)?.errorDescription ?? error.localizedDescription)
        }
    }

    private func uploadProgressed(_ fraction: Double) {
        switch state {
        case .uploading:
            state = fraction >= 1 ? .processing : .uploading(progress: fraction)
        default: break
        }
    }
}
