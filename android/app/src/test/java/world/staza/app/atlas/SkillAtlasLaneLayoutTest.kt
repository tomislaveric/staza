package world.staza.app.atlas

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class SkillAtlasLaneLayoutTest {
    private fun node(
        id: String,
        sport: String = "cycling",
        branch: String,
        pre: List<String> = emptyList(),
        state: SkillNode.State = SkillNode.State.Locked,
    ) = SkillNode(
        id = id, name = id, description = "", sport = sport, branch = branch, cost = 1, premium = false,
        grant = SkillNode.Grant("quest_unlock", id), prerequisites = pre, state = state,
    )

    private fun SkillAtlasLaneLayout.position(id: String) = nodes.firstOrNull { it.id == id }?.let { listOf(it.row, it.col) }

    @Test
    fun hubAndLanesFollowPrerequisiteDepth() {
        val layout = SkillAtlasLaneLayout(
            listOf(
                node("hub", branch = "root"),
                node("flow1", branch = "rush", pre = listOf("hub")),
                node("flow2", branch = "rush", pre = listOf("flow1")),
                node("explore1", branch = "adventure", pre = listOf("hub")),
                node("endurance1", branch = "endurance", pre = listOf("hub")),
            ),
            "cycling",
        )
        assertEquals(listOf(0, 2), layout.position("hub"))
        assertEquals(listOf(1, 0), layout.position("flow1"))
        assertEquals(listOf(2, 0), layout.position("flow2"))
        assertEquals(listOf(1, 2), layout.position("explore1"))
        assertEquals(listOf(1, 4), layout.position("endurance1"))
        assertEquals(3, layout.rowCount)
        assertEquals(listOf("rush", "adventure", "endurance"), layout.lanes.map { it.branch })
    }

    @Test
    fun crossNodesSitInTheGutterBetweenTheirParents() {
        val layout = SkillAtlasLaneLayout(
            listOf(
                node("hub", branch = "root"),
                node("flow1", branch = "rush", pre = listOf("hub")),
                node("explore1", branch = "adventure", pre = listOf("hub")),
                node("explore2", branch = "adventure", pre = listOf("explore1")),
                node("endurance1", branch = "endurance", pre = listOf("hub")),
                node("fastExplorer", branch = "cross", pre = listOf("flow1", "explore1")),
                node("breakaway", branch = "cross", pre = listOf("flow1", "endurance1")),
            ),
            "cycling",
        )
        assertEquals(listOf(2, 1), layout.position("fastExplorer"))
        assertEquals(listOf(2, 3), layout.position("breakaway"))
    }

    @Test
    fun occupiedCellPushesNodeAndDescendantsDown() {
        val layout = SkillAtlasLaneLayout(
            listOf(
                node("hub", branch = "root"),
                node("a", branch = "cross", pre = listOf("hub")),
                node("b", branch = "cross", pre = listOf("hub")),
                node("c", branch = "cross", pre = listOf("hub")),
                node("d", branch = "cross", pre = listOf("hub")),
                node("child", branch = "cross", pre = listOf("d")),
            ),
            "cycling",
        )
        assertEquals(listOf(1, 2), layout.position("a"))
        assertEquals(listOf(1, 1), layout.position("b"))
        assertEquals(listOf(1, 3), layout.position("c"))
        assertEquals(listOf(2, 2), layout.position("d"))
        assertEquals(listOf(3, 2), layout.position("child"))
    }

    @Test
    fun otherSportPrerequisitesBecomeExternalReferencesAndEdgesCarryState() {
        val layout = SkillAtlasLaneLayout(
            listOf(
                node("cyclist", branch = "root", state = SkillNode.State.Unlocked),
                node("runner", sport = "running", branch = "root", state = SkillNode.State.Unlocked),
                node("flow1", branch = "rush", pre = listOf("cyclist"), state = SkillNode.State.Unlocked),
                node("flow2", branch = "rush", pre = listOf("flow1"), state = SkillNode.State.Unlockable),
                node("flow3", branch = "rush", pre = listOf("flow2")),
                node("flow4", branch = "rush", pre = listOf("flow3")),
                node("warrior", branch = "cross_sport", pre = listOf("cyclist", "runner")),
                node("mover", branch = "cross_sport", pre = listOf("runner")),
            ),
            "cycling",
        )
        assertEquals(listOf(5, 2), layout.position("mover"))
        assertFalse(layout.nodes.any { it.id == "runner" })
        assertEquals(listOf("runner"), layout.nodes.first { it.id == "warrior" }.externalPrerequisites)
        assertFalse(layout.edges.any { it.fromId == "runner" })
        fun edge(to: String) = layout.edges.first { it.toId == to }
        assertEquals(SkillAtlasLaneLayout.EdgeStyle.Active, edge("flow1").style)
        assertEquals(SkillAtlasLaneLayout.EdgeStyle.Reachable, edge("flow2").style)
        assertEquals(SkillAtlasLaneLayout.EdgeStyle.Locked, edge("flow3").style)
        assertFalse(edge("flow3").distant)
        assertEquals(true, edge("flow4").distant)
    }
}
