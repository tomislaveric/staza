import Foundation

/// Copies picked or shared `.fit` files into an app-owned temporary location so they can be
/// uploaded after security-scoped access ends, without reading them into memory.
enum FitFileStaging {
    static var directory: URL { FileManager.default.temporaryDirectory.appendingPathComponent("fit-imports", isDirectory: true) }

    static func stage(_ source: URL) throws -> URL {
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let folder = directory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let destination = folder.appendingPathComponent(source.lastPathComponent)
        try FileManager.default.copyItem(at: source, to: destination)
        return destination
    }

    static func discard(_ staged: URL) {
        guard staged.path.hasPrefix(directory.path) else { return }
        try? FileManager.default.removeItem(at: staged.deletingLastPathComponent())
    }
}
