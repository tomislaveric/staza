import SwiftUI

struct MoreView: View {
    @Environment(AuthState.self) private var authState

    var body: some View {
        List {
            Section {
                if authState.isSignedIn {
                    NavigationLink {
                        ProfileView()
                    } label: {
                        if let email = authState.user?.email {
                            Text(verbatim: email)
                        } else {
                            Text("more.profile.loading")
                        }
                    }
                    .accessibilityIdentifier("profileLink")
                } else {
                    Text("more.profile.signedOut").foregroundStyle(StazaColor.textMuted)
                }
            } header: { Text("more.profile.header") }
            Section {
                NavigationLink("more.quests") { QuestListView() }
                NavigationLink("more.settings") { PlaceholderScreen(title: "more.settings", systemImage: "gearshape") }
            }
        }
        .scrollContentBackground(.hidden)
        .background(StazaColor.canvas)
    }
}
