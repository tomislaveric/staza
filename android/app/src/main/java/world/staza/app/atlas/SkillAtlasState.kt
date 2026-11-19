package world.staza.app.atlas

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import world.staza.app.core.network.ApiClient
import world.staza.app.core.network.ApiError

/** Screen state for the Skill Atlas; mirrors the iOS `SkillAtlasModel`. */
class SkillAtlasState(private val api: ApiClient) {
    var atlas by mutableStateOf<SkillAtlas?>(null)
        private set
    var isLoading by mutableStateOf(false)
        private set
    var unlockingNodeId by mutableStateOf<String?>(null)
        private set
    var unlockError by mutableStateOf<String?>(null)
        private set
    var selectedSport by mutableStateOf<String?>(null)
    var selectedNodeId by mutableStateOf<String?>(null)
        private set

    val sports: List<String> get() = atlas?.nodes.orEmpty().map { it.sport }.distinct()

    val activeSport: String? get() = selectedSport?.takeIf { it in sports } ?: sports.firstOrNull()

    val laneLayout: SkillAtlasLaneLayout?
        get() {
            val nodes = atlas?.nodes ?: return null
            val sport = activeSport ?: return null
            return SkillAtlasLaneLayout(nodes, sport)
        }

    /** Unlockable nodes across all sports, cheapest first, then in sport order. */
    val nextUpNodes: List<SkillNode>
        get() {
            val order = sports
            return atlas?.nodes.orEmpty().filter { it.state == SkillNode.State.Unlockable }
                .sortedWith(compareBy({ it.cost }, { order.indexOf(it.sport) }))
        }

    val selectedNode: SkillNode? get() = selectedNodeId?.let(::node)

    fun node(id: String): SkillNode? = atlas?.nodes?.firstOrNull { it.id == id }

    /** Opens a node's details and switches to its sport so the tree shows it. */
    fun select(id: String) {
        val node = node(id) ?: return
        selectedSport = node.sport
        selectedNodeId = id
    }

    fun clearSelection() { selectedNodeId = null }

    suspend fun load() {
        isLoading = true
        try {
            atlas = api.get<SkillAtlas>("/api/skill-tree")
        } catch (e: CancellationException) {
            throw e
        } catch (_: ApiError) {
            // Keeps the last atlas; the screen shows an error only when there is none.
        } finally {
            isLoading = false
        }
    }

    /** Returns whether the node was unlocked. */
    suspend fun unlock(node: SkillNode): Boolean {
        if (unlockingNodeId != null) return false
        unlockingNodeId = node.id
        unlockError = null
        try {
            atlas = api.post<SkillUnlockRequest, SkillAtlas>("/api/skill-tree/unlock", SkillUnlockRequest(node.id))
            return true
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiError.Server) {
            unlockError = e.message
            load()
        } catch (e: ApiError) {
            unlockError = e.message
        } finally {
            unlockingNodeId = null
        }
        return false
    }
}
