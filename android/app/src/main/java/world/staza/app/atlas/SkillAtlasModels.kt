package world.staza.app.atlas

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

/** `GET /api/skill-tree` payload; mirrors the iOS `SkillAtlasView_`. */
@Serializable
data class SkillAtlas(
    val isPremium: Boolean,
    val earnedPoints: Int,
    val spentPoints: Int,
    val balance: Int,
    val nextSkillPoint: NextSkillPoint,
    val nodes: List<SkillNode>,
) {
    @Serializable
    data class NextSkillPoint(val level: Int, val xpRemaining: Double, val progress: Double)
}

@Serializable
data class SkillNode(
    val id: String,
    val name: String,
    val description: String,
    val sport: String,
    val branch: String,
    /** A tier number (1–3) or the string `"prestige"`. */
    val tier: JsonPrimitive? = null,
    val cost: Int,
    val premium: Boolean,
    val grant: Grant,
    val prerequisites: List<String> = emptyList(),
    val state: State,
    val requirements: List<Requirement> = emptyList(),
    val prerequisitesMet: Boolean = false,
) {
    @Serializable
    enum class State {
        @kotlinx.serialization.SerialName("locked") Locked,
        @kotlinx.serialization.SerialName("unlockable") Unlockable,
        @kotlinx.serialization.SerialName("unlocked") Unlocked,
        @kotlinx.serialization.SerialName("premium_locked") PremiumLocked,
    }

    @Serializable
    data class Grant(val type: String? = null, val label: String)

    @Serializable
    data class Requirement(val label: String, val target: Double, val current: Double, val met: Boolean)

    val tierGlyph: String?
        get() = when (val level = tier?.intOrNull) {
            null -> if (tier != null) "★" else null
            1 -> "I"
            2 -> "II"
            3 -> "III"
            else -> level.toString()
        }
}

@Serializable
data class SkillUnlockRequest(val nodeId: String)
