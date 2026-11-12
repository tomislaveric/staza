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
        .sheet(isPresented: $isAddingActivity) { AddActivityPlaceholderView() }
    }

    @ViewBuilder
    private func content(for tab: AppTab) -> some View {
        switch tab {
        case .home: HomeView()
        case .world: WorldView()
        case .skillAtlas: SkillAtlasView()
        case .progress: ProgressView_()
        case .more: MoreView()
        }
    }
}

struct AddActivityPlaceholderView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            PlaceholderScreen(title: "action.addActivity", systemImage: "plus.circle")
                .navigationTitle("action.addActivity")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("action.close") { dismiss() }
                    }
                }
        }
    }
}

#Preview { AppShellView() }
