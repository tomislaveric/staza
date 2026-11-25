import SwiftUI

/// Sheet header while planning: title and a close button that discards the plan.
struct RoutePlannerHeader: View {
    let planner: RoutePlannerModel

    var body: some View {
        HStack(spacing: StazaSpacing.md) {
            IconBadge(systemImage: "point.topleft.down.to.point.bottomright.curvepath", tint: StazaColor.accent, size: 40)
            VStack(alignment: .leading, spacing: StazaSpacing.xxs) {
                Text("planner.title")
                    .font(StazaFont.title3)
                    .foregroundStyle(StazaColor.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text("planner.subtitle")
                    .font(StazaFont.footnote)
                    .foregroundStyle(StazaColor.textMuted)
            }
            Spacer(minLength: StazaSpacing.sm)
            SheetCloseButton { planner.close() }
                .disabled(planner.status == .saving)
        }
        .padding(.horizontal, StazaSpacing.md)
        .padding(.bottom, StazaSpacing.md)
    }
}

/// Manual "Plan a route": the player chooses the stops, Staza only connects them.
struct RoutePlannerPanel: View {
    let planner: RoutePlannerModel
    let userLocation: GeoPoint?
    let onSuggest: () -> Void
    let onSave: () -> Void
    @Environment(\.locale) private var locale
    @State private var confirmingSuggest = false

    var body: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.md) {
            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                SectionHeader("planner.sport")
                Picker("planner.sport", selection: Binding(get: { planner.sport }, set: { planner.setSport($0) })) {
                    ForEach(RoutePlannerModel.Sport.allCases) { Text(sportLabel($0)).tag($0) }
                }
                .pickerStyle(.segmented)
                .disabled(!planner.isIdle)
            }

            RouteIntentPicker(intent: Binding(get: { planner.intent }, set: { planner.intent = $0 }))
                .disabled(!planner.isIdle)
                .accessibilityIdentifier("plannerIntent")

            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                SectionHeader("planner.routeShape")
                Picker("planner.routeType", selection: Binding(get: { planner.routeType }, set: { planner.setRouteType($0) })) {
                    Text("planner.roundTrip").tag(RoutePlannerModel.RouteType.roundTrip)
                    Text("planner.oneWay").tag(RoutePlannerModel.RouteType.pointToPoint)
                }
                .pickerStyle(.segmented)
                .disabled(!planner.isIdle)
                if planner.routeType == .pointToPoint {
                    pointRow("planner.end", point: planner.end, mode: .pickEnd)
                }
            }

            stops

            startSection
            result
            if let failure = planner.failure {
                Label { message(failure) } icon: { Image(systemName: "exclamationmark.triangle.fill") }
                    .font(StazaFont.footnote)
                    .foregroundStyle(StazaColor.danger)
                    .accessibilityIdentifier("plannerError")
            }
            actions
            Text("planner.disclaimer").font(StazaFont.caption).foregroundStyle(StazaColor.textSubtle)
        }
        .padding(.horizontal, StazaSpacing.md)
        .padding(.bottom, StazaSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("routePlanner")
    }

    // MARK: Points

    private func pointRow(_ title: LocalizedStringKey, point: GeoPoint?, mode: RoutePlannerModel.MapMode) -> some View {
        let picking = planner.mapMode == mode
        return HStack(spacing: StazaSpacing.sm) {
            VStack(alignment: .leading, spacing: StazaSpacing.xxs) {
                OverlineText(title)
                if let point {
                    Text(verbatim: format(point)).font(StazaFont.footnote.monospacedDigit()).foregroundStyle(StazaColor.textPrimary)
                } else {
                    Text("planner.notSet").font(StazaFont.footnote).foregroundStyle(StazaColor.textMuted)
                }
            }
            Spacer(minLength: StazaSpacing.sm)
            if picking {
                Label("planner.hint.end", systemImage: "hand.tap")
                    .font(StazaFont.footnote)
                    .foregroundStyle(StazaColor.accent)
            } else {
                Button("planner.selectOnMap") { planner.toggleMapMode(mode) }
                    .buttonStyle(.stazaSecondary)
                    .disabled(!planner.isIdle)
            }
        }
        .disabled(!planner.isIdle)
    }

    private var startSection: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            SectionHeader("planner.start")
            if planner.start != nil {
                HStack(spacing: StazaSpacing.sm) {
                    Label("planner.start.set", systemImage: "location.fill")
                        .font(StazaFont.subheadline)
                        .foregroundStyle(StazaColor.textPrimary)
                    Spacer(minLength: StazaSpacing.sm)
                    Menu {
                        Button("planner.selectOnMap", systemImage: "map") {
                            planner.toggleMapMode(.pickStart)
                        }
                        if let userLocation {
                            Button("planner.locate", systemImage: "location.fill") {
                                planner.setStart(userLocation)
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .foregroundStyle(StazaColor.textPrimary)
                            .frame(minWidth: 36, minHeight: 36)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!planner.isIdle)
                    .accessibilityLabel(Text("planner.start.change"))
                }
            } else {
                HStack(spacing: StazaSpacing.sm) {
                    VStack(alignment: .leading, spacing: StazaSpacing.xxs) {
                        if planner.mapMode == .pickStart {
                            Label("planner.hint.start", systemImage: "hand.tap")
                                .font(StazaFont.footnote)
                                .foregroundStyle(StazaColor.accent)
                        } else {
                            Text("planner.start.prompt")
                                .font(StazaFont.footnote)
                                .foregroundStyle(StazaColor.textMuted)
                        }
                    }
                    Spacer(minLength: StazaSpacing.xs)
                    if planner.mapMode != .pickStart {
                        Button("planner.selectOnMap", systemImage: "map") {
                            planner.toggleMapMode(.pickStart)
                        }
                        .buttonStyle(.stazaSecondary)
                        .disabled(!planner.isIdle)
                    }
                    if let userLocation {
                        Button { planner.setStart(userLocation) } label: {
                            Image(systemName: "location.fill")
                                .frame(minWidth: 36, minHeight: 36)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(!planner.isIdle)
                        .accessibilityLabel(Text("planner.locate"))
                    }
                }
            }
            if planner.mapMode == .pickStart, planner.start != nil {
                Label("planner.hint.start", systemImage: "hand.tap")
                    .font(StazaFont.footnote)
                    .foregroundStyle(StazaColor.accent)
            }
        }
        .accessibilityIdentifier("plannerStart")
    }

    // MARK: Stops

    @ViewBuilder
    private var stops: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            SectionHeader("planner.stops")
            Text("planner.stops.mapHint")
                .font(StazaFont.footnote)
                .foregroundStyle(StazaColor.textMuted)
            if planner.stops.isEmpty {
                Text("planner.stops.empty").font(StazaFont.footnote).foregroundStyle(StazaColor.textMuted)
            } else {
                let dropped = Set(planner.droppedStops.map(\.key))
                ForEach(Array(planner.stops.enumerated()), id: \.element.key) { index, stop in
                    stopRow(stop, index: index, dropped: dropped.contains(stop.key))
                }
                HStack(spacing: StazaSpacing.sm) {
                    Text(planner.keepOrder ? "planner.order.kept" : "planner.order.auto")
                        .font(StazaFont.caption).foregroundStyle(StazaColor.textMuted)
                    if planner.keepOrder {
                        Button("planner.order.reset") { planner.autoOrder() }
                            .font(StazaFont.caption.weight(.semibold))
                            .foregroundStyle(StazaColor.accent)
                    }
                }
            }
        }
        .accessibilityIdentifier("plannerStops")
    }

    private func stopRow(_ stop: PlannerStop, index: Int, dropped: Bool) -> some View {
        let focused = planner.focusedStopKey == stop.key
        return HStack(spacing: StazaSpacing.sm) {
            Button { planner.focus(stop) } label: {
                HStack(spacing: StazaSpacing.sm) {
                    Text(verbatim: "\(index + 1)")
                        .font(StazaFont.caption.monospacedDigit().weight(.bold))
                        .foregroundStyle(StazaColor.onAccent)
                        .frame(width: 22, height: 22)
                        .background(dropped ? StazaColor.textSubtle : StazaColor.accent, in: Circle())
                    Image(systemName: icon(stop)).foregroundStyle(tint(stop)).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(verbatim: name(stop)).font(StazaFont.subheadline.weight(.medium)).foregroundStyle(StazaColor.textPrimary).lineLimit(1)
                        if dropped {
                            Text("planner.stop.dropped").font(StazaFont.caption).foregroundStyle(StazaColor.danger)
                        }
                    }
                    Spacer(minLength: StazaSpacing.xs)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(Text("planner.stop.showOnMap"))
            .accessibilityAddTraits(focused ? .isSelected : [])
            iconButton("chevron.up", label: "planner.stop.up", disabled: index == 0) {
                planner.move(from: IndexSet(integer: index), to: index - 1)
            }
            iconButton("chevron.down", label: "planner.stop.down", disabled: index == planner.stops.count - 1) {
                planner.move(from: IndexSet(integer: index), to: index + 2)
            }
            iconButton("xmark.circle.fill", label: "planner.stop.remove", disabled: false) { planner.remove(stop) }
        }
        .padding(.horizontal, StazaSpacing.xs)
        .background(focused ? StazaColor.surfaceRaised : .clear, in: RoundedRectangle(cornerRadius: StazaRadius.chip))
        .overlay {
            RoundedRectangle(cornerRadius: StazaRadius.chip)
                .strokeBorder(focused ? StazaColor.accent : .clear, lineWidth: 1)
        }
        .disabled(!planner.isIdle)
        .accessibilityElement(children: .contain)
    }

    private func iconButton(_ systemImage: String, label: LocalizedStringKey, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .foregroundStyle(StazaColor.textMuted)
                .frame(minWidth: 32, minHeight: 32)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.3 : 1)
        .accessibilityLabel(Text(label))
    }

    private func name(_ stop: PlannerStop) -> String {
        switch stop {
        case .flowline(let flowline): flowline.name
        case .collectible(let item): item.name
        case .waypoint(let point): String(localized: "planner.stop.waypoint \(format(point))", locale: locale)
        }
    }

    private func icon(_ stop: PlannerStop) -> String {
        switch stop {
        case .flowline: "point.topleft.down.to.point.bottomright.curvepath"
        case .collectible(let item): WorldCategory.systemImage(item.primaryCategory)
        case .waypoint: "mappin.and.ellipse"
        }
    }

    private func tint(_ stop: PlannerStop) -> Color {
        switch stop {
        case .flowline(let flowline): flowline.resolvedCharacter.primary?.tint ?? StazaColor.textMuted
        case .collectible(let item): item.found ? StazaColor.success : StazaColor.textMuted
        case .waypoint: StazaColor.accent
        }
    }

    // MARK: Result and actions

    @ViewBuilder
    private var result: some View {
        if let proposal = planner.proposal {
            StazaCard(tint: StazaColor.accent) {
                VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                    Text(verbatim: StazaFormat.distance(meters: proposal.distanceM, locale: locale))
                        .font(StazaFont.metricLarge)
                        .foregroundStyle(StazaColor.textPrimary)
                    MetricLine(items: metrics(proposal))
                }
            }
            .accessibilityIdentifier("plannerResult")
        }
    }

    /// Without stops, "Generate route" leads; once there are stops, connecting them does.
    private var suggestLeads: Bool { planner.stops.isEmpty && planner.proposal == nil }

    private var actions: some View {
        HStack(spacing: StazaSpacing.sm) {
            Button {
                if planner.suggestReplacesOwnStops { confirmingSuggest = true } else { onSuggest() }
            } label: {
                if planner.status == .suggesting {
                    SwiftUI.ProgressView().tint(suggestLeads ? StazaColor.onAccent : StazaColor.accent)
                } else {
                    Label("planner.suggest", systemImage: "sparkles")
                }
            }
            .buttonStyle(suggestLeads ? .stazaPrimaryWide : .stazaSecondary)
            .disabled(!planner.isIdle || planner.start == nil)
            .accessibilityIdentifier("plannerSuggest")
            .confirmationDialog("planner.suggest.replace.title", isPresented: $confirmingSuggest, titleVisibility: .visible) {
                Button("planner.suggest.replace.confirm", role: .destructive, action: onSuggest)
                Button("action.cancel", role: .cancel) {}
            } message: {
                Text("planner.suggest.replace.message")
            }

            if planner.proposal == nil {
                Button { Task { await planner.route() } } label: {
                    if planner.status == .routing {
                        SwiftUI.ProgressView().tint(suggestLeads ? StazaColor.accent : StazaColor.onAccent)
                    } else {
                        Label("planner.route", systemImage: "arrow.triangle.turn.up.right.diamond")
                    }
                }
                .buttonStyle(suggestLeads ? .stazaSecondary : .stazaPrimaryWide)
                .disabled(!planner.isIdle || planner.start == nil || planner.stops.isEmpty)
                .accessibilityIdentifier("plannerRoute")
            } else {
                Button(action: onSave) {
                    if planner.status == .saving {
                        SwiftUI.ProgressView().tint(StazaColor.onAccent)
                    } else {
                        Label("planner.save", systemImage: "square.and.arrow.down")
                    }
                }
                .buttonStyle(.stazaPrimaryWide)
                .disabled(!planner.isIdle)
                .accessibilityIdentifier("plannerSave")
            }
        }
    }

    private func metrics(_ proposal: RouteProposal) -> [String] {
        let minutes = Int((proposal.durationS / 60).rounded())
        var items = [minutes >= 60 ? "\(minutes / 60) h \(minutes % 60) min" : "\(minutes) min"]
        if let gain = proposal.elevationGainM, gain > 0 { items.append("\(Int(gain.rounded())) m ↑") }
        return items
    }

    private func format(_ point: GeoPoint) -> String {
        String(format: "%.4f, %.4f", point.lat, point.lon)
    }

    private func sportLabel(_ sport: RoutePlannerModel.Sport) -> LocalizedStringKey {
        switch sport {
        case .cycling: "planner.sport.cycling"
        case .running: "planner.sport.running"
        case .hiking: "planner.sport.hiking"
        }
    }

    private func message(_ failure: RoutePlannerModel.Failure) -> Text {
        switch failure {
        case .missingStart: Text("planner.error.start")
        case .missingEnd: Text("planner.error.end")
        case .noStops: Text("planner.error.noStops")
        case .noRoute: Text("planner.error.noRoute")
        case .noSuggestion: Text("planner.error.noSuggestion")
        case .server(let message?): Text(verbatim: message)
        case .server(nil): Text("planner.error.generic")
        }
    }
}
