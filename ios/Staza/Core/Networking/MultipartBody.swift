import Foundation

struct MultipartFile: Sendable {
    let fieldName: String
    let fileName: String
    let mimeType: String
    let data: Data
}

struct MultipartBody: Sendable {
    let boundary: String
    let data: Data

    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    init(file: MultipartFile, fields: [String: String], boundary: String = "staza-\(UUID().uuidString)") {
        self.boundary = boundary
        var body = Data()
        func append(_ string: String) { body.append(Data(string.utf8)) }
        for (name, value) in fields.sorted(by: { $0.key < $1.key }) {
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n")
        }
        let safeName = file.fileName.replacingOccurrences(of: "\"", with: "_")
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(file.fieldName)\"; filename=\"\(safeName)\"\r\n")
        append("Content-Type: \(file.mimeType)\r\n\r\n")
        body.append(file.data)
        append("\r\n--\(boundary)--\r\n")
        self.data = body
    }
}
