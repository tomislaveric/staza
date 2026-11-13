import SwiftUI

/// Bottom panel for "Explore this Area": configure, pick a proposal, tweak, confirm.
struct ExplorePanel: View {
    let model: ExploreModel
    @Environment(\.locale) private var locale
    @Environment(AppContainer.self) private var container

    var body: some View {
        StazaCard {
            VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                switch model.phase {
                case .idle: EmptyView()
                case .configure, .generating: configure
                case .proposals, .confirming: proposals
                }
                if let failure = model.failure {
                    Text(message(failure)).font(StazaFont.caption).foregroundStyle(.red)
                }
            }
        }
        .padding(StazaSpacing.md)
        .accessibilityIdentifier("explorePanel")
    }

    private var generating: Bool { model.phase == .generating }

    private var configure: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            Text("explore.title").font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
            if model.userLocation != nil {
                Picker("explore.start", selection: Binding(get: { model.useUserLocation }, set: { model.useUserLocation = $0 })) {
                    Text("explore.start.center").tag(false)
                    Text("explore.start.location").tag(true)
                }
                .pickerStyle(.segmented)
                .disabled(generating)
            } else {
                Text("explore.start.centerHint").font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
            }
            Text("explore.length").font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
            Picker("explore.length", selection: Binding(get: { model.distanceKm }, set: { model.distanceKm = $0 })) {
                ForEach(ExploreModel.distancePresetsKm, id: \.self) { Text(verbatim: "\($0) km").tag($0) }
            }
            .pickerStyle(.segmented)
            .disabled(generating)
            HStack {
                Button("explore.cancel", role: .cancel) { model.cancel() }.buttonStyle(.bordered)
                Spacer()
                Button {
                    Task { await model.generate() }
                } label: {
                    if generating { SwiftUI.ProgressView() } else { Text("explore.generate") }
                }
                .buttonStyle(.borderedProminent)
                .disabled(generating)
                .accessibilityIdentifier("exploreGenerate")
            }
        }
    }

    private var proposals: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: StazaSpacing.sm) {
                    ForEach(model.proposals) { proposalCard($0) }
                }
            }
            if let selected = model.selected {
                if selected.constraintFit == "short" || selected.constraintFit == "long" {
                    Text(selected.constraintFit == "short" ? "explore.fit.short" : "explore.fit.long")
                        .font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                }
                targets
            }
            HStack {
                Button("explore.changeRide") { model.changeRide() }.buttonStyle(.bordered)
                Spacer()
                if model.isCustomized {
                    Button("explore.reset") { model.reset() }.buttonStyle(.bordered).disabled(model.isRerouting)
                }
                Button {
                    Task { if await model.confirm() { container.playerDataChanged() } }
                } label: {
                    if model.phase == .confirming { SwiftUI.ProgressView() } else { Text("explore.confirm") }
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.phase == .confirming || model.isRerouting)
                .accessibilityIdentifier("exploreConfirm")
            }
        }
    }

    private func proposalCard(_ proposal: RouteProposal) -> some View {
        let selected = proposal.id == model.selectedId
        return Button { model.select(proposal.id) } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(label(proposal.label)).font(StazaFont.headline)
                Text(verbatim: StazaFormat.distance(meters: proposal.distanceM, locale: locale))
                    .font(StazaFont.caption)
                Text(verbatim: duration(proposal.durationS)).font(StazaFont.caption)
            }
            .foregroundStyle(selected ? StazaColor.onAccent : StazaColor.textPrimary)
            .padding(StazaSpacing.sm)
            .frame(minWidth: 96, alignment: .leading)
            .background(selected ? StazaColor.accent : StazaColor.surfaceRaised, in: RoundedRectangle(cornerRadius: StazaRadius.card))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var targets: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.xs) {
            HStack {
                Text("explore.destinations").font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                Spacer()
                if model.isRerouting { SwiftUI.ProgressView() }
                Menu("explore.add") {
                    ForEach(model.addableTargets.prefix(30)) { item in
                        Button(item.name) { Task { await model.add(item.id) } }
                    }
                }
                .disabled(model.isRerouting || model.addableTargets.isEmpty)
            }
            ForEach(model.includedTargets) { item in
                HStack {
                    Text(verbatim: item.name).font(StazaFont.body).foregroundStyle(StazaColor.textPrimary).lineLimit(1)
                    Spacer()
                    Button {
                        Task { await model.remove(item.id) }
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .disabled(model.isRerouting || model.includedTargets.count <= 1)
                    .accessibilityLabel(Text("explore.remove"))
                }
            }
        }
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
