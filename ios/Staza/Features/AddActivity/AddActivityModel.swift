import Foundation
import Observation

enum ImportSport: String, CaseIterable, Identifiable, Sendable {
    case cycling, running, hiking
    var id: String { rawValue }

    var titleKey: LocalizedStringResource {
        switch self {
        case .cycling: "addActivity.sport.cycling"
        case .running: "addActivity.sport.running"
        case .hiking: "addActivity.sport.hiking"
        }
    }
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
    /// Set when the server could not inspect the file; the user must confirm the sport manually.
    private(set) var sportDetectionFailed = false
    private var file: URL?
    private(set) var fileName = ""
    private let api: APIClient
    /// One key per selected file so a retry of the same file is deduplicated but a new file is not.
    private(set) var idempotencyKey = UUID().uuidString

    init(api: APIClient) { self.api = api }

    var hasFile: Bool { file != nil }

    var isBusy: Bool {
        switch state {
        case .uploading, .processing: true
        default: false
        }
    }

    /// Selects a staged `.fit` file. The model takes ownership and discards the previous file.
    func select(fileName: String, fileURL: URL) async {
        if let file, file != fileURL { FitFileStaging.discard(file) }
        self.fileName = fileName
        file = fileURL
        idempotencyKey = UUID().uuidString
        sportDetectionFailed = false
        state = .ready(fileName: fileName)
        do {
            let inspected: InspectResponse = try await api.upload(
                "/api/activities/inspect",
                file: MultipartFile(fieldName: "fit", fileName: fileName, mimeType: "application/octet-stream", fileURL: fileURL)
            )
            guard self.file == fileURL else { return }
            if let declared = inspected.sport.flatMap(ImportSport.init(rawValue:)) { sport = declared }
        } catch {
            guard self.file == fileURL else { return }
            sportDetectionFailed = true
        }
    }

    /// Imports a file shared to the app. While an upload runs the share stays queued in the container.
    @discardableResult
    func importPending(from container: AppContainer) async -> Bool {
        guard !isBusy, let pending = container.pendingImport else { return false }
        container.pendingImport = nil
        await select(fileName: pending.fileName, fileURL: pending.fileURL)
        await upload()
        return true
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
                file: MultipartFile(fieldName: "fit", fileName: fileName, mimeType: "application/octet-stream", fileURL: file),
                fields: ["sport": sport.rawValue],
                headers: ["Idempotency-Key": idempotencyKey],
                progress: { [weak self] fraction in
                    Task { @MainActor in self?.uploadProgressed(fraction) }
                }
            )
            state = .processing
            let item: ActivityHistoryItem = try await api.get("/api/activities/\(response.activity.id)")
            FitFileStaging.discard(file)
            self.file = nil
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
