import SwiftUI

struct AuthView: View {
    @Environment(AppContainer.self) private var container
    @State private var model: AuthFlowModel?

    var body: some View {
        NavigationStack {
            if let model {
                AuthForm(model: model)
            }
        }
        .task { if model == nil { model = AuthFlowModel(service: container.authService) } }
    }
}

private struct AuthForm: View {
    @Bindable var model: AuthFlowModel
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: StazaSpacing.lg) {
                VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                    Text("auth.title").font(StazaFont.display).foregroundStyle(StazaColor.textPrimary)
                    Text("auth.subtitle").font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                }

                Picker("auth.mode", selection: $model.mode) {
                    Text("auth.signIn").tag(AuthFlowModel.Mode.signIn)
                    Text("auth.register").tag(AuthFlowModel.Mode.register)
                }
                .pickerStyle(.segmented)

                if model.mode == .signIn {
                    Button { Task { await model.signInWithPasskey() } } label: {
                        Label("auth.passkey.signIn", systemImage: "person.badge.key.fill").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(model.isBusy)
                    .accessibilityIdentifier("passkeySignInButton")
                    Text("auth.or").font(StazaFont.caption).foregroundStyle(StazaColor.textMuted).frame(maxWidth: .infinity)
                }

                StazaCard {
                    switch model.step {
                    case .enterEmail: emailStep
                    case .enterCode(let email): codeStep(email: email)
                    }
                }

                if let message = model.errorMessage {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .font(StazaFont.body)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("authError")
                }
            }
            .padding(StazaSpacing.md)
        }
        .background(StazaColor.canvas)
        .scrollDismissesKeyboard(.interactively)
    }

    private var emailStep: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            TextField("auth.email", text: $model.email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .focused($focused)
                .submitLabel(.send)
                .onSubmit { Task { await model.requestCode() } }
                .accessibilityIdentifier("emailField")
            Button { Task { await model.requestCode() } } label: {
                Group {
                    if model.isBusy { ProgressView() } else { Text("auth.sendCode") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .disabled(!model.canRequestCode)
            .accessibilityIdentifier("sendCodeButton")
        }
    }

    private func codeStep(email: String) -> some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            Text("auth.codeSent \(email)").font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
            TextField("auth.code", text: $model.code)
                .textContentType(.oneTimeCode)
                .keyboardType(.numberPad)
                .textFieldStyle(.roundedBorder)
                .focused($focused)
                .accessibilityIdentifier("codeField")
            Button { Task { await model.verifyCode() } } label: {
                Group {
                    if model.isBusy { ProgressView() } else { Text(model.mode == .register ? "auth.createAccount" : "auth.verify") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!model.canVerify)
            .accessibilityIdentifier("verifyCodeButton")
            HStack {
                Button("auth.changeEmail") { model.changeEmail() }
                Spacer()
                Button("auth.resend") { Task { await model.requestCode() } }.disabled(model.isBusy)
            }
            .font(StazaFont.caption)
        }
    }
}

/// Offered right after registration when the server asks for a passkey.
struct PasskeySetupSheet: View {
    @Environment(AppContainer.self) private var container
    @Environment(\.dismiss) private var dismiss
    @State private var isBusy = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: StazaSpacing.md) {
                Image(systemName: "person.badge.key.fill").font(.largeTitle).foregroundStyle(StazaColor.accent).accessibilityHidden(true)
                Text("passkey.setup.title").font(StazaFont.title)
                Text("passkey.setup.body").font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                if let errorMessage { Text(errorMessage).foregroundStyle(.red).font(StazaFont.caption) }
                Button {
                    Task { await register() }
                } label: {
                    Group { if isBusy { ProgressView() } else { Text("passkey.setup.create") } }.frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).controlSize(.large).disabled(isBusy)
                Button("passkey.setup.skip") { skip() }.frame(maxWidth: .infinity)
                Spacer()
            }
            .padding(StazaSpacing.md)
            .background(StazaColor.canvas)
        }
        .interactiveDismissDisabled(isBusy)
    }

    private func register() async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            try await container.authService.registerPasskey()
            dismiss()
        } catch PasskeyError.cancelled {
            // Stay on the sheet so the user can retry or skip.
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func skip() {
        container.authService.passkeySetupPending = false
        dismiss()
    }
}

/// Reusable email step-up verification for sensitive actions. Calls `onVerified` once the server accepts the code.
struct StepUpSheet: View {
    @Environment(AppContainer.self) private var container
    @Environment(\.dismiss) private var dismiss
    let onVerified: () async -> Void

    @State private var code = ""
    @State private var codeRequested = false
    @State private var isBusy = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section { Text("stepup.body").font(StazaFont.body) }
                if codeRequested {
                    Section {
                        TextField("auth.code", text: $code)
                            .textContentType(.oneTimeCode)
                            .keyboardType(.numberPad)
                            .accessibilityIdentifier("stepUpCodeField")
                        Button("stepup.verify") { Task { await verify() } }
                            .disabled(code.count < 4 || isBusy)
                    }
                } else {
                    Section {
                        Button("stepup.sendCode") { Task { await requestCode() } }.disabled(isBusy)
                    }
                }
                if let errorMessage { Section { Text(errorMessage).foregroundStyle(.red) } }
            }
            .navigationTitle("stepup.title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("action.cancel") { dismiss() } } }
        }
        .interactiveDismissDisabled(isBusy)
    }

    private func requestCode() async {
        await run { try await container.authService.requestStepUp(); codeRequested = true }
    }

    private func verify() async {
        await run {
            try await container.authService.verifyStepUp(code: code)
            dismiss()
            await onVerified()
        }
    }

    private func run(_ work: () async throws -> Void) async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do { try await work() } catch { errorMessage = error.localizedDescription }
    }
}
