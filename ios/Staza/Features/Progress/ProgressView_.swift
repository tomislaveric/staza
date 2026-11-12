import SwiftUI

/// Named to avoid clashing with SwiftUI's `ProgressView`.
struct ProgressView_: View {
    var body: some View { PlaceholderScreen(title: "tab.progress", systemImage: "chart.line.uptrend.xyaxis") }
}
