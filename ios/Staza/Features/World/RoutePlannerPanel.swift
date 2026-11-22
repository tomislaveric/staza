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

    var body: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.md) {
            Picker("planner.sport", selection: Binding(get: { planner.sport }, set: { planner.setSport($0) })) {
                ForEach(RoutePlannerModel.Sport.allCases) { Text(sportLabel($0)).tag($0) }
            }
            .pickerStyle(.segmented)
            .disabled(!planner.isIdle)

            pointRow("planner.start", point: planner.start, mode: .pickStart) {
                if let userLocation {
                    Button { planner.setStart(userLocation) } label: { Image(systemName: "location.fill") }
                        .buttonStyle(.stazaSecondary)
                        .accessibilityLabel(Text("planner.locate"))
                }
            }
            Picker("planner.routeType", selection: Binding(get: { planner.routeType }, set: { planner.setRouteType($0) })) {
                Text("planner.roundTrip").tag(RoutePlannerModel.RouteType.roundTrip)
                Text("planner.oneWay").tag(RoutePlannerModel.RouteType.pointToPoint)
            }
            .pickerStyle(.segmented)
            .disabled(!planner.isIdle)
            if planner.routeType == .pointToPoint {
                pointRow("planner.end", point: planner.end, mode: .pickEnd) { EmptyView() }
            }

            HStack(spacing: StazaSpacing.sm) {
                addButton("planner.add.flowline", mode: .addFlowline, systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                addButton("planner.add.collectible", mode: .addCollectible, systemImage: "mappin")
                addButton("planner.add.waypoint", mode: .addWaypoint, systemImage: "mappin.and.ellipse")
            }
            if let hint { Label(hint, systemImage: "hand.tap").font(StazaFont.footnote).foregroundStyle(StazaColor.accent) }

            stops
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

    private func pointRow<Extra: View>(_ title: LocalizedStringKey, point: GeoPoint?, mode: RoutePlannerModel.MapMode, @ViewBuilder extra: () -> Extra) -> some View {
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
            Button(picking ? "planner.tapMap" : "planner.selectOnMap") { planner.toggleMapMode(mode) }
                .buttonStyle(.stazaSecondary)
                .accessibilityAddTraits(picking ? .isSelected : [])
            extra()
        }
        .disabled(!planner.isIdle)
    }

    private func addButton(_ title: LocalizedStringKey, mode: RoutePlannerModel.MapMode, systemImage: String) -> some View {
        let active = planner.mapMode == mode
        return Button { planner.toggleMapMode(mode) } label: {
            VStack(spacing: StazaSpacing.xxs) {
                Image(systemName: systemImage)
                Text(title).font(StazaFont.caption.weight(.semibold)).multilineTextAlignment(.center).lineLimit(2)
            }
            .foregroundStyle(active ? StazaColor.onAccent : StazaColor.textPrimary)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(active ? StazaColor.accent : StazaColor.surfaceRaised.opacity(0.85), in: RoundedRectangle(cornerRadius: StazaRadius.chip, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: StazaRadius.chip, style: .continuous).strokeBorder(active ? StazaColor.accent : StazaColor.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!planner.isIdle)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    private var hint: LocalizedStringKey? {
        switch planner.mapMode {
        case .pickStart: "planner.hint.start"
        case .pickEnd: "planner.hint.end"
        case .addFlowline: "planner.hint.flowline"
        case .addCollectible: "planner.hint.collectible"
        case .addWaypoint: "planner.hint.waypoint"
        case nil: nil
        }
    }

    // MARK: Stops

    @ViewBuilder
    private var stops: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.sm) {
            SectionHeader("planner.stops")
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
            iconButton("chevron.up", label: "planner.stop.up", disabled: index == 0) {
                planner.move(from: IndexSet(integer: index), to: index - 1)
            }
            iconButton("chevron.down", label: "planner.stop.down", disabled: index == planner.stops.count - 1) {
                planner.move(from: IndexSet(integer: index), to: index + 2)
            }
            iconButton("xmark.circle.fill", label: "planner.stop.remove", disabled: false) { planner.remove(stop) }
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
        case .flowline(let flowline): flowline.resolvedCharacter.primary.tint
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

    private var actions: some View {
        HStack(spacing: StazaSpacing.sm) {
            Button(action: onSuggest) {
                if planner.status == .suggesting {
                    SwiftUI.ProgressView().tint(StazaColor.accent)
                } else {
                    Label("planner.suggest", systemImage: "sparkles")
                }
            }
            .buttonStyle(.stazaSecondary)
            .disabled(!planner.isIdle)
            .accessibilityIdentifier("plannerSuggest")

            if planner.proposal == nil {
                Button { Task { await planner.route() } } label: {
                    if planner.status == .routing {
                        SwiftUI.ProgressView().tint(StazaColor.onAccent)
                    } else {
                        Label("planner.route", systemImage: "arrow.triangle.turn.up.right.diamond")
                    }
                }
                .buttonStyle(.stazaPrimaryWide)
                .disabled(!planner.isIdle || planner.stops.isEmpty)
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
        case .limit(.flowline, let max): Text("planner.error.limit.flowlines \(max)")
        case .limit(.collectible, let max): Text("planner.error.limit.collectibles \(max)")
        case .limit(.waypoint, let max): Text("planner.error.limit.waypoints \(max)")
        case .server(let message?): Text(verbatim: message)
        case .server(nil): Text("planner.error.generic")
        }
    }
}
