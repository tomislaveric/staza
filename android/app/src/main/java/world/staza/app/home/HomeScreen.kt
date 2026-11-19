package world.staza.app.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import world.staza.app.R
import world.staza.app.StazaApplication
import world.staza.app.atlas.AtlasColors
import world.staza.app.atlas.SkillNode
import world.staza.app.atlas.sportIcon
import world.staza.app.core.format.StazaFormat
import java.util.Locale

private val CardShape = RoundedCornerShape(16.dp)

@Composable
fun HomeRoute(onOpenAtlas: () -> Unit, onOpenWorld: () -> Unit) {
    val context = LocalContext.current
    val api = remember { (context.applicationContext as StazaApplication).container.apiClient }
    val state = remember { HomeState(api) }
    LaunchedEffect(Unit) { state.load() }
    HomeScreen(state, onOpenAtlas, onOpenWorld)
}

@Composable
fun HomeScreen(state: HomeState, onOpenAtlas: () -> Unit, onOpenWorld: () -> Unit) {
    val scope = rememberCoroutineScope()
    val content = state.content
    Box(Modifier.fillMaxSize().background(AtlasColors.canvas)) {
        when {
            content != null -> Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                LevelHero(content.progress)
                UpNext(content.highlights, onOpenWorld)
                if (content.highlights.showsSkills) SkillHighlights(content.highlights, onOpenAtlas)
            }
            state.failed -> Column(
                Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(stringResource(R.string.home_error), color = AtlasColors.danger)
                TextButton(onClick = { scope.launch { state.load() } }) {
                    Text(stringResource(R.string.atlas_retry), color = AtlasColors.accent)
                }
            }
            else -> Column(
                Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                CircularProgressIndicator(color = AtlasColors.accent)
                Text(stringResource(R.string.home_loading), color = AtlasColors.textMuted, modifier = Modifier.padding(top = 12.dp))
            }
        }
    }
}

@Composable
private fun locale(): Locale = LocalConfiguration.current.locales[0]

@Composable
private fun LevelHero(progress: PlayerProgress) {
    val locale = locale()
    Column(
        Modifier.fillMaxWidth().card().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                stringResource(R.string.home_level, progress.level),
                color = AtlasColors.textPrimary,
                fontSize = 32.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            Text(
                stringResource(R.string.home_total_xp, StazaFormat.number(progress.totalXp, locale)),
                color = AtlasColors.accent,
                fontWeight = FontWeight.SemiBold,
            )
        }
        LinearProgressIndicator(
            progress = { (progress.progressPercent / 100).coerceIn(0.0, 1.0).toFloat() },
            color = AtlasColors.accent,
            trackColor = AtlasColors.track,
            modifier = Modifier.fillMaxWidth().height(8.dp),
        )
        Text(
            stringResource(R.string.home_remaining, StazaFormat.number(progress.remainingXp, locale), progress.level + 1),
            color = AtlasColors.textMuted,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun SectionHeader(title: String, trailing: (@Composable () -> Unit)? = null) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            title.uppercase(),
            color = AtlasColors.textMuted,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        trailing?.invoke()
    }
}

@Composable
private fun UpNext(highlights: HomeHighlights, onOpenWorld: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionHeader(stringResource(R.string.home_up_next))
        val quest = highlights.quest
        val exploration = highlights.exploration
        when {
            quest != null -> {
                // Android has no quest screen yet, so the quest card is informational.
                QuestCard(quest)
                if (highlights.activeQuestCount > 1) {
                    val more = highlights.activeQuestCount - 1
                    Text(pluralStringResource(R.plurals.home_more_quests, more, more), color = AtlasColors.textMuted, style = MaterialTheme.typography.bodyMedium)
                }
                if (exploration != null) {
                    CompactRow(Icons.Filled.Explore, stringResource(R.string.home_exploration), exploration.title, onOpenWorld)
                }
            }
            exploration != null -> HeroCard(
                overline = stringResource(R.string.home_exploration),
                title = exploration.title,
                body = exploration.description,
                icon = Icons.Filled.Explore,
                onClick = onOpenWorld,
            )
            else -> HeroCard(
                overline = stringResource(R.string.home_plan_overline),
                title = stringResource(R.string.home_plan_title),
                body = stringResource(R.string.home_plan_goal),
                icon = Icons.Filled.Map,
                onClick = onOpenWorld,
            )
        }
    }
}

@Composable
private fun QuestCard(quest: AuthoredQuest) {
    val locale = locale()
    StripeCard(onClick = null) {
        Text(
            "${quest.chainTitle} · ${stringResource(R.string.home_quest_step, quest.step, quest.totalSteps)}".uppercase(),
            color = AtlasColors.accent,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Text(quest.title, color = AtlasColors.textPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Text(quest.description, color = AtlasColors.textMuted, maxLines = 3, overflow = TextOverflow.Ellipsis)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Pill(difficultyLabel(quest.difficulty), AtlasColors.textPrimary)
            Pill(stringResource(R.string.home_quest_xp, StazaFormat.number(quest.xp, locale)), AtlasColors.accent)
        }
    }
}

@Composable
private fun HeroCard(overline: String, title: String, body: String, icon: ImageVector, onClick: () -> Unit) {
    StripeCard(onClick) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(icon, contentDescription = null, tint = AtlasColors.accent, modifier = Modifier.size(16.dp))
            Text(overline.uppercase(), color = AtlasColors.accent, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold)
        }
        Text(title, color = AtlasColors.textPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Text(body, color = AtlasColors.textMuted, maxLines = 3, overflow = TextOverflow.Ellipsis)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = AtlasColors.accent)
        }
    }
}

@Composable
private fun StripeCard(onClick: (() -> Unit)?, content: @Composable () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .card(raised = true)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier),
    ) {
        Box(Modifier.width(4.dp).fillMaxHeight().background(AtlasColors.accent))
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
    }
}

@Composable
private fun CompactRow(icon: ImageVector, overline: String, title: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().card().clickable(role = Role.Button, onClick = onClick).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = AtlasColors.link)
        Column(Modifier.weight(1f)) {
            Text(overline.uppercase(), color = AtlasColors.textSubtle, style = MaterialTheme.typography.labelSmall)
            Text(title, color = AtlasColors.textPrimary, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = AtlasColors.textMuted, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun LinkRow(label: String, onClick: () -> Unit) {
    Row(
        Modifier.clickable(role = Role.Button, onClick = onClick).padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(label, color = AtlasColors.accent, fontWeight = FontWeight.Medium, style = MaterialTheme.typography.bodyMedium)
        Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = AtlasColors.accent, modifier = Modifier.size(16.dp))
    }
}

@Composable
private fun SkillHighlights(highlights: HomeHighlights, onOpenAtlas: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionHeader(stringResource(R.string.home_skills_header)) {
            if (highlights.skillPoints > 0) Pill(stringResource(R.string.atlas_sp, highlights.skillPoints), AtlasColors.accent)
        }
        if (highlights.ready.isNotEmpty()) {
            SubHeader(Icons.Filled.LockOpen, stringResource(R.string.home_skills_ready), AtlasColors.accent)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(end = 16.dp)) {
                items(highlights.ready, key = { it.id }) { node ->
                    SkillCard(node, onOpenAtlas, AtlasColors.accent) {
                        Text(
                            stringResource(R.string.home_skills_unlock, node.cost),
                            color = AtlasColors.accent,
                            fontWeight = FontWeight.SemiBold,
                            style = MaterialTheme.typography.labelLarge,
                        )
                    }
                }
            }
        } else if (highlights.skillPoints > 0) {
            LinkRow(pluralStringResource(R.plurals.home_skills_spend, highlights.skillPoints, highlights.skillPoints), onOpenAtlas)
        }
        if (highlights.almost.isNotEmpty()) {
            SubHeader(Icons.AutoMirrored.Filled.TrendingUp, stringResource(R.string.home_skills_almost), AtlasColors.link)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(end = 16.dp)) {
                items(highlights.almost, key = { it.node.id }) { almost ->
                    SkillCard(almost.node, onOpenAtlas, AtlasColors.border) {
                        LinearProgressIndicator(
                            progress = { almost.progress.toFloat() },
                            color = AtlasColors.link,
                            trackColor = AtlasColors.track,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Text(
                            almostHint(almost, highlights.skillPoints),
                            color = AtlasColors.textMuted,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun almostHint(almost: HomeHighlights.AlmostNode, balance: Int): String {
    val locale = locale()
    val blocking = almost.blockingRequirement
    return if (blocking != null) {
        stringResource(
            R.string.home_skills_requirement,
            blocking.label,
            StazaFormat.number(blocking.current, locale),
            StazaFormat.number(blocking.target, locale),
        )
    } else {
        stringResource(R.string.home_skills_needs_points, maxOf(almost.node.cost - balance, 1))
    }
}

@Composable
private fun SubHeader(icon: ImageVector, label: String, tint: Color) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(16.dp))
        Text(label, color = AtlasColors.textPrimary, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun SkillCard(node: SkillNode, onClick: () -> Unit, borderColor: Color, footer: @Composable () -> Unit) {
    Column(
        Modifier
            .width(220.dp)
            .clip(CardShape)
            .background(AtlasColors.surfaceRaised)
            .border(1.dp, borderColor.copy(alpha = 0.5f), CardShape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(
                Modifier.size(32.dp).background(AtlasColors.track, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(sportIcon(node.sport), contentDescription = null, tint = AtlasColors.accent, modifier = Modifier.size(18.dp))
            }
            Text(
                node.name,
                color = AtlasColors.textPrimary,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(node.grant.label, color = AtlasColors.textMuted, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
        footer()
    }
}

@Composable
private fun Pill(label: String, color: Color) {
    Text(
        label,
        color = color,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
            .background(color.copy(alpha = 0.12f), CircleShape)
            .padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

@Composable
private fun difficultyLabel(difficulty: String): String = when (difficulty) {
    "easy" -> stringResource(R.string.home_difficulty_easy)
    "medium" -> stringResource(R.string.home_difficulty_medium)
    "hard" -> stringResource(R.string.home_difficulty_hard)
    "prestige" -> stringResource(R.string.home_difficulty_prestige)
    else -> difficulty.replaceFirstChar { it.titlecase() }
}

private fun Modifier.card(raised: Boolean = false): Modifier =
    clip(CardShape)
        .background(if (raised) AtlasColors.surfaceRaised else AtlasColors.surface)
        .border(1.dp, AtlasColors.border, CardShape)
