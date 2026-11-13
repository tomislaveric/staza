import SwiftUI

/// Bottom panel for "Explore this Area": configure, pick a proposal, tweak, confirm.
struct ExplorePanel: View {
    let model: ExploreModel
    @Environment(\.locale) private var locale
    @Environment(AppContainer.self) private var container

    var body: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.md) {
            switch model.phase {
            case .idle: EmptyView()
            case .configure, .generating: configure
            case .proposals, .confirming: proposals
            }
            if let failure = model.failure {
                Label(message(failure), systemImage: "exclamationmark.triangle.fill")
                    .font(StazaFont.footnote)
                    .foregroundStyle(StazaColor.danger)
            }
        }
        .padding(StazaSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .stazaGlass()
        .padding(.horizontal, StazaSpacing.sm)
        .padding(.bottom, StazaSpacing.sm)
        .accessibilityIdentifier("explorePanel")
    }

    private var generating: Bool { model.phase == .generating }

    private var configure: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.md) {
            HStack(spacing: StazaSpacing.sm) {
                Image(systemName: "location.north.line.fill").foregroundStyle(StazaColor.accent).accessibilityHidden(true)
                OverlineText("explore.title").accessibilityAddTraits(.isHeader)
            }
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                if model.userLocation != nil {
                    Picker("explore.start", selection: Binding(get: { model.useUserLocation }, set: { model.useUserLocation = $0 })) {
                        Text("explore.start.center").tag(false)
                        Text("explore.start.location").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .disabled(generating)
                } else {
                    Label("explore.start.centerHint", systemImage: "scope")
                        .font(StazaFont.footnote).foregroundStyle(StazaColor.textMuted)
                }
            }
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                OverlineText("explore.length")
                HStack(spacing: StazaSpacing.sm) {
                    ForEach(ExploreModel.distancePresetsKm, id: \.self) { preset in
                        lengthChip(preset)
                    }
                }
            }
            HStack(spacing: StazaSpacing.sm) {
                Button("explore.cancel", role: .cancel) { model.cancel() }.buttonStyle(.stazaSecondary)
                Button {
                    Task { await model.generate() }
                } label: {
                    if generating {
                        SwiftUI.ProgressView().tint(StazaColor.onAccent)
                    } else {
                        Label("explore.generate", systemImage: "sparkles")
                    }
                }
                .buttonStyle(.stazaPrimaryWide)
                .disabled(generating)
                .accessibilityIdentifier("exploreGenerate")
            }
        }
    }

    private func lengthChip(_ preset: Int) -> some View {
        let selected = model.distanceKm == preset
        return Button { model.distanceKm = preset } label: {
            Text(verbatim: "\(preset) km")
                .font(StazaFont.metric)
                .foregroundStyle(selected ? StazaColor.onAccent : StazaColor.textPrimary)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(selected ? StazaColor.accent : StazaColor.surfaceRaised.opacity(0.8), in: Capsule())
                .overlay(Capsule().strokeBorder(selected ? StazaColor.accent : StazaColor.border, lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(generating)
        .opacity(generating && !selected ? 0.5 : 1)
        .animation(.snappy(duration: 0.15), value: selected)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var proposals: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.md) {
            OverlineText("explore.title").accessibilityAddTraits(.isHeader)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: StazaSpacing.sm) {
                    ForEach(model.proposals) { proposalCard($0) }
                }
                .padding(.vertical, StazaSpacing.xxs)
            }
            .scrollClipDisabled()
            if let selected = model.selected {
                if selected.constraintFit == "short" || selected.constraintFit == "long" {
                    Label(selected.constraintFit == "short" ? "explore.fit.short" : "explore.fit.long", systemImage: "info.circle")
                        .font(StazaFont.footnote).foregroundStyle(StazaColor.textMuted)
                }
                targets
            }
            HStack(spacing: StazaSpacing.sm) {
                Button("explore.changeRide") { model.changeRide() }.buttonStyle(.stazaSecondary)
                if model.isCustomized {
                    Button {
                        model.reset()
                    } label: {
                        Image(systemName: "arrow.uturn.backward")
                    }
                    .buttonStyle(.stazaSecondary)
                    .disabled(model.isRerouting)
                    .accessibilityLabel(Text("explore.reset"))
                }
                Button {
                    Task { if await model.confirm() { container.playerDataChanged() } }
                } label: {
                    if model.phase == .confirming {
                        SwiftUI.ProgressView().tint(StazaColor.onAccent)
                    } else {
                        Label("explore.confirm", systemImage: "checkmark")
                    }
                }
                .buttonStyle(.stazaPrimaryWide)
                .disabled(model.phase == .confirming || model.isRerouting)
                .accessibilityIdentifier("exploreConfirm")
            }
        }
    }

    private func proposalCard(_ proposal: RouteProposal) -> some View {
        let selected = proposal.id == model.selectedId
        let shape = RoundedRectangle(cornerRadius: StazaRadius.card, style: .continuous)
        return Button { model.select(proposal.id) } label: {
            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                HStack(spacing: StazaSpacing.sm) {
                    OverlineText(label(proposal.label))
                    Spacer(minLength: 0)
                    if proposal.recommended == true {
                        StazaChip("explore.recommended", systemImage: "star.fill", tint: StazaColor.accent)
                    }
                }
                Text(verbatim: StazaFormat.distance(meters: proposal.distanceM, locale: locale))
                    .font(StazaFont.metricLarge)
                    .foregroundStyle(StazaColor.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                MetricLine(items: metrics(proposal))
            }
            .padding(StazaSpacing.md)
            .frame(minWidth: 160, alignment: .leading)
            .background(selected ? StazaColor.accent.opacity(0.12) : StazaColor.surface.opacity(0.85), in: shape)
            .overlay(shape.strokeBorder(selected ? StazaColor.accent : StazaColor.border, lineWidth: selected ? 2 : 1))
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .animation(.snappy(duration: 0.15), value: selected)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func metrics(_ proposal: RouteProposal) -> [String] {
        var items = [duration(proposal.durationS)]
        if let gain = proposal.elevationGainM, gain > 0 {
            items.append("\(Int(gain.rounded())) m ↑")
        }
        return items
    }

    private var targets: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            HStack(spacing: StazaSpacing.sm) {
                OverlineText("explore.destinations")
                Spacer()
                if model.isRerouting { SwiftUI.ProgressView().controlSize(.small).tint(StazaColor.accent) }
                Menu {
                    ForEach(model.addableTargets.prefix(30)) { item in
                        Button(item.name) { Task { await model.add(item.id) } }
                    }
                } label: {
                    Label("explore.add", systemImage: "plus")
                        .font(StazaFont.footnote.weight(.semibold))
                        .foregroundStyle(StazaColor.accent)
                }
                .disabled(model.isRerouting || model.addableTargets.isEmpty)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: StazaSpacing.sm) {
                    ForEach(model.includedTargets) { item in
                        destinationChip(item)
                    }
                }
            }
            .scrollClipDisabled()
        }
    }

    private func destinationChip(_ item: WorldCollectible) -> some View {
        let canRemove = !model.isRerouting && model.includedTargets.count > 1
        return HStack(spacing: StazaSpacing.xs) {
            Image(systemName: "mappin.circle.fill").foregroundStyle(StazaColor.accent).accessibilityHidden(true)
            Text(verbatim: item.name).lineLimit(1)
            Button {
                Task { await model.remove(item.id) }
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(StazaColor.textMuted)
                    .frame(minWidth: 24, minHeight: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!canRemove)
            .opacity(canRemove ? 1 : 0.35)
            .accessibilityLabel(Text("explore.remove"))
        }
        .font(StazaFont.footnote.weight(.medium))
        .foregroundStyle(StazaColor.textPrimary)
        .padding(.leading, StazaSpacing.sm)
        .padding(.trailing, StazaSpacing.xs)
        .padding(.vertical, StazaSpacing.xxs)
        .background(StazaColor.surfaceRaised.opacity(0.85), in: Capsule())
        .overlay(Capsule().strokeBorder(StazaColor.border, lineWidth: 1))
    }

    private func label(_ raw: String) -> LocalizedStringKey {
        switch raw {
        case "quick": "explore.label.quick"
        case "adventure": "explore.label.adventure"
        default: "explore.label.balanced"
        }
    }

    private func duration(_ seconds: Double) -> String {
        let minutes = Int((seconds / 60).rounded())
        return minutes >= 60 ? "\(minutes / 60) h \(minutes % 60) min" : "\(minutes) min"
    }

    private func message(_ failure: ExploreModel.Failure) -> LocalizedStringKey {
        switch failure {
        case .generate: "explore.error.generate"
        case .noRoute: "explore.error.noRoute"
        case .reroute: "explore.error.reroute"
        case .confirm: "explore.error.confirm"
        }
    }
}
