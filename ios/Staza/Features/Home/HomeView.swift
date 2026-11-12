import SwiftUI

struct HomeView: View {
    @Environment(\.locale) private var locale
    @Environment(AuthState.self) private var authState

    private let sampleDistanceMeters = 42_195.0
    private let sampleXP = 12_345.0
    private let sampleDate = Date(timeIntervalSince1970: 1_767_225_600)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: StazaSpacing.md) {
                StazaCard {
                    VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                        Text("home.sample.title").font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                        Text("home.sample.subtitle").font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
                        Divider()
                        metric("home.sample.distance", StazaFormat.distance(meters: sampleDistanceMeters, locale: locale))
                        metric("home.sample.xp", StazaFormat.number(sampleXP, locale: locale))
                        metric("home.sample.date", StazaFormat.date(sampleDate, locale: locale))
                    }
                }
                StazaCard {
                    Text(authState.isSignedIn ? "home.auth.signedIn" : "home.auth.signedOut")
                        .font(StazaFont.body)
                        .foregroundStyle(StazaColor.textMuted)
                }
            }
            .padding(StazaSpacing.md)
        }
        .background(StazaColor.canvas)
    }

    private func metric(_ label: LocalizedStringKey, _ value: String) -> some View {
        HStack {
            Text(label).font(StazaFont.body).foregroundStyle(StazaColor.textMuted)
            Spacer()
            Text(value).font(StazaFont.metric).foregroundStyle(StazaColor.textPrimary)
        }
    }
}

#Preview("EN") { HomeView().environment(AuthState()) }
#Preview("DE dark") {
    HomeView().environment(AuthState()).environment(\.locale, Locale(identifier: "de")).preferredColorScheme(.dark)
}
