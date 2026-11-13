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
        case .home: "house.fill"
        case .world: "map.fill"
        case .skillAtlas: "point.3.connected.trianglepath.dotted"
        case .progress: "chart.line.uptrend.xyaxis"
        case .more: "person.crop.circle.fill"
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
                        .toolbarBackground(StazaColor.canvas, for: .navigationBar)
                        .toolbar {
                            ToolbarItem(placement: .primaryAction) {
                                Button { isAddingActivity = true } label: {
                                    Label("action.addActivity", systemImage: "plus")
                                        .fontWeight(.semibold)
                                }
                                .buttonStyle(.borderedProminent)
                                .buttonBorderShape(.circle)
                                .tint(StazaColor.accent)
                                .foregroundStyle(StazaColor.onAccent)
                                .accessibilityIdentifier("addActivityButton")
                            }
                        }
                }
                .tabItem { Label(tab.title, systemImage: tab.systemImage) }
                .tag(tab)
            }
        }
        .tint(StazaColor.accent)
        .sheet(isPresented: $isAddingActivity) {
            AddActivityView()
                .presentationBackground(StazaColor.canvas)
                .presentationCornerRadius(StazaRadius.panel)
        }
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

#Preview { AppShellView().environment(AppContainer()).preferredColorScheme(.dark) }
