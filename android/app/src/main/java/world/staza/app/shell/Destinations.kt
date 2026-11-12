package world.staza.app.shell

import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.ui.graphics.vector.ImageVector
import world.staza.app.R

enum class TopLevelDestination(
    val route: String,
    @param:StringRes val label: Int,
    val icon: ImageVector,
) {
    Home("home", R.string.nav_home, Icons.Filled.Home),
    World("world", R.string.nav_world, Icons.Filled.Public),
    SkillAtlas("atlas", R.string.nav_atlas, Icons.Filled.AccountTree),
    Progress("progress", R.string.nav_progress, Icons.Filled.Timeline),
    More("more", R.string.nav_more, Icons.Filled.MoreHoriz),
}

const val ADD_ACTIVITY_ROUTE = "add_activity"
