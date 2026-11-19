package world.staza.app.atlas

/**
 * Portrait lane layout for one sport of the Skill Atlas; a port of the iOS
 * `SkillAtlasLaneLayout`. The grid has five columns: three branch lanes (0, 2, 4)
 * with gutters (1, 3) for cross-branch and cross-sport nodes. A node's row is its
 * in-sport prerequisite depth, pushed down only when its cell is already taken.
 */
class SkillAtlasLaneLayout(allNodes: List<SkillNode>, sport: String) {
    data class Placed(val node: SkillNode, val row: Int, val col: Int, val externalPrerequisites: List<String>) {
        val id: String get() = node.id
    }

    enum class EdgeStyle { Active, Reachable, Locked }

    data class Edge(val fromId: String, val toId: String, val style: EdgeStyle, val distant: Boolean)

    data class Lane(val branch: String, val col: Int)

    val nodes: List<Placed>
    val edges: List<Edge>
    val lanes: List<Lane>
    val rowCount: Int

    init {
        val sportNodes = allNodes.filter { it.sport == sport }
        val byId = allNodes.associateBy { it.id }
        val inSport = sportNodes.map { it.id }.toSet()
        val branches = laneBranches(sport)
        val laneCol = branches.zip(LANE_COLUMNS).toMap()
        lanes = branches.zip(LANE_COLUMNS).map { (branch, col) -> Lane(branch, col) }

        val depth = mutableMapOf<String, Int>()
        fun depthOf(id: String, visiting: Set<String> = emptySet()): Int {
            depth[id]?.let { return it }
            val node = byId[id] ?: return 0
            if (id in visiting) return 0
            val parents = node.prerequisites.filter { it in inSport }
            val value = if (parents.isEmpty()) 0 else 1 + parents.maxOf { depthOf(it, visiting + id) }
            depth[id] = value
            return value
        }
        sportNodes.forEach { depthOf(it.id) }

        // Shallow nodes first so parents are placed before children; lane nodes win
        // over cross nodes at equal depth. Nodes reachable only from other sports go last.
        fun isLaneNode(node: SkillNode) = node.branch == "root" || node.branch in laneCol
        fun isDetached(node: SkillNode) = node.branch != "root" && node.prerequisites.none { it in inSport }
        val order = sportNodes.withIndex().sortedWith(
            compareBy<IndexedValue<SkillNode>>(
                { if (isDetached(it.value)) 1 else 0 },
                { depth[it.value.id] ?: 0 },
                { if (isLaneNode(it.value)) 0 else 1 },
                { it.index },
            ),
        ).map { it.value }

        val occupied = mutableSetOf<Pair<Int, Int>>()
        val placed = mutableMapOf<String, Pair<Int, Int>>()
        val result = mutableListOf<Placed>()
        var detachedRow: Int? = null
        for (node in order) {
            val parents = node.prerequisites.filter { it in placed }
            if (isDetached(node) && detachedRow == null) {
                detachedRow = (placed.values.maxOfOrNull { it.first } ?: -1) + 1
            }
            val minRow = if (isDetached(node)) detachedRow!! else parents.maxOfOrNull { placed.getValue(it).first + 1 } ?: 0
            val lane = laneCol[node.branch]
            val ideal = when {
                node.branch == "root" -> 2
                lane != null -> lane
                parents.isEmpty() -> 2
                else -> Math.round(parents.map { placed.getValue(it).second }.average()).toInt()
            }
            val candidates = (if (isLaneNode(node)) listOf(ideal) else listOf(ideal, ideal - 1, ideal + 1))
                .filter { it in 0 until COLUMN_COUNT }
            var row = maxOf(minRow, depth[node.id] ?: 0)
            var col: Int
            while (true) {
                val free = candidates.firstOrNull { (row to it) !in occupied }
                if (free != null) { col = free; break }
                row++
            }
            occupied += row to col
            placed[node.id] = row to col
            result += Placed(node, row, col, node.prerequisites.filter { it !in inSport })
        }
        nodes = result.sortedWith(compareBy({ it.row }, { it.col }))
        rowCount = (result.maxOfOrNull { it.row } ?: -1) + 1

        val distant = distantNodeIds(sportNodes, byId)
        edges = result.flatMap { child ->
            child.node.prerequisites.filter { it in inSport }.mapNotNull { parentId ->
                val parent = byId[parentId] ?: return@mapNotNull null
                val style = when {
                    parent.state == SkillNode.State.Unlocked && child.node.state == SkillNode.State.Unlocked -> EdgeStyle.Active
                    parent.state == SkillNode.State.Unlocked -> EdgeStyle.Reachable
                    else -> EdgeStyle.Locked
                }
                Edge(parentId, child.id, style, child.id in distant)
            }
        }
    }

    companion object {
        const val COLUMN_COUNT = 5
        val LANE_COLUMNS = listOf(0, 2, 4)

        /** Branch keys in lane order. EXPLORE (`adventure`) and ENDURANCE are shared across sports. */
        fun laneBranches(sport: String): List<String> = when (sport) {
            "running" -> listOf("speed", "adventure", "endurance")
            "hiking" -> listOf("summit", "adventure", "endurance")
            else -> listOf("rush", "adventure", "endurance")
        }

        /** Mirrors the web atlas: not usable and no usable prerequisite. */
        fun distantNodeIds(nodes: List<SkillNode>, byId: Map<String, SkillNode>): Set<String> {
            fun usable(state: SkillNode.State?) = state == SkillNode.State.Unlocked || state == SkillNode.State.Unlockable
            return nodes.filter { node ->
                node.branch != "root" && !usable(node.state) && node.prerequisites.none { usable(byId[it]?.state) }
            }.map { it.id }.toSet()
        }
    }
}
