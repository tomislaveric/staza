package world.staza.app

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import world.staza.app.core.auth.EncryptedCredentialStore
import world.staza.app.core.auth.SessionManager
import world.staza.app.core.network.ApiClient
import world.staza.app.core.network.ApiEnvironment
import world.staza.app.core.network.StazaRetrofit

/** Manual dependency container; created once per process. */
class AppContainer(application: Application) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val service = StazaRetrofit.create(ApiEnvironment.baseUrl)

    val sessionManager = SessionManager(
        store = EncryptedCredentialStore(application),
        refreshClient = ApiClient(service),
    )
    val apiClient = ApiClient(service, sessionManager)

    init {
        scope.launch { sessionManager.bootstrap(apiClient) }
    }
}

class StazaApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
