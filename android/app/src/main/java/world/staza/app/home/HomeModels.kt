package world.staza.app.home

import kotlinx.serialization.Serializable
import world.staza.app.atlas.SkillAtlas
import world.staza.app.atlas.SkillNode

/** Subset of `GET /api/player/progress-dashboard` shown on Home. */
@Serializable
data class ProgressDashboard(val progress: PlayerProgress)

@Serializable
data class PlayerProgress(
    val totalXp: Double,
    val level: Int,
    val remainingXp: Double,
    val progressPercent: Double,
)

/** `GET /api/authored-quests` entry. */
@Serializable
data class AuthoredQuest(
    val id: String,
    val chainTitle: String,
    val step: Int,
    val totalSteps: Int,
    val title: String,
    val description: String,
    val difficulty: String,
    val xp: Double,
    val state: String,
)

@Serializable
data class AuthoredQuestsResponse(val quests: List<AuthoredQuest>)

/** `GET /api/quest-instances` entry (generated explorations). */
@Serializable
data class QuestInstance(val id: String, val title: String, val description: String, val status: String)

@Serializable
data class QuestInstancesResponse(val instances: List<QuestInstance>)

data class HomeContent(val progress: PlayerProgress, val highlights: HomeHighlights)

/**
 * What Home suggests next, mirroring web `homeHighlights` and iOS `HomeHighlights`: the easiest
 * active quest (or an exploration), Skill Atlas nodes that can be unlocked now and nodes that are close.
 */
data class HomeHighlights(
    val quest: AuthoredQuest?,
    val activeQuestCount: Int,
    val exploration: QuestInstance?,
    val skillPoints: Int,
    val ready: List<SkillNode>,
    val almost: List<AlmostNode>,
) {
    data class AlmostNode(val node: SkillNode, val progress: Double) {
        /** The unmet requirement with the least progress; null when only Skill Points are missing. */
        val blockingRequirement: SkillNode.Requirement?
            get() = node.requirements.filter { !it.met }.minByOrNull { it.current / it.target }
    }

    val showsSkills: Boolean get() = ready.isNotEmpty() || almost.isNotEmpty() || skillPoints > 0

    companion object {
        const val LIMIT = 3
        private val difficultyRank = mapOf("easy" to 0, "medium" to 1, "hard" to 2, "prestige" to 3)

        fun from(atlas: SkillAtlas?, quests: List<AuthoredQuest>, instances: List<QuestInstance>): HomeHighlights {
            val nodes = atlas?.nodes.orEmpty()
            return HomeHighlights(
                quest = featuredQuest(quests),
                activeQuestCount = quests.count { it.state == "active" },
                exploration = instances.firstOrNull { it.status == "active" },
                skillPoints = atlas?.balance ?: 0,
                ready = readyNodes(nodes),
                almost = almostNodes(nodes),
            )
        }

        /** Lowest difficulty, then lowest XP, then catalog order. */
        fun featuredQuest(quests: List<AuthoredQuest>): AuthoredQuest? =
            quests.filter { it.state == "active" }
                .minWithOrNull(compareBy({ difficultyRank[it.difficulty] ?: difficultyRank.size }, { it.xp }))

        /** Unlockable nodes, cheapest first. */
        fun readyNodes(nodes: List<SkillNode>): List<SkillNode> =
            nodes.filter { it.state == SkillNode.State.Unlockable }.sortedBy { it.cost }.take(LIMIT)

        /** Started, locked nodes whose prerequisites are met, closest to unlockable first. */
        fun almostNodes(nodes: List<SkillNode>): List<AlmostNode> =
            nodes.filter { it.state == SkillNode.State.Locked && it.prerequisitesMet }
                .map { AlmostNode(it, requirementProgress(it)) }
                .filter { it.progress > 0 }
                .sortedWith(compareByDescending<AlmostNode> { it.progress }.thenBy { it.node.cost })
                .take(LIMIT)

        /** Average requirement completion, each requirement capped at 100%; 1 when there are none. */
        fun requirementProgress(node: SkillNode): Double {
            if (node.requirements.isEmpty()) return 1.0
            return node.requirements.sumOf {
                if (it.met || it.target <= 0) 1.0 else (it.current / it.target).coerceIn(0.0, 1.0)
            } / node.requirements.size
        }
    }
}
