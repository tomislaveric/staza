package world.staza.app.core.network

import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.QueryMap
import retrofit2.http.Tag
import retrofit2.http.Url

/** Per-request bearer token, attached as a request tag and read by [BearerInterceptor]. */
class BearerToken(val value: String?)

/** Raw Retrofit transport; [ApiClient] adds JSON decoding and refresh policy on top. */
interface StazaService {
    @GET
    suspend fun get(
        @Url path: String,
        @QueryMap query: Map<String, String>,
        @Tag token: BearerToken,
    ): Response<ResponseBody>

    @POST
    suspend fun post(
        @Url path: String,
        @Body body: RequestBody,
        @Tag token: BearerToken,
    ): Response<ResponseBody>
}

/** Adds the native-client header and the bearer credential for the request. */
class BearerInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
        val original = chain.request()
        val builder = original.newBuilder()
            .header("Accept", "application/json")
            .header("X-Staza-Client", "native")
        original.tag(BearerToken::class.java)?.value?.let {
            builder.header("Authorization", "Bearer $it")
        }
        return chain.proceed(builder.build())
    }
}

object StazaRetrofit {
    fun create(baseUrl: String, okHttpClient: OkHttpClient = defaultOkHttp()): StazaService {
        val normalized = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"
        return Retrofit.Builder()
            .baseUrl(normalized)
            .client(okHttpClient)
            .build()
            .create(StazaService::class.java)
    }

    fun defaultOkHttp(): OkHttpClient =
        OkHttpClient.Builder().addInterceptor(BearerInterceptor()).build()
}
