package world.staza.app.core.auth

import android.content.Context
import android.util.Base64
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.google.crypto.tink.Aead
import com.google.crypto.tink.KeyTemplates
import com.google.crypto.tink.RegistryConfiguration
import com.google.crypto.tink.aead.AeadConfig
import com.google.crypto.tink.integration.android.AndroidKeysetManager
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.Json

private val Context.credentialDataStore: DataStore<Preferences> by preferencesDataStore(name = "staza_credentials")

/**
 * Stores credentials in DataStore as AES-256-GCM ciphertext. The Tink keyset is
 * wrapped by a master key held in the Android Keystore, so the key material never
 * leaves hardware-backed storage in plaintext.
 */
class EncryptedCredentialStore(context: Context) : CredentialStore {
    private val dataStore = context.applicationContext.credentialDataStore
    private val aead: Aead = createAead(context.applicationContext)
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun load(): NativeCredentials? {
        val encoded = dataStore.data.first()[KEY] ?: return null
        return try {
            val plain = aead.decrypt(Base64.decode(encoded, Base64.NO_WRAP), ASSOCIATED_DATA)
            json.decodeFromString(NativeCredentials.serializer(), plain.decodeToString())
        } catch (e: Exception) {
            // Unreadable (e.g. keystore reset): treat as signed out.
            clear()
            null
        }
    }

    override suspend fun save(credentials: NativeCredentials) {
        val plain = json.encodeToString(NativeCredentials.serializer(), credentials).encodeToByteArray()
        val encoded = Base64.encodeToString(aead.encrypt(plain, ASSOCIATED_DATA), Base64.NO_WRAP)
        dataStore.edit { it[KEY] = encoded }
    }

    override suspend fun clear() {
        dataStore.edit { it.remove(KEY) }
    }

    private companion object {
        val KEY = stringPreferencesKey("credentials")
        val ASSOCIATED_DATA = "world.staza.app.credentials".encodeToByteArray()

        fun createAead(context: Context): Aead {
            AeadConfig.register()
            val handle = AndroidKeysetManager.Builder()
                .withSharedPref(context, "staza_keyset", "staza_keyset_prefs")
                .withKeyTemplate(KeyTemplates.get("AES256_GCM"))
                .withMasterKeyUri("android-keystore://staza_master_key")
                .build()
                .keysetHandle
            return handle.getPrimitive(RegistryConfiguration.get(), Aead::class.java)
        }
    }
}
