package world.staza.app.core.network

import world.staza.app.BuildConfig

/** Resolves the deployment origin: debug builds use the dev server, release builds production. */
object ApiEnvironment {
    const val PRODUCTION_BASE_URL = "https://play.staza.world"

    /** Set at build time: `-PstazaApiBaseUrl=...` overrides the debug URL. */
    val baseUrl: String get() = BuildConfig.API_BASE_URL
}
