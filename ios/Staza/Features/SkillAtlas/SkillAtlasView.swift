import SwiftUI

struct SkillAtlasView: View {
    @Environment(AppContainer.self) private var container
    @Environment(\.locale) private var locale
    @State private var model: SkillAtlasModel?

    var body: some View {
        Group {
            if let model { content(model) } else { Color.clear }
        }
        .stazaScreen()
        .task(id: container.dataRevision) {
            if model == nil { model = SkillAtlasModel(api: container.apiClient) }
            await model?.load()
        }
        .accessibilityIdentifier("skillAtlasScreen")
    }

    @ViewBuilder
    private func content(_ model: SkillAtlasModel) -> some View {
        if let atlas = model.atlas {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: StazaSpacing.md) {
                        header(atlas)
                        nextUp(model)
                        if model.sports.count > 1 {
                            Picker("", selection: Binding(
                                get: { model.activeSport ?? "" },
                                set: { model.selectedSport = $0 }
                            )) {
                                ForEach(model.sports, id: \.self) { Text(verbatim: $0.capitalized).tag($0) }
                            }
                            .pickerStyle(.segmented)
                        }
                        if let layout = model.laneLayout, let sport = model.activeSport {
                            SkillAtlasLaneTree(layout: layout, sport: sport, selectedNodeId: model.selectedNodeId) { model.select($0) }
                        }
                    }
                    .padding(.horizontal, StazaSpacing.md)
                    .padding(.bottom, StazaSpacing.lg)
                }
                .refreshable { await model.load() }
                .onChange(of: model.selectedNodeId) { _, id in
                    guard let id, let sport = model.activeSport,
                          let row = model.laneLayout?.nodes.first(where: { $0.id == id })?.row else { return }
                    Task {
                        await Task.yield()
                        withAnimation(.easeInOut(duration: 0.3)) {
                            proxy.scrollTo(SkillAtlasLaneTree.rowAnchorId(sport: sport, row: row), anchor: UnitPoint(x: 0.5, y: 0.25))
                        }
                    }
                }
            }
            .sheet(isPresented: Binding(
                get: { model.selectedNode != nil },
                set: { if !$0 { model.clearSelection() } }
            )) {
                if let node = model.selectedNode {
                    SkillAtlasNodeDetail(node: node, model: model) { container.playerDataChanged() }
                        .presentationDetents([.medium, .large])
                        .presentationDragIndicator(.visible)
                        .presentationBackground(StazaColor.surface)
                }
            }
        } else if model.isLoading {
            StazaLoadingView(title: "atlas.loading")
                .frame(maxHeight: .infinity)
        } else {
            StazaStateView(systemImage: "exclamationmark.triangle.fill", tint: StazaColor.danger, title: Text("atlas.error")) {
                Button("quests.retry") { Task { await model.load() } }.buttonStyle(.stazaSecondary)
            }
            .frame(maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private func nextUp(_ model: SkillAtlasModel) -> some View {
        let nodes = model.nextUpNodes
        if !nodes.isEmpty {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                OverlineText("atlas.nextUp")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: StazaSpacing.sm) {
                        ForEach(nodes) { node in
                            Button { model.select(node.id) } label: {
                                HStack(spacing: StazaSpacing.sm) {
                                    SkillAtlasNodeGlyph(node: node, compact: true)
                                    VStack(alignment: .leading, spacing: 0) {
                                        Text(verbatim: node.name)
                                            .font(StazaFont.footnote.weight(.semibold))
                                            .foregroundStyle(StazaColor.textPrimary)
                                            .lineLimit(1)
                                        Label {
                                            Text(verbatim: "\(node.cost) SP")
                                        } icon: {
                                            Image(systemName: SkillAtlasNodeGlyph.sportIcon(node.sport))
                                        }
                                        .font(StazaFont.metricSmall)
                                        .foregroundStyle(StazaColor.accent)
                                    }
                                }
                                .padding(.vertical, StazaSpacing.sm)
                                .padding(.leading, StazaSpacing.sm)
                                .padding(.trailing, StazaSpacing.md)
                                .background(Capsule().fill(StazaColor.surfaceRaised))
                                .overlay(Capsule().strokeBorder(StazaColor.accent.opacity(0.4), lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                            .accessibilityElement(children: .combine)
                            .accessibilityIdentifier("atlas-nextup-\(node.id)")
                        }
                    }
                }
                .scrollClipDisabled()
            }
        }
    }

    private func header(_ atlas: SkillAtlasView_) -> some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.md) {
                HStack(alignment: .center, spacing: StazaSpacing.md) {
                    HeroNumber(text: StazaFormat.number(Double(atlas.balance), locale: locale))
                        .foregroundStyle(atlas.balance > 0 ? StazaColor.accent : StazaColor.textPrimary)
                    VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                        OverlineText("tab.skillAtlas")
                        Text("atlas.points \(atlas.balance)")
                            .font(StazaFont.headline)
                            .foregroundStyle(StazaColor.textPrimary)
                    }
                }
                HStack(spacing: StazaSpacing.md) {
                    StatTile(label: "atlas.stat.earned", value: StazaFormat.number(Double(atlas.earnedPoints), locale: locale))
                    StatTile(label: "atlas.stat.spent", value: StazaFormat.number(Double(atlas.spentPoints), locale: locale))
                }
                VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                    StazaProgressBar(value: atlas.nextSkillPoint.progress)
                    Text("atlas.nextPoint \(atlas.nextSkillPoint.level) \(StazaFormat.number(atlas.nextSkillPoint.xpRemaining, locale: locale))")
                        .font(StazaFont.caption)
                        .foregroundStyle(StazaColor.textMuted)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}
