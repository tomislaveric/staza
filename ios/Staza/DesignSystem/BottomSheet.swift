import SwiftUI

/// Snap positions of `StazaBottomSheet`, from collapsed to expanded.
enum StazaSheetDetent: Int, CaseIterable, Comparable, Sendable {
    case peek, medium, large

    static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }

    var larger: Self { Self(rawValue: rawValue + 1) ?? self }
    var smaller: Self { Self(rawValue: rawValue - 1) ?? self }
}

/// Persistent, draggable sheet that lives inside a screen (unlike a system sheet it never
/// covers the tab bar). The header is always visible; the content scrolls once fully expanded.
/// Dragging snaps to the nearest detent, taking fling velocity into account.
struct StazaBottomSheet<Header: View, Content: View>: View {
    @Binding var detent: StazaSheetDetent
    /// `.medium` makes a compact sheet: it fits its content, stays below half the screen and never expands fully.
    var maxDetent: StazaSheetDetent = .large
    /// Reports the settled visible height so callers can inset content behind the sheet.
    var onHeightChange: (CGFloat) -> Void = { _ in }
    @ViewBuilder var header: Header
    @ViewBuilder var content: Content

    @GestureState(resetTransaction: Transaction(animation: .spring(response: 0.38, dampingFraction: 0.86)))
    private var dragOffset: CGFloat = 0
    @State private var headerHeight: CGFloat = 0
    @State private var contentHeight: CGFloat = 0
    @State private var reportedHeight: CGFloat = -1
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static var grabberArea: CGFloat { 22 }
    private static var outerInset: CGFloat { StazaSpacing.sm }
    /// Upper bound of a compact sheet, like the system's medium detent but lower.
    private static var compactFraction: CGFloat { 0.42 }

    var body: some View {
        GeometryReader { proxy in
            let heights = heights(in: proxy.size.height)
            let settled = heights[shown] ?? 0
            let current = min(max(settled - dragOffset, heights[.peek]! * 0.85), heights[.large]! + 24)

            VStack(spacing: 0) {
                VStack(spacing: 0) {
                    grabber
                    header
                        .background(GeometryReader { Color.clear.preference(key: HeaderHeightKey.self, value: $0.size.height) })
                }
                .contentShape(Rectangle())
                .gesture(drag(heights))

                ScrollView {
                    content
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(GeometryReader { Color.clear.preference(key: ContentHeightKey.self, value: $0.size.height) })
                }
                .scrollDisabled(shown != maxDetent)
                .scrollIndicators(shown == maxDetent ? .automatic : .hidden)
                .simultaneousGesture(drag(heights), including: shown == maxDetent ? .subviews : .all)
            }
            .frame(maxWidth: .infinity)
            .frame(height: current, alignment: .top)
            .clipShape(RoundedRectangle(cornerRadius: StazaRadius.panel, style: .continuous))
            .stazaGlass()
            .shadow(color: .black.opacity(0.35), radius: 16, y: 4)
            .padding(.horizontal, Self.outerInset)
            .padding(.bottom, Self.outerInset)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            .onPreferenceChange(HeaderHeightKey.self) { headerHeight = $0 }
            .onPreferenceChange(ContentHeightKey.self) { contentHeight = $0 }
            .onChange(of: settled, initial: true) { _, height in report(height) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bottomSheet")
    }

    private var grabber: some View {
        Button {
            withAnimation(animation) { detent = shown == maxDetent ? .peek : shown.larger }
        } label: {
            Capsule()
                .fill(StazaColor.textSubtle.opacity(0.6))
                .frame(width: 36, height: 5)
                .frame(maxWidth: .infinity, minHeight: Self.grabberArea)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("sheet.handle"))
        .accessibilityValue(Text(detentLabel))
        .accessibilityAdjustableAction { direction in
            withAnimation(animation) {
                switch direction {
                case .increment: detent = min(shown.larger, maxDetent)
                case .decrement: detent = shown.smaller
                @unknown default: break
                }
            }
        }
        .accessibilityIdentifier("bottomSheetHandle")
    }

    private var detentLabel: LocalizedStringKey {
        switch shown {
        case .peek: "sheet.detent.peek"
        case .medium: "sheet.detent.medium"
        case .large: "sheet.detent.large"
        }
    }

    /// The detent actually shown; a compact sheet treats `.large` as `.medium`.
    private var shown: StazaSheetDetent { min(detent, maxDetent) }

    private var animation: Animation { reduceMotion ? .easeOut(duration: 0.2) : .spring(response: 0.38, dampingFraction: 0.86) }

    private func heights(in available: CGFloat) -> [StazaSheetDetent: CGFloat] {
        let usable = max(available - Self.outerInset, 0)
        let peek = min(Self.grabberArea + headerHeight, usable)
        let large = max(usable - StazaSpacing.sm, peek)
        if maxDetent < .large {
            let compact = min(max(peek + contentHeight, peek + 60), usable * Self.compactFraction)
            return [.peek: peek, .medium: compact, .large: compact]
        }
        let medium = min(max(usable * 0.48, peek + 120), large)
        return [.peek: peek, .medium: medium, .large: large]
    }

    private func drag(_ heights: [StazaSheetDetent: CGFloat]) -> some Gesture {
        DragGesture(minimumDistance: 8, coordinateSpace: .global)
            .updating($dragOffset) { value, state, _ in
                if Self.isVertical(value) { state = value.translation.height }
            }
            .onEnded { value in
                guard Self.isVertical(value) else { return }
                let settled = heights[shown] ?? 0
                let projected = settled - value.predictedEndTranslation.height
                let target = StazaSheetDetent.allCases.filter { $0 <= maxDetent }.min { abs((heights[$0] ?? 0) - projected) < abs((heights[$1] ?? 0) - projected) } ?? detent
                withAnimation(animation) { detent = target }
            }
    }

    /// Horizontal drags belong to horizontally scrolling content such as chip rows.
    private static func isVertical(_ value: DragGesture.Value) -> Bool {
        abs(value.translation.height) > abs(value.translation.width)
    }

    private func report(_ height: CGFloat) {
        let visible = height + Self.outerInset
        guard abs(visible - reportedHeight) > 0.5 else { return }
        reportedHeight = visible
        onHeightChange(visible)
    }
}

private struct HeaderHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

private struct ContentHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}
