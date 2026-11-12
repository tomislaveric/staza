import Foundation
import Observation

/// State machine for the email-code and passkey sign-in / registration screen.
@MainActor
@Observable
final class AuthFlowModel {
    enum Mode: Equatable { case signIn, register }
    enum Step: Equatable {
        case enterEmail
        case enterCode(email: String)
    }

    private let service: AuthService

    var mode: Mode = .signIn { didSet { if mode != oldValue { reset() } } }
    var email = ""
    var code = ""
    private(set) var step: Step = .enterEmail
    private(set) var isBusy = false
    private(set) var errorMessage: String?

    init(service: AuthService) { self.service = service }

    var normalizedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
    var canRequestCode: Bool { normalizedEmail.contains("@") && !isBusy }
    var canVerify: Bool { code.trimmingCharacters(in: .whitespaces).count >= 4 && !isBusy }

    func requestCode() async {
        guard canRequestCode else { return }
        await run {
            try await self.service.requestCode(email: self.normalizedEmail, registering: self.mode == .register)
            self.code = ""
            self.step = .enterCode(email: self.normalizedEmail)
        }
    }

    func verifyCode() async {
        guard case .enterCode(let email) = step, canVerify else { return }
        await run {
            try await self.service.verifyCode(
                email: email,
                code: self.code.trimmingCharacters(in: .whitespaces),
                registering: self.mode == .register
            )
        }
    }

    func signInWithPasskey() async {
        guard !isBusy else { return }
        await run {
            do {
                try await self.service.signInWithPasskey()
            } catch PasskeyError.cancelled {
                // The user dismissed the system sheet; not an error.
            }
        }
    }

    func changeEmail() {
        step = .enterEmail
        code = ""
        errorMessage = nil
    }

    private func reset() {
        step = .enterEmail
        code = ""
        errorMessage = nil
    }

    private func run(_ work: () async throws -> Void) async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do { try await work() } catch { errorMessage = error.localizedDescription }
    }
}
