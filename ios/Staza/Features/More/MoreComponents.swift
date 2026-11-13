import SwiftUI

/// Circular avatar showing initials, or a person glyph when no name is known.
struct MoreAvatar: View {
    var name: String?
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            Circle().fill(StazaColor.accent.opacity(0.16))
            Circle().strokeBorder(StazaColor.accent.opacity(0.5), lineWidth: 1)
            if let initials {
                Text(verbatim: initials)
                    .font(.system(size: size * 0.38, weight: .bold).width(.condensed))
                    .foregroundStyle(StazaColor.accent)
            } else {
                Image(systemName: "person.fill")
                    .font(.system(size: size * 0.42, weight: .semibold))
                    .foregroundStyle(StazaColor.accent)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private var initials: String? {
        guard let name else { return nil }
        let base = name.split(separator: "@").first.map(String.init) ?? name
        let words = base.split(whereSeparator: { $0 == " " || $0 == "." || $0 == "_" || $0 == "-" })
        let letters = words.prefix(2).compactMap(\.first).map { String($0).uppercased() }
        return letters.isEmpty ? nil : letters.joined()
    }
}

/// List row with a tinted leading icon badge.
struct MoreIconRow: View {
    let title: LocalizedStringKey
    let systemImage: String
    var tint: Color = StazaColor.accent
    var titleColor: Color = StazaColor.textPrimary

    var body: some View {
        HStack(spacing: StazaSpacing.md) {
            IconBadge(systemImage: systemImage, tint: tint, size: 32)
            Text(title).font(StazaFont.body).foregroundStyle(titleColor)
        }
        .padding(.vertical, StazaSpacing.xxs)
    }
}

/// Wrapping layout for chip collections.
struct MoreFlowLayout: Layout {
    var spacing: CGFloat = StazaSpacing.sm

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(for: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(rows.count - 1, 0))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(for: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func rows(for maxWidth: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var current = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            if needed > maxWidth, !current.indices.isEmpty {
                rows.append(current)
                current = Row()
            }
            current.width = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            current.height = max(current.height, size.height)
            current.indices.append(index)
        }
        if !current.indices.isEmpty { rows.append(current) }
        return rows
    }
}
