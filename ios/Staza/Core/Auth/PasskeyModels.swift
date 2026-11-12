import Foundation

extension Data {
    /// Unpadded base64url, as used by WebAuthn JSON.
    var base64URLEncoded: String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    init?(base64URLEncoded string: String) {
        var base64 = string.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        self.init(base64Encoded: base64)
    }
}

// MARK: Server WebAuthn options

struct PasskeyLoginOptions: Decodable, Sendable {
    let challenge: String
    let rpId: String
}

struct PasskeyRegistrationOptions: Decodable, Sendable {
    struct RelyingParty: Decodable, Sendable { let id: String? }
    struct User: Decodable, Sendable {
        let id: String
        let name: String
    }
    let challenge: String
    let rp: RelyingParty
    let user: User
}

// MARK: Client responses (WebAuthn JSON)

struct PasskeyAssertionResponse: Encodable, Sendable {
    struct Payload: Encodable, Sendable {
        let clientDataJSON: String
        let authenticatorData: String
        let signature: String
        let userHandle: String?
    }
    let id: String
    let rawId: String
    let type = "public-key"
    let response: Payload
    let clientExtensionResults = [String: String]()
}

struct PasskeyAttestationResponse: Encodable, Sendable {
    struct Payload: Encodable, Sendable {
        let clientDataJSON: String
        let attestationObject: String
    }
    let id: String
    let rawId: String
    let type = "public-key"
    let response: Payload
    let clientExtensionResults = [String: String]()
    let name: String?
}

struct EmailCodeRequest: Encodable, Sendable { let email: String }
struct EmailCodeVerifyRequest: Encodable, Sendable { let email: String; let code: String }
struct StepUpVerifyRequest: Encodable, Sendable { let code: String }

struct SignInResponse: Decodable, Sendable {
    let authenticated: Bool?
    let user: SessionUser?
    let credentials: NativeCredentials?
}

struct PasskeyRegisterResponse: Decodable, Sendable { let credentials: NativeCredentials? }

struct PasskeyInfo: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let createdAt: String
    let lastUsedAt: String?
}
