import Foundation

struct MultipartFile: Sendable {
    let fieldName: String
    let fileName: String
    let mimeType: String
    let fileURL: URL
}

/// A multipart/form-data body streamed to a temporary file so large uploads are never held in memory.
struct MultipartBody: Sendable {
    let boundary: String
    let fileURL: URL

    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    static let chunkSize = 64 * 1024

    init(file: MultipartFile, fields: [String: String], boundary: String = "staza-\(UUID().uuidString)") throws {
        self.boundary = boundary
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("multipart-\(UUID().uuidString)")
        guard FileManager.default.createFile(atPath: url.path, contents: nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        do {
            let output = try FileHandle(forWritingTo: url)
            defer { try? output.close() }
            func append(_ string: String) throws { try output.write(contentsOf: Data(string.utf8)) }
            for (name, value) in fields.sorted(by: { $0.key < $1.key }) {
                try append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n")
            }
            let safeName = file.fileName.replacingOccurrences(of: "\"", with: "_")
            try append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(file.fieldName)\"; filename=\"\(safeName)\"\r\n")
            try append("Content-Type: \(file.mimeType)\r\n\r\n")
            let input = try FileHandle(forReadingFrom: file.fileURL)
            defer { try? input.close() }
            while let chunk = try input.read(upToCount: Self.chunkSize), !chunk.isEmpty {
                try output.write(contentsOf: chunk)
            }
            try append("\r\n--\(boundary)--\r\n")
        } catch {
            try? FileManager.default.removeItem(at: url)
            throw error
        }
        self.fileURL = url
    }

    func remove() {
        try? FileManager.default.removeItem(at: fileURL)
    }
}
