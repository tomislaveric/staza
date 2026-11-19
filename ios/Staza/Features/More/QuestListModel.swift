import Foundation
import Observation

@MainActor
@Observable
final class QuestListModel {
    private(set) var quests: [AuthoredQuest] = []
    private(set) var isLoading = false
    private(set) var failed = false

    private let api: APIClient

    init(api: APIClient) { self.api = api }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response: AuthoredQuestsResponse = try await api.get("/api/authored-quests")
            quests = response.quests
            failed = false
        } catch is CancellationError {
            return
        } catch {
            failed = true
        }
    }

    /// Chains in first-seen order, with unlocked chains before fully locked ones.
    var chains: [QuestChain] {
        var order: [String] = []
        var grouped: [String: [AuthoredQuest]] = [:]
        for quest in quests {
            if grouped[quest.chainTitle] == nil { order.append(quest.chainTitle) }
            grouped[quest.chainTitle, default: []].append(quest)
        }
        let chains = order.map { QuestChain(title: $0, quests: grouped[$0]!.sorted { $0.step < $1.step }) }
        let unlocked = chains.filter { $0.quests.contains { $0.state != .locked } }
        return unlocked + chains.filter { chain in !unlocked.contains(chain) }
    }

    /// Open quests across all chains, shown first.
    var activeQuests: [AuthoredQuest] {
        chains.flatMap(\.quests).filter { $0.state == .active }
    }

    /// Chains that still have locked quests ahead; finished and active steps live in their own sections.
    var upcomingChains: [QuestChain] {
        chains.filter { chain in chain.quests.contains { $0.state == .locked } }
    }

    var finishedQuests: [AuthoredQuest] {
        chains.flatMap(\.quests).filter { $0.state == .completed }
    }
}
