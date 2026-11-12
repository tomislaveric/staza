package world.staza.app.core.auth

/** Persists native credentials. Implementations must keep them encrypted at rest. */
interface CredentialStore {
    suspend fun load(): NativeCredentials?
    suspend fun save(credentials: NativeCredentials)
    suspend fun clear()
}
