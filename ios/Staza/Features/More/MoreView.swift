import SwiftUI

struct MoreView: View {
    @Environment(AuthState.self) private var authState

    var body: some View {
        List {
            Section {
                if let email = authState.user?.email {
                    Text(email)
                } else {
                    Text(authState.isSignedIn ? "more.profile.loading" : "more.profile.signedOut")
                        .foregroundStyle(StazaColor.textMuted)
                }
            } header: { Text("more.profile.header") }
            Section {
                NavigationLink("more.settings") { PlaceholderScreen(title: "more.settings", systemImage: "gearshape") }
            }
        }
        .scrollContentBackground(.hidden)
        .background(StazaColor.canvas)
    }
}
