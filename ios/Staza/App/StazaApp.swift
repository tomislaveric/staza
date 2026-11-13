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
                .preferredColorScheme(.dark)
                .task { await container.bootstrap() }
                .onOpenURL { container.receive(fileURL: $0) }
        }
    }
}
