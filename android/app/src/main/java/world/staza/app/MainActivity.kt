package world.staza.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import world.staza.app.designsystem.StazaTheme
import world.staza.app.shell.StazaApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val sessionManager = (application as StazaApplication).container.sessionManager
        setContent {
            val authState by sessionManager.state.collectAsState()
            StazaTheme {
                StazaApp(authState)
            }
        }
    }
}
