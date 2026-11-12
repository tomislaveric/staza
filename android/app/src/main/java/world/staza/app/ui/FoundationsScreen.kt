package world.staza.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import java.time.Instant
import world.staza.app.R
import world.staza.app.core.auth.AuthState
import world.staza.app.core.format.StazaFormat
import world.staza.app.designsystem.StazaTheme

/** Sample screen demonstrating the theme, font scaling, localization and session state. */
@Composable
fun FoundationsScreen(authState: AuthState, modifier: Modifier = Modifier) {
    val spacing = StazaTheme.spacing
    val locale = LocalConfiguration.current.locales[0]

    Column(
        modifier = modifier.verticalScroll(rememberScrollState()).padding(spacing.md),
        verticalArrangement = Arrangement.spacedBy(spacing.md),
    ) {
        Text(stringResource(R.string.foundations_title), style = MaterialTheme.typography.headlineMedium)

        SectionCard(stringResource(R.string.foundations_theme_heading)) {
            Text(stringResource(R.string.foundations_theme_body), style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(spacing.sm)) {
                val scheme = MaterialTheme.colorScheme
                listOf(scheme.primary, scheme.secondary, scheme.tertiary, scheme.primaryContainer, scheme.error)
                    .forEach { Swatch(it) }
            }
        }

        SectionCard(stringResource(R.string.foundations_localization_heading)) {
            LabeledValue(stringResource(R.string.foundations_number_label), StazaFormat.number(1234567.891, locale, 1))
            LabeledValue(stringResource(R.string.foundations_date_label), StazaFormat.date(Instant.parse("2026-03-14T12:00:00Z"), locale))
            LabeledValue(stringResource(R.string.foundations_distance_label), StazaFormat.distance(42195.0, locale))
        }

        SectionCard(stringResource(R.string.foundations_session_heading)) {
            val text = when (authState.status) {
                AuthState.Status.Unknown -> stringResource(R.string.session_unknown)
                AuthState.Status.SignedOut -> stringResource(R.string.session_signed_out)
                AuthState.Status.SignedIn -> authState.user?.email
                    ?.let { stringResource(R.string.session_signed_in_as, it) }
                    ?: stringResource(R.string.session_signed_in)
            }
            Text(text, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(StazaTheme.spacing.md),
            verticalArrangement = Arrangement.spacedBy(StazaTheme.spacing.sm),
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            content()
        }
    }
}

@Composable
private fun LabeledValue(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun Swatch(color: Color) {
    Box(Modifier.size(StazaTheme.spacing.xl).background(color, CircleShape))
}
