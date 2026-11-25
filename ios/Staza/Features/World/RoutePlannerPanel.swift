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

/// The route planner wizard: sport, route shape, then three generated routes. The chosen route's card
/// sits above its stops; the other routes stay as slim rows to switch to.
struct RoutePlannerPanel: View {
    let planner: RoutePlannerModel
    let userLocation: GeoPoint?
    let onSave: () -> Void
    @Environment(\.locale) private var locale
    @State private var pendingChoice: RouteProposal?

    var body: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.md) {
            if planner.showsSteps { steps } else { summary }
            if planner.shapeChosen, planner.routeType == .pointToPoint {
                pointRow("planner.end", point: planner.end, mode: .pickEnd)
            }
            if planner.start == nil || planner.mapMode == .pickStart { startSection }

            if planner.status == .suggesting { generating }
            chosen
            if showsStops { stops }
            alternatives
            if let failure = planner.failure { failureRow(failure) }

            if planner.start != nil, planner.mapMode != .pickStart, planner.stepsDone { startSection }
            Text("planner.disclaimer").font(StazaFont.caption).foregroundStyle(StazaColor.textSubtle)
        }
        .padding(.horizontal, StazaSpacing.md)
        .padding(.bottom, StazaSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("routePlanner")
        .confirmationDialog("planner.suggest.replace.title", isPresented: Binding(
            get: { pendingChoice != nil }, set: { if !$0 { pendingChoice = nil } }
        ), titleVisibility: .visible, presenting: pendingChoice) { proposal in
            Button("planner.suggest.replace.confirm", role: .destructive) { planner.choose(proposal) }
            Button("action.cancel", role: .cancel) {}
        } message: { _ in
            Text("planner.suggest.replace.message")
        }
    }

    /// Stops show once there is a route to edit or the player brought own stops.
    private var showsStops: Bool { planner.chosenIntent != nil || planner.proposal != nil || !planner.stops.isEmpty }

    // MARK: Steps

    private var steps: some View {
        VStack(alignment: .leading, spacing: StazaSpacing.md) {
            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                SectionHeader("planner.sport")
                HStack(spacing: StazaSpacing.sm) {
                    ForEach(RoutePlannerModel.Sport.allCases) { sport in
                        choiceButton(sportLabel(sport), systemImage: sportIcon(sport),
                                     selected: planner.sportChosen && planner.sport == sport) {
                            planner.chooseSport(sport)
                        }
                        .accessibilityIdentifier("plannerSport-\(sport.rawValue)")
                    }
                }
            }
            if planner.sportChosen {
                VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                    SectionHeader("planner.routeShape")
                    HStack(spacing: StazaSpacing.sm) {
                        ForEach([RoutePlannerModel.RouteType.roundTrip, .pointToPoint], id: \.rawValue) { type in
                            choiceButton(shapeLabel(type), systemImage: shapeIcon(type),
                                         selected: planner.shapeChosen && planner.routeType == type) {
                                planner.chooseShape(type)
                            }
                            .accessibilityIdentifier("plannerShape-\(type.rawValue)")
                        }
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .animation(.snappy, value: planner.sportChosen)
        .disabled(!planner.isIdle)
    }

    private func choiceButton(_ title: LocalizedStringKey, systemImage: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: StazaSpacing.xs) {
                Image(systemName: systemImage).font(.title2).frame(height: 28)
                Text(title).font(StazaFont.caption.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundStyle(selected ? StazaColor.onAccent : StazaColor.textPrimary)
            .frame(maxWidth: .infinity, minHeight: 64)
            .background(selected ? StazaColor.accent : StazaColor.surfaceRaised, in: RoundedRectangle(cornerRadius: StazaRadius.chip))
            .contentShape(RoundedRectangle(cornerRadius: StazaRadius.chip))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    /// The collapsed steps: one row with the chosen sport and shape; tapping it reopens them.
    private var summary: some View {
        Button { withAnimation(.snappy) { planner.reopenSteps() } } label: {
            HStack(spacing: StazaSpacing.sm) {
                Label(sportLabel(planner.sport), systemImage: sportIcon(planner.sport))
                Text(verbatim: "·").foregroundStyle(StazaColor.textSubtle)
                Label(shapeLabel(planner.routeType), systemImage: shapeIcon(planner.routeType))
                Spacer(minLength: StazaSpacing.xs)
                Text("planner.steps.change").foregroundStyle(StazaColor.accent)
            }
            .font(StazaFont.subheadline.weight(.medium))
            .foregroundStyle(StazaColor.textPrimary)
            .padding(.horizontal, StazaSpacing.sm)
            .frame(minHeight: 44)
            .background(StazaColor.surfaceRaised, in: RoundedRectangle(cornerRadius: StazaRadius.chip))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!planner.isIdle)
        .accessibilityIdentifier("plannerSummary")
    }

    // MARK: Routes

    private var generating: some View {
        HStack(spacing: StazaSpacing.sm) {
            SwiftUI.ProgressView()
            Text("planner.generating").font(StazaFont.subheadline).foregroundStyle(StazaColor.textMuted)
        }
        .accessibilityIdentifier("plannerGenerating")
    }

    /// The chosen (or own) route: name, feel, metrics and Save, above its stops.
    @ViewBuilder
    private var chosen: some View {
        if planner.chosenIntent != nil || planner.proposal != nil {
            StazaCard(tint: StazaColor.accent) {
                VStack(alignment: .leading, spacing: StazaSpacing.sm) {
                    HStack(alignment: .firstTextBaseline) {
                        if let intent = planner.chosenIntent {
                            Text(verbatim: intent.name).font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                        } else {
                            Text("planner.route.own").font(StazaFont.headline).foregroundStyle(StazaColor.textPrimary)
                        }
                        Spacer(minLength: StazaSpacing.xs)
                        if planner.status == .routing { SwiftUI.ProgressView() }
                    }
                    if let proposal = planner.proposal {
                        Text(verbatim: StazaFormat.distance(meters: proposal.distanceM, locale: locale))
                            .font(StazaFont.metricLarge)
                            .foregroundStyle(StazaColor.textPrimary)
                        MetricLine(items: metrics(proposal))
                    }
                    if let intent = planner.chosenIntent {
                        Text(intent.summary).font(StazaFont.footnote).foregroundStyle(StazaColor.textMuted)
                    }
                    Button(action: onSave) {
                        if planner.status == .saving {
                            SwiftUI.ProgressView().tint(StazaColor.onAccent)
                        } else {
                            Label("planner.save", systemImage: "square.and.arrow.down")
                        }
                    }
                    .buttonStyle(.stazaPrimaryWide)
                    .disabled(!planner.isIdle || planner.proposal == nil)
                    .accessibilityIdentifier("plannerSave")
                }
            }
            .accessibilityIdentifier("plannerResult")
        }
    }

    /// Before a choice: the three routes as rows. After: the others, collapsed under the stops.
    @ViewBuilder
    private var alternatives: some View {
        let others = planner.otherAlternatives
        if !others.isEmpty {
            VStack(alignment: .leading, spacing: StazaSpacing.xs) {
                if planner.chosenIntent == nil {
                    SectionHeader("planner.routes")
                    Text("planner.routes.hint").font(StazaFont.footnote).foregroundStyle(StazaColor.textMuted)
                } else {
                    SectionHeader("planner.routes.others")
                }
                ForEach(others) { proposal in
                    alternativeRow(proposal, compact: planner.chosenIntent != nil)
                }
            }
            .disabled(!planner.isIdle)
            .accessibilityIdentifier("plannerAlternatives")
        }
    }

    private func alternativeRow(_ proposal: RouteProposal, compact: Bool) -> some View {
        Button {
            if planner.suggestReplacesOwnStops { pendingChoice = proposal } else { planner.choose(proposal) }
        } label: {
            HStack(alignment: compact ? .center : .top, spacing: StazaSpacing.sm) {
                Image(systemName: intentIcon(proposal.intent))
                    .foregroundStyle(StazaColor.accent)
                    .frame(width: 24)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: StazaSpacing.xxs) {
                    HStack(spacing: StazaSpacing.sm) {
                        Text(verbatim: proposal.intent?.name ?? proposal.label)
                            .font(StazaFont.subheadline.weight(.semibold))
                            .foregroundStyle(StazaColor.textPrimary)
                        Spacer(minLength: StazaSpacing.xs)
                        Text(verbatim: ([StazaFormat.distance(meters: proposal.distanceM, locale: locale)] + metrics(proposal).prefix(1)).joined(separator: " · "))
                            .font(StazaFont.footnote.monospacedDigit())
                            .foregroundStyle(StazaColor.textMuted)
                    }
                    if !compact, let intent = proposal.intent {
                        Text(intent.summary).font(StazaFont.caption).foregroundStyle(StazaColor.textMuted).lineLimit(2)
                    }
                }
                Image(systemName: "chevron.right").font(StazaFont.caption).foregroundStyle(StazaColor.textSubtle)
            }
            .padding(.horizontal, StazaSpacing.sm)
            .padding(.vertical, compact ? StazaSpacing.xs : StazaSpacing.sm)
            .background(StazaColor.surfaceRaised, in: RoundedRectangle(cornerRadius: StazaRadius.chip))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("plannerAlternative-\(proposal.intent?.rawValue ?? proposal.id)")
    }

    private func failureRow(_ failure: RoutePlannerModel.Failure) -> some View {
        HStack(spacing: StazaSpacing.sm) {
            Label { message(failure) } icon: { Image(systemName: "exclamationmark.triangle.fill") }
                .font(StazaFont.footnote)
                .foregroundStyle(StazaColor.danger)
            Spacer(minLength: StazaSpacing.xs)
            if canRetry {
                Button("planner.retry", action: retry)
                    .buttonStyle(.stazaSecondary)
                    .disabled(!planner.isIdle)
                    .accessibilityIdentifier("plannerRetry")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("plannerError")
    }

    private var routesStops: Bool { planner.chosenIntent != nil || !planner.stops.isEmpty }

    private var canRetry: Bool { routesStops ? !planner.stops.isEmpty && planner.start != nil : planner.canGenerate }

    /// Routes a chosen or own route again, else generates the three routes again.
    private func retry() {
        if routesStops { Task { await planner.route() } } else { planner.requestGeneration() }
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
                if planner.proposal == nil, planner.chosenIntent == nil, planner.failure == nil {
                    Button { Task { await planner.route() } } label: {
                        if planner.status == .routing {
                            SwiftUI.ProgressView().tint(StazaColor.onAccent)
                        } else {
                            Label("planner.route", systemImage: "arrow.triangle.turn.up.right.diamond")
                        }
                    }
                    .buttonStyle(.stazaPrimaryWide)
                    .disabled(!planner.isIdle || planner.start == nil)
                    .accessibilityIdentifier("plannerRoute")
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

    private func metrics(_ proposal: RouteProposal) -> [String] {
        let minutes = Int((proposal.durationS / 60).rounded())
        var items = [minutes >= 60 ? "\(minutes / 60) h \(minutes % 60) min" : "\(minutes) min"]
        if let gain = proposal.elevationGainM, gain > 0 { items.append("\(Int(gain.rounded())) m ↑") }
        return items
    }

    private func format(_ point: GeoPoint) -> String {
        String(format: "%.4f, %.4f", point.lat, point.lon)
    }

    private func sportIcon(_ sport: RoutePlannerModel.Sport) -> String {
        switch sport {
        case .cycling: "bicycle"
        case .running: "figure.run"
        case .hiking: "figure.hiking"
        }
    }

    private func shapeLabel(_ type: RoutePlannerModel.RouteType) -> LocalizedStringKey {
        type == .roundTrip ? "planner.roundTrip" : "planner.oneWay"
    }

    private func shapeIcon(_ type: RoutePlannerModel.RouteType) -> String {
        type == .roundTrip ? "arrow.triangle.2.circlepath" : "arrow.right"
    }

    private func intentIcon(_ intent: RouteIntent?) -> String {
        switch intent {
        case .flow: "wind"
        case .chill: "leaf"
        case .explore: "binoculars"
        case nil: "point.topleft.down.to.point.bottomright.curvepath"
        }
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
