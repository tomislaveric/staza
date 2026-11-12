import AuthenticationServices
import UIKit

enum PasskeyError: Error, Equatable {
    case cancelled
    case failed(String)
    case invalidOptions
}

/// Boundary around `ASAuthorizationController` so auth flows can be tested.
@MainActor
protocol PasskeyAuthorizing {
    func assertion(for options: PasskeyLoginOptions) async throws -> PasskeyAssertionResponse
    func registration(for options: PasskeyRegistrationOptions, name: String?) async throws -> PasskeyAttestationResponse
}

@MainActor
final class SystemPasskeyAuthorizer: NSObject, PasskeyAuthorizing {
    private var continuation: CheckedContinuation<ASAuthorization, Error>?
    private var controller: ASAuthorizationController?

    func assertion(for options: PasskeyLoginOptions) async throws -> PasskeyAssertionResponse {
        guard let challenge = Data(base64URLEncoded: options.challenge) else { throw PasskeyError.invalidOptions }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: options.rpId)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        let authorization = try await perform(request)
        guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            throw PasskeyError.failed("Unexpected credential")
        }
        return PasskeyAssertionResponse(
            id: credential.credentialID.base64URLEncoded,
            rawId: credential.credentialID.base64URLEncoded,
            response: .init(
                clientDataJSON: credential.rawClientDataJSON.base64URLEncoded,
                authenticatorData: credential.rawAuthenticatorData.base64URLEncoded,
                signature: credential.signature.base64URLEncoded,
                userHandle: credential.userID.isEmpty ? nil : credential.userID.base64URLEncoded
            )
        )
    }

    func registration(for options: PasskeyRegistrationOptions, name: String?) async throws -> PasskeyAttestationResponse {
        guard let challenge = Data(base64URLEncoded: options.challenge),
              let userID = Data(base64URLEncoded: options.user.id),
              let rpId = options.rp.id
        else { throw PasskeyError.invalidOptions }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
        let request = provider.createCredentialRegistrationRequest(challenge: challenge, name: options.user.name, userID: userID)
        let authorization = try await perform(request)
        guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
              let attestation = credential.rawAttestationObject
        else { throw PasskeyError.failed("Unexpected credential") }
        return PasskeyAttestationResponse(
            id: credential.credentialID.base64URLEncoded,
            rawId: credential.credentialID.base64URLEncoded,
            response: .init(
                clientDataJSON: credential.rawClientDataJSON.base64URLEncoded,
                attestationObject: attestation.base64URLEncoded
            ),
            name: name
        )
    }

    private func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.controller = controller
            controller.performRequests()
        }
    }

    private func finish(_ result: Result<ASAuthorization, Error>) {
        continuation?.resume(with: result)
        continuation = nil
        controller = nil
    }
}

extension SystemPasskeyAuthorizer: ASAuthorizationControllerDelegate {
    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        Task { @MainActor in self.finish(.success(authorization)) }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let mapped: PasskeyError = (error as? ASAuthorizationError)?.code == .canceled
            ? .cancelled
            : .failed(error.localizedDescription)
        Task { @MainActor in self.finish(.failure(mapped)) }
    }
}

extension SystemPasskeyAuthorizer: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        return scene?.keyWindow ?? scene?.windows.first ?? ASPresentationAnchor()
    }
}
