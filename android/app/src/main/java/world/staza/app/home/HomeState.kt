package world.staza.app.home

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import world.staza.app.atlas.SkillAtlas
import world.staza.app.core.network.ApiClient
import world.staza.app.core.network.ApiError

/** Loads Home. Only the progress dashboard is required; atlas and quest failures hide their sections. */
class HomeState(private val api: ApiClient) {
    var content by mutableStateOf<HomeContent?>(null)
        private set
    var isLoading by mutableStateOf(false)
        private set
    var failed by mutableStateOf(false)
        private set

    suspend fun load() {
        isLoading = true
        try {
            content = coroutineScope {
                val dashboard = async { api.get<ProgressDashboard>("/api/player/progress-dashboard") }
                val atlas = async { optional { api.get<SkillAtlas>("/api/skill-tree") } }
                val quests = async { optional { api.get<AuthoredQuestsResponse>("/api/authored-quests").quests } }
                val instances = async { optional { api.get<QuestInstancesResponse>("/api/quest-instances").instances } }
                HomeContent(
                    progress = dashboard.await().progress,
                    highlights = HomeHighlights.from(atlas.await(), quests.await().orEmpty(), instances.await().orEmpty()),
                )
            }
            failed = false
        } catch (e: CancellationException) {
            throw e
        } catch (_: ApiError) {
            failed = content == null
        } finally {
            isLoading = false
        }
    }

    private suspend fun <T> optional(block: suspend () -> T): T? = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (_: ApiError) {
        null
    }
}
