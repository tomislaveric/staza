import SwiftUI

/// Portrait branch-lane tree of one sport: lane headers, curved prerequisite
/// connectors drawn behind the nodes, and tappable node glyphs.
struct SkillAtlasLaneTree: View {
    let layout: SkillAtlasLaneLayout
    let sport: String
    let selectedNodeId: String?
    let onSelect: (String) -> Void

    static let rowHeight: CGFloat = 96
    static let laneHeaderHeight: CGFloat = 28
    static let topPadding: CGFloat = StazaSpacing.sm

    static func rowAnchorId(sport: String, row: Int) -> String { "atlas-row-\(sport)-\(row)" }

    private var totalHeight: CGFloat {
        Self.topPadding + Self.laneHeaderHeight + CGFloat(layout.rowCount) * Self.rowHeight
    }

    private func rowTop(_ row: Int) -> CGFloat {
        Self.topPadding + CGFloat(row) * Self.rowHeight + (row >= 1 ? Self.laneHeaderHeight : 0)
    }

    var body: some View {
        GeometryReader { proxy in
            let columnWidth = proxy.size.width / CGFloat(SkillAtlasLaneLayout.columnCount)
            let centers = Dictionary(uniqueKeysWithValues: layout.nodes.map { placed in
                (placed.id, CGPoint(
                    x: (CGFloat(placed.col) + 0.5) * columnWidth,
                    y: rowTop(placed.row) + SkillAtlasNodeGlyph.diameter(for: placed.node) / 2 + StazaSpacing.sm
                ))
            })
            ZStack(alignment: .topLeading) {
                laneGuides(columnWidth: columnWidth)
                connectors(centers: centers)
                laneHeaders(columnWidth: columnWidth)
                ForEach(layout.nodes) { placed in
                    let center = centers[placed.id] ?? .zero
                    let diameter = SkillAtlasNodeGlyph.diameter(for: placed.node)
                    SkillAtlasLaneNode(
                        placed: placed,
                        isSelected: placed.id == selectedNodeId,
                        isDistant: layout.edges.contains { $0.toId == placed.id && $0.distant },
                        labelWidth: columnWidth
                    ) { onSelect(placed.id) }
                    .frame(width: columnWidth + StazaSpacing.sm, height: Self.rowHeight - StazaSpacing.sm, alignment: .top)
                    .position(x: center.x, y: center.y - diameter / 2 + (Self.rowHeight - StazaSpacing.sm) / 2)
                }
            }
        }
        .frame(height: totalHeight)
        .background(alignment: .top) {
            // Invisible per-row anchors so callers can scroll a node into view.
            VStack(spacing: 0) {
                ForEach(0..<layout.rowCount, id: \.self) { row in
                    Color.clear
                        .frame(height: row == 1 ? Self.rowHeight + Self.laneHeaderHeight : Self.rowHeight)
                        .id(Self.rowAnchorId(sport: sport, row: row))
                }
            }
            .padding(.top, Self.topPadding)
        }
        .accessibilityElement(children: .contain)
    }

    private func laneGuides(columnWidth: CGFloat) -> some View {
        Canvas { context, size in
            for lane in layout.lanes {
                let x = (CGFloat(lane.col) + 0.5) * columnWidth
                var path = Path()
                path.move(to: CGPoint(x: x, y: rowTop(1)))
                path.addLine(to: CGPoint(x: x, y: size.height))
                context.stroke(path, with: .color(StazaColor.border.opacity(0.35)), style: StrokeStyle(lineWidth: 1, dash: [1, 6]))
            }
        }
        .accessibilityHidden(true)
    }

    private func connectors(centers: [String: CGPoint]) -> some View {
        Canvas { context, _ in
            for edge in layout.edges {
                guard let from = centers[edge.fromId], let to = centers[edge.toId] else { continue }
                var path = Path()
                path.move(to: from)
                let midY = (from.y + to.y) / 2
                path.addCurve(to: to, control1: CGPoint(x: from.x, y: midY), control2: CGPoint(x: to.x, y: midY))
                switch edge.style {
                case .active:
                    context.stroke(path, with: .color(StazaColor.accent.opacity(0.85)), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                case .reachable:
                    context.stroke(path, with: .color(StazaColor.accent.opacity(0.75)), style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [0.1, 5]))
                case .locked:
                    context.stroke(path, with: .color(StazaColor.textSubtle.opacity(edge.distant ? 0.18 : 0.4)), style: StrokeStyle(lineWidth: 1.2))
                }
            }
        }
        .accessibilityHidden(true)
    }

    private func laneHeaders(columnWidth: CGFloat) -> some View {
        ForEach(layout.lanes, id: \.branch) { lane in
            OverlineText(SkillAtlasLaneTree.laneTitle(lane.branch))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(width: columnWidth * 1.6)
                .position(x: (CGFloat(lane.col) + 0.5) * columnWidth, y: rowTop(1) - Self.laneHeaderHeight / 2)
                .accessibilityAddTraits(.isHeader)
        }
    }

    static func laneTitle(_ branch: String) -> LocalizedStringKey {
        switch branch {
        case "rush": "atlas.lane.flow"
        case "speed": "atlas.lane.speed"
        case "summit": "atlas.lane.summit"
        case "adventure": "atlas.lane.explore"
        default: "atlas.lane.endurance"
        }
    }
}

private struct SkillAtlasLaneNode: View {
    let placed: SkillAtlasLaneLayout.Placed
    let isSelected: Bool
    let isDistant: Bool
    let labelWidth: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: StazaSpacing.sm + 2) {
                SkillAtlasNodeGlyph(node: placed.node, isSelected: isSelected, linksOtherSport: !placed.externalPrerequisites.isEmpty)
                Text(verbatim: placed.node.name)
                    .font(.caption2.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                    .foregroundStyle(placed.node.state == .unlocked || placed.node.state == .unlockable
                        ? StazaColor.textPrimary
                        : StazaColor.textMuted)
                    .padding(.horizontal, 1)
                    // Lets connectors pass behind the label instead of through it.
                    .background(StazaColor.canvas.opacity(0.85), in: RoundedRectangle(cornerRadius: 4))
                    .frame(width: labelWidth)
            }
            .opacity(isDistant ? 0.55 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .accessibilityLabel(Text(verbatim: placed.node.name))
        .accessibilityValue(SkillAtlasNodeGlyph.stateLabel(placed.node.state))
        .accessibilityHint(placed.node.state == .unlockable ? Text("atlas.cost \(placed.node.cost)") : Text(verbatim: ""))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier("atlas-node-\(placed.id)")
    }
}

/// Circular node glyph matching the web atlas: state fill/ring, grant icon, tier
/// glyph, PRO crown, and an SP cost chip when the node can be unlocked.
struct SkillAtlasNodeGlyph: View {
    let node: SkillAtlasView_.Node
    var isSelected = false
    var linksOtherSport = false
    var compact = false

    static func diameter(for node: SkillAtlasView_.Node, compact: Bool = false) -> CGFloat {
        compact ? 28 : node.branch == "root" ? 52 : 44
    }

    private var diameter: CGFloat { Self.diameter(for: node, compact: compact) }

    var body: some View {
        ZStack {
            Circle()
                .fill(fill)
                .overlay(Circle().strokeBorder(ring, lineWidth: node.state == .unlocked ? 0 : 2))
                .shadow(color: node.state == .unlockable ? StazaColor.accent.opacity(0.55) : .clear, radius: compact ? 4 : 10)
            Image(systemName: icon)
                .font(.system(size: diameter * 0.4, weight: .semibold))
                .foregroundStyle(iconColor)
            if isSelected {
                Circle()
                    .strokeBorder(StazaColor.textPrimary, lineWidth: 2)
                    .padding(-5)
            }
        }
        .frame(width: diameter, height: diameter)
        .overlay(alignment: .topLeading) {
            if !compact, node.branch != "root", let tier = node.tier {
                badge(Text(verbatim: tier.glyph), tint: StazaColor.textMuted)
                    .offset(x: -6, y: -6)
            }
        }
        .overlay(alignment: .topTrailing) {
            if !compact, node.premium, node.state != .unlocked {
                badge(Image(systemName: "crown.fill"), tint: StazaColor.rarityEpic)
                    .offset(x: 6, y: -6)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if !compact, linksOtherSport {
                badge(Image(systemName: "arrow.up.right"), tint: StazaColor.markerRing)
                    .offset(x: 6, y: 2)
            }
        }
        .overlay(alignment: .bottom) {
            if !compact, node.state == .unlockable {
                Text(verbatim: "\(node.cost) SP")
                    .font(.system(size: 10, weight: .bold).monospacedDigit())
                    .foregroundStyle(StazaColor.onAccent)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(Capsule().fill(StazaColor.accent))
                    .offset(y: 8)
            }
        }
        .accessibilityHidden(true)
    }

    private func badge(_ content: some View, tint: Color) -> some View {
        content
            .font(.system(size: 8, weight: .heavy))
            .foregroundStyle(tint)
            .frame(width: 18, height: 18)
            .background(Circle().fill(StazaColor.surfaceRaised))
            .overlay(Circle().strokeBorder(tint.opacity(0.6), lineWidth: 1))
    }

    private var fill: Color {
        switch node.state {
        case .unlocked: StazaColor.accent
        case .unlockable: StazaColor.surfaceRaised
        case .locked, .premiumLocked: StazaColor.surface
        }
    }

    private var ring: Color {
        switch node.state {
        case .unlocked: .clear
        case .unlockable: StazaColor.accent
        case .locked: StazaColor.borderStrong
        case .premiumLocked: StazaColor.rarityEpic.opacity(0.7)
        }
    }

    private var iconColor: Color {
        switch node.state {
        case .unlocked: StazaColor.onAccent
        case .unlockable: StazaColor.accent
        case .locked, .premiumLocked: StazaColor.textSubtle
        }
    }

    private var icon: String {
        if node.branch == "root" { return Self.sportIcon(node.sport) }
        if node.state == .unlocked, node.grant.type != "badge" { return "checkmark" }
        switch node.grant.type {
        case "tree_access": return "safari"
        case "quest_unlock": return "flag.fill"
        case "world_filter": return "globe"
        case "segment_filter": return "point.topleft.down.to.point.bottomright.curvepath"
        case "title": return "rosette"
        case "badge": return "checkmark.shield"
        default: return "circle"
        }
    }

    static func sportIcon(_ sport: String) -> String {
        switch sport {
        case "running": "figure.run"
        case "hiking": "figure.hiking"
        default: "figure.outdoor.cycle"
        }
    }

    static func stateLabel(_ state: SkillAtlasView_.Node.State) -> Text {
        switch state {
        case .unlocked: Text("atlas.state.unlocked")
        case .unlockable: Text("atlas.state.unlockable")
        case .locked: Text("quests.state.locked")
        case .premiumLocked: Text("atlas.state.premium")
        }
    }
}
