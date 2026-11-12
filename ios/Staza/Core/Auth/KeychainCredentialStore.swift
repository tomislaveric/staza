import Foundation
import Security

protocol CredentialStore: Sendable {
    func load() -> NativeCredentials?
    func save(_ credentials: NativeCredentials) throws
    func clear()
}

struct KeychainError: Error, Equatable { let status: OSStatus }

/// Stores the credentials as one generic-password Keychain item, accessible
/// only after first unlock and never synced or migrated to other devices.
struct KeychainCredentialStore: CredentialStore {
    let service: String
    let account: String

    init(service: String = "world.staza.app.session", account: String = "native-credentials") {
        self.service = service
        self.account = account
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    func load() -> NativeCredentials? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(NativeCredentials.self, from: data)
    }

    func save(_ credentials: NativeCredentials) throws {
        let data = try JSONEncoder().encode(credentials)
        let update = [kSecValueData as String: data]
        var status = SecItemUpdate(baseQuery as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = baseQuery
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(add as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
