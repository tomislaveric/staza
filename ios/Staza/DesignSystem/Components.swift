import SwiftUI

/// Reusable card surface.
struct StazaCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(StazaSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(StazaColor.surface, in: RoundedRectangle(cornerRadius: StazaRadius.card))
            .overlay(RoundedRectangle(cornerRadius: StazaRadius.card).stroke(StazaColor.border, lineWidth: 1))
    }
}

/// Placeholder body for tabs whose feature screens are built later.
struct PlaceholderScreen: View {
    let title: LocalizedStringKey
    let systemImage: String

    var body: some View {
        ScrollView {
            StazaCard {
                VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                    Image(systemName: systemImage)
                        .font(StazaFont.title)
                        .foregroundStyle(StazaColor.accent)
                        .accessibilityHidden(true)
                    Text(title).font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                    Text("placeholder.comingSoon").font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                }
            }
            .padding(StazaSpacing.md)
        }
        .background(StazaColor.canvas)
    }
}

#Preview("Light") { PlaceholderScreen(title: "tab.home", systemImage: "house").preferredColorScheme(.light) }
#Preview("Dark XXL") {
    PlaceholderScreen(title: "tab.home", systemImage: "house")
        .preferredColorScheme(.dark)
        .dynamicTypeSize(.xxxLarge)
}
