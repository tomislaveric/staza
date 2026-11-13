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
                header

                Picker("auth.mode", selection: $model.mode) {
                    Text("auth.signIn").tag(AuthFlowModel.Mode.signIn)
                    Text("auth.register").tag(AuthFlowModel.Mode.register)
                }
                .pickerStyle(.segmented)
                .disabled(model.isBusy)

                if model.mode == .signIn {
                    Button { Task { await model.signInWithPasskey() } } label: {
                        Label("auth.passkey.signIn", systemImage: "person.badge.key.fill")
                    }
                    .buttonStyle(.stazaPrimaryWide)
                    .disabled(model.isBusy)
                    .accessibilityIdentifier("passkeySignInButton")

                    AuthDivider()
                }

                switch model.step {
                case .enterEmail: emailStep
                case .enterCode(let email): codeStep(email: email)
                }

                if let message = model.errorMessage {
                    AuthErrorRow(message: message)
                        .accessibilityIdentifier("authError")
                }
            }
            .padding(.horizontal, StazaSpacing.md)
            .padding(.top, StazaSpacing.xl)
            .padding(.bottom, StazaSpacing.lg)
            .animation(.snappy, value: model.mode)
        }
        .scrollDismissesKeyboard(.interactively)
        .stazaScreen()
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.md) {
            AuthLogoMark()
            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                Text("auth.title")
                    .font(StazaFont.display)
                    .foregroundStyle(StazaColor.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text("auth.subtitle").font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
            }
        }
    }

    private var emailStep: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            TextField("auth.email", text: $model.email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focused)
                .stazaAuthField(isFocused: focused)
                .submitLabel(.send)
                .onSubmit { Task { await model.requestCode() } }
                .disabled(model.isBusy)
                .accessibilityIdentifier("emailField")
            Button { Task { await model.requestCode() } } label: {
                if model.isBusy { ProgressView().tint(StazaColor.textPrimary) } else { Text("auth.sendCode") }
            }
            .buttonStyle(StazaButtonStyle(kind: model.mode == .signIn ? .secondary : .primary, fullWidth: true))
            .disabled(!model.canRequestCode)
            .accessibilityIdentifier("sendCodeButton")
        }
    }

    private func codeStep(email: String) -> some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            Text("auth.codeSent \(email)").font(StazaFont.subheadline).foregroundStyle(StazaColor.textMuted)
            TextField("auth.code", text: $model.code)
                .textContentType(.oneTimeCode)
                .keyboardType(.numberPad)
                .font(StazaFont.title3.monospacedDigit())
                .focused($focused)
                .stazaAuthField(isFocused: focused)
                .disabled(model.isBusy)
                .accessibilityIdentifier("codeField")
            Button { Task { await model.verifyCode() } } label: {
                if model.isBusy { ProgressView().tint(StazaColor.onAccent) } else { Text(model.mode == .register ? "auth.createAccount" : "auth.verify") }
            }
            .buttonStyle(.stazaPrimaryWide)
            .disabled(!model.canVerify)
            .accessibilityIdentifier("verifyCodeButton")
            HStack {
                Button("auth.changeEmail") { model.changeEmail() }
                Spacer()
                Button("auth.resend") { Task { await model.requestCode() } }.disabled(model.isBusy)
            }
            .buttonStyle(.stazaPlain)
            .font(StazaFont.footnote)
        }
    }
}

/// Yellow rounded-square brand mark shown above the welcome title.
private struct AuthLogoMark: View {
    @ScaledMetric(relativeTo: .largeTitle) private var size: CGFloat = 64

    var body: some View {
        Image(systemName: "mountain.2.fill")
            .font(.system(size: size * 0.45, weight: .bold))
            .foregroundStyle(StazaColor.onAccent)
            .frame(width: size, height: size)
            .background(StazaColor.accent, in: RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
            .shadow(color: StazaColor.accent.opacity(0.35), radius: 16, y: 6)
            .accessibilityHidden(true)
    }
}

private struct AuthDivider: View {
    var body: some View {
        HStack(spacing: StazaSpacing.sm) {
            line
            Text("auth.or")
                .font(StazaFont.caption)
                .foregroundStyle(StazaColor.textSubtle)
                .fixedSize()
            line
        }
    }

    private var line: some View {
        Rectangle().fill(StazaColor.border).frame(height: 1).accessibilityHidden(true)
    }
}

/// Inline error row with a danger tint, shared by the auth screen and its sheets.
private struct AuthErrorRow: View {
    let message: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: StazaSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill").accessibilityHidden(true)
            Text(verbatim: message).frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(StazaFont.subheadline)
        .foregroundStyle(StazaColor.danger)
        .padding(StazaSpacing.md)
        .background(StazaColor.danger.opacity(0.12), in: RoundedRectangle(cornerRadius: StazaRadius.chip * 1.5, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: StazaRadius.chip * 1.5, style: .continuous).strokeBorder(StazaColor.danger.opacity(0.4), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

private struct AuthFieldStyle: ViewModifier {
    let isFocused: Bool

    func body(content: Content) -> some View {
        content
            .foregroundStyle(StazaColor.textPrimary)
            .tint(StazaColor.accent)
            .padding(.horizontal, StazaSpacing.md)
            .frame(minHeight: 52)
            .background(StazaColor.surface, in: shape)
            .overlay(shape.strokeBorder(isFocused ? StazaColor.accent : StazaColor.border, lineWidth: isFocused ? 1.5 : 1))
            .animation(.snappy(duration: 0.15), value: isFocused)
    }

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: StazaRadius.chip * 1.5, style: .continuous) }
}

private extension View {
    func stazaAuthField(isFocused: Bool) -> some View { modifier(AuthFieldStyle(isFocused: isFocused)) }
}

/// Offered right after registration when the server asks for a passkey.
struct PasskeySetupSheet: View {
    @Environment(AppContainer.self) private var container
    @Environment(\.dismiss) private var dismiss
    @State private var isBusy = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: StazaSpacing.md) {
                    IconBadge(systemImage: "person.badge.key.fill", size: 64)
                    Text("passkey.setup.title").font(StazaFont.title).foregroundStyle(StazaColor.textPrimary)
                    Text("passkey.setup.body").font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                    if let errorMessage { AuthErrorRow(message: errorMessage) }
                    VStack(spacing: StazaSpacing.xs) {
                        Button {
                            Task { await register() }
                        } label: {
                            if isBusy { ProgressView().tint(StazaColor.onAccent) } else { Text("passkey.setup.create") }
                        }
                        .buttonStyle(.stazaPrimaryWide)
                        .disabled(isBusy)
                        Button("passkey.setup.skip") { skip() }
                            .buttonStyle(.stazaPlain)
                            .frame(maxWidth: .infinity)
                            .disabled(isBusy)
                    }
                    .padding(.top, StazaSpacing.sm)
                }
                .padding(StazaSpacing.md)
                .padding(.top, StazaSpacing.md)
            }
            .stazaScreen()
        }
        .presentationBackground(StazaColor.canvas)
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
    @FocusState private var codeFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: StazaSpacing.md) {
                    IconBadge(systemImage: "envelope.badge.shield.half.filled", size: 64)
                    Text("stepup.body").font(StazaFont.body).foregroundStyle(StazaColor.textPrimary)
                    if codeRequested {
                        Text("stepup.codeSent").font(StazaFont.subheadline).foregroundStyle(StazaColor.textMuted)
                        TextField("auth.code", text: $code)
                            .textContentType(.oneTimeCode)
                            .keyboardType(.numberPad)
                            .font(StazaFont.title3.monospacedDigit())
                            .focused($codeFocused)
                            .stazaAuthField(isFocused: codeFocused)
                            .accessibilityIdentifier("stepUpCodeField")
                            .disabled(isBusy)
                    }
                    if let errorMessage { AuthErrorRow(message: errorMessage) }
                    VStack(spacing: StazaSpacing.xs) {
                        if codeRequested {
                            Button { Task { await verify() } } label: {
                                if isBusy { ProgressView().tint(StazaColor.onAccent) } else { Text("stepup.verify") }
                            }
                            .buttonStyle(.stazaPrimaryWide)
                            .disabled(code.count < 4 || isBusy)
                            Button("auth.resend") { Task { await requestCode() } }
                                .buttonStyle(.stazaPlain)
                                .frame(maxWidth: .infinity)
                                .disabled(isBusy)
                        } else {
                            Button { Task { await requestCode() } } label: {
                                if isBusy { ProgressView().tint(StazaColor.onAccent) } else { Text("stepup.sendCode") }
                            }
                            .buttonStyle(.stazaPrimaryWide)
                            .disabled(isBusy)
                        }
                    }
                    .padding(.top, StazaSpacing.sm)
                }
                .padding(StazaSpacing.md)
            }
            .scrollDismissesKeyboard(.interactively)
            .stazaScreen()
            .navigationTitle("stepup.title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("action.cancel") { dismiss() } } }
        }
        .presentationBackground(StazaColor.canvas)
        .interactiveDismissDisabled(isBusy)
    }

    private func requestCode() async {
        await run {
            try await container.authService.requestStepUp()
            code = ""
            codeRequested = true
        }
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
