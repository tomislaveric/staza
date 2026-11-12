import SwiftUI

@main
struct StazaApp: App {
    @State private var container = AppContainer()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(container)
                .environment(container.authState)
                .tint(StazaColor.accent)
                .task { await container.bootstrap() }
        }
    }
}
