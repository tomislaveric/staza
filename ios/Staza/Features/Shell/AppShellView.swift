import SwiftUI

enum AppTab: Hashable, CaseIterable {
    case home, world, skillAtlas, progress, more

    var title: LocalizedStringKey {
        switch self {
        case .home: "tab.home"
        case .world: "tab.world"
        case .skillAtlas: "tab.skillAtlas"
        case .progress: "tab.progress"
        case .more: "tab.more"
        }
    }

    var systemImage: String {
        switch self {
        case .home: "house"
        case .world: "map"
        case .skillAtlas: "point.3.connected.trianglepath.dotted"
        case .progress: "chart.line.uptrend.xyaxis"
        case .more: "person.crop.circle"
        }
    }
}

/// System `TabView`; each tab owns a `NavigationStack` with an Add Activity action.
struct AppShellView: View {
    @State private var selection: AppTab = .home
    @Environment(AppContainer.self) private var container
    @State private var isAddingActivity = false

    var body: some View {
        TabView(selection: $selection) {
            ForEach(AppTab.allCases, id: \.self) { tab in
                NavigationStack {
                    content(for: tab)
                        .navigationTitle(tab.title)
                        .toolbar {
                            ToolbarItem(placement: .primaryAction) {
                                Button { isAddingActivity = true } label: {
                                    Label("action.addActivity", systemImage: "plus.circle.fill")
                                        .font(.title3)
                                }
                                .accessibilityIdentifier("addActivityButton")
                            }
                        }
                }
                .tabItem { Label(tab.title, systemImage: tab.systemImage) }
                .tag(tab)
            }
        }
        .sheet(isPresented: $isAddingActivity) { AddActivityView() }
        .onChange(of: container.pendingImport, initial: true) { _, pending in
            if pending != nil { isAddingActivity = true }
        }
    }

    @ViewBuilder
    private func content(for tab: AppTab) -> some View {
        switch tab {
        case .home: HomeView(onOpenWorld: { selection = .world })
        case .world: WorldView()
        case .skillAtlas: SkillAtlasView()
        case .progress: ProgressView_()
        case .more: MoreView()
        }
    }
}

#Preview { AppShellView().environment(AppContainer()) }
