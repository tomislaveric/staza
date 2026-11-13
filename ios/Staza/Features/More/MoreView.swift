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
                        HStack(spacing: StazaSpacing.md) {
                            MoreAvatar(name: authState.user?.email, size: 48)
                            VStack(alignment: .leading, spacing: StazaSpacing.xxs) {
                                OverlineText("profile.title")
                                if let email = authState.user?.email {
                                    Text(verbatim: email)
                                        .font(StazaFont.headline)
                                        .foregroundStyle(StazaColor.textPrimary)
                                        .lineLimit(1)
                                        .truncationMode(.middle)
                                } else {
                                    Text("more.profile.loading").font(StazaFont.headline).foregroundStyle(StazaColor.textMuted)
                                }
                            }
                        }
                        .padding(.vertical, StazaSpacing.xs)
                    }
                    .accessibilityIdentifier("profileLink")
                } else {
                    HStack(spacing: StazaSpacing.md) {
                        MoreAvatar(name: nil, size: 48)
                        Text("more.profile.signedOut").foregroundStyle(StazaColor.textMuted)
                    }
                    .padding(.vertical, StazaSpacing.xs)
                }
            } header: { OverlineText("more.profile.header") }
            .listRowBackground(StazaColor.surface)

            Section {
                NavigationLink { QuestListView() } label: {
                    MoreIconRow(title: "more.quests", systemImage: "flag.checkered")
                }
                NavigationLink { PlaceholderScreen(title: "more.settings", systemImage: "gearshape") } label: {
                    MoreIconRow(title: "more.settings", systemImage: "gearshape", tint: StazaColor.textMuted)
                }
            }
            .listRowBackground(StazaColor.surface)
        }
        .listRowSeparatorTint(StazaColor.border)
        .scrollContentBackground(.hidden)
        .stazaScreen()
    }
}
