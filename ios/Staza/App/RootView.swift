import SwiftUI

/// Gates the app shell behind authentication and offers passkey setup after registration.
struct RootView: View {
    @Environment(AuthState.self) private var authState
    @Environment(AppContainer.self) private var container

    var body: some View {
        @Bindable var auth = container.authService
        Group {
            switch authState.status {
            case .restoring:
                ProgressView().tint(StazaColor.accent).frame(maxWidth: .infinity, maxHeight: .infinity).stazaScreen()
            case .signedOut:
                AuthView()
            case .signedIn:
                AppShellView()
            }
        }
        .sheet(isPresented: $auth.passkeySetupPending) { PasskeySetupSheet() }
    }
}
