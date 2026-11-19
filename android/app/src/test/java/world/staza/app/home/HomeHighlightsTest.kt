package world.staza.app.home

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import world.staza.app.atlas.SkillNode
import world.staza.app.atlas.SkillNode.State

class HomeHighlightsTest {
    private fun quest(id: String, state: String = "active", difficulty: String = "medium", xp: Double = 100.0) =
        AuthoredQuest(id, "Chain", 1, 3, "Quest $id", "D", difficulty, xp, state)

    private fun skill(
        id: String,
        state: State = State.Locked,
        cost: Int = 1,
        prerequisitesMet: Boolean = true,
        requirements: List<Pair<Double, Double>> = emptyList(),
    ) = SkillNode(
        id = id, name = id, description = "", sport = "cycling", branch = "rush", cost = cost, premium = false,
        grant = SkillNode.Grant("quest_unlock", id), state = state, prerequisitesMet = prerequisitesMet,
        requirements = requirements.map { (current, target) -> SkillNode.Requirement("Flowlines", target, current, current >= target) },
    )

    @Test
    fun featuresTheEasiestActiveQuest() {
        val quests = listOf(
            quest("hard", difficulty = "hard", xp = 50.0),
            quest("medium-rich", xp = 300.0),
            quest("done", state = "completed", difficulty = "easy"),
            quest("medium-a"),
            quest("medium-b"),
        )
        assertEquals("medium-a", HomeHighlights.featuredQuest(quests)?.id)
        assertEquals("e", HomeHighlights.featuredQuest(listOf(quest("m"), quest("e", difficulty = "easy", xp = 400.0)))?.id)
        assertNull(HomeHighlights.featuredQuest(listOf(quest("x", state = "locked"))))
    }

    @Test
    fun upNextCountsActiveQuestsAndFindsTheExploration() {
        val highlights = HomeHighlights.from(
            atlas = null,
            quests = listOf(quest("1"), quest("2", difficulty = "easy"), quest("3", state = "locked")),
            instances = listOf(QuestInstance("y", "Y", "", "completed"), QuestInstance("x", "X", "", "active")),
        )
        assertEquals("2", highlights.quest?.id)
        assertEquals(2, highlights.activeQuestCount)
        assertEquals("x", highlights.exploration?.id)
        assertFalse(highlights.showsSkills)
    }

    @Test
    fun readyNodesAreCheapestFirstAndCapped() {
        val nodes = listOf(
            skill("a", State.Unlockable, cost = 3), skill("b", State.Unlockable), skill("c"),
            skill("d", State.Unlockable, cost = 2), skill("e", State.Unlockable, cost = 3),
        )
        assertEquals(listOf("b", "d", "a"), HomeHighlights.readyNodes(nodes).map { it.id })
    }

    @Test
    fun almostNodesRankStartedLockedNodesByProgress() {
        val nodes = listOf(
            skill("half", requirements = listOf(5.0 to 10.0)),
            skill("untouched", requirements = listOf(0.0 to 10.0)),
            skill("blocked", prerequisitesMet = false, requirements = listOf(9.0 to 10.0)),
            skill("premium", State.PremiumLocked, requirements = listOf(9.0 to 10.0)),
            skill("needs-sp", cost = 3, requirements = listOf(12.0 to 10.0)),
            skill("mixed", requirements = listOf(30.0 to 10.0, 1.0 to 10.0)),
        )
        val almost = HomeHighlights.almostNodes(nodes)
        assertEquals(listOf("needs-sp", "mixed", "half"), almost.map { it.node.id })
        listOf(1.0, 0.55, 0.5).zip(almost.map { it.progress }).forEach { (expected, actual) -> assertEquals(expected, actual, 0.0001) }
        assertNull(almost[0].blockingRequirement)
        assertEquals(1.0, almost[1].blockingRequirement!!.current, 0.0)
        assertEquals(1.0, HomeHighlights.requirementProgress(skill("free")), 0.0)
    }
}
