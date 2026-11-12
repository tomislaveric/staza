import SwiftUI

/// Authentication UI is out of scope; the shell is shown in every auth state
/// and reacts to `AuthState` where features need it.
struct RootView: View {
    var body: some View {
        AppShellView()
    }
}
