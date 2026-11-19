package world.staza.app.atlas

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DirectionsBike
import androidx.compose.material.icons.filled.DirectionsRun
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.Hiking
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.MilitaryTech
import androidx.compose.material.icons.filled.NorthEast
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Route
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.filled.WorkspacePremium
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SecondaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.coroutines.yield
import world.staza.app.R
import world.staza.app.StazaApplication
import world.staza.app.core.format.StazaFormat
import world.staza.app.designsystem.StazaTheme

/** Brand palette of the atlas, matching the iOS tokens and the web atlas. */
internal object AtlasColors {
    val canvas = Color(0xFF0D0E10)
    val surface = Color(0xFF111318)
    val surfaceRaised = Color(0xFF171A20)
    val track = Color(0xFF1F232B)
    val textPrimary = Color(0xFFEDE9E2)
    val textMuted = Color(0xFF9AA0AA)
    val textSubtle = Color(0xFF737880)
    val onAccent = Color(0xFF0D0E10)
    val accent = Color(0xFFF5C823)
    val success = Color(0xFF34C76F)
    val danger = Color(0xFFFF5C5C)
    val border = Color(0xFF2A2D34)
    val borderStrong = Color(0xFF3C3F48)
    val epic = Color(0xFF9B6BFF)
    val link = Color(0xFF7FBAD0)
}

private val RowHeight = 100.dp
private val LaneHeaderHeight = 28.dp
private val TopPadding = 8.dp
private val NodeTopInset = 4.dp

@Composable
fun SkillAtlasRoute() {
    val context = LocalContext.current
    val api = remember { (context.applicationContext as StazaApplication).container.apiClient }
    val state = remember { SkillAtlasState(api) }
    LaunchedEffect(Unit) { state.load() }
    SkillAtlasScreen(state)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SkillAtlasScreen(state: SkillAtlasState) {
    val scope = rememberCoroutineScope()
    val atlas = state.atlas
    Box(Modifier.fillMaxSize().background(AtlasColors.canvas)) {
        when {
            atlas != null -> AtlasContent(state, atlas)
            state.isLoading -> Column(
                Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                CircularProgressIndicator(color = AtlasColors.accent)
                Text(stringResource(R.string.atlas_loading), color = AtlasColors.textMuted, modifier = Modifier.padding(top = 12.dp))
            }
            else -> Column(
                Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(stringResource(R.string.atlas_error), color = AtlasColors.danger)
                TextButton(onClick = { scope.launch { state.load() } }) {
                    Text(stringResource(R.string.atlas_retry), color = AtlasColors.accent)
                }
            }
        }
    }

    val selected = state.selectedNode
    if (selected != null) {
        ModalBottomSheet(
            onDismissRequest = { state.clearSelection() },
            containerColor = AtlasColors.surface,
        ) {
            NodeDetail(selected, state)
        }
    }
}

@Composable
private fun AtlasContent(state: SkillAtlasState, atlas: SkillAtlas) {
    val scroll = rememberScrollState()
    val density = LocalDensity.current
    var treeTop by remember { mutableIntStateOf(0) }
    val layout = state.laneLayout
    val sport = state.activeSport

    LaunchedEffect(state.selectedNodeId) {
        val id = state.selectedNodeId ?: return@LaunchedEffect
        yield()
        val row = state.laneLayout?.nodes?.firstOrNull { it.id == id }?.row ?: return@LaunchedEffect
        val target = with(density) { treeTop + rowTop(row).roundToPx() - 96.dp.roundToPx() }
        scroll.animateScrollTo(target.coerceAtLeast(0))
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(scroll)
            .padding(horizontal = StazaTheme.spacing.md),
        verticalArrangement = Arrangement.spacedBy(StazaTheme.spacing.md),
    ) {
        Spacer(Modifier.height(StazaTheme.spacing.sm))
        Header(atlas)
        NextUp(state)
        if (state.sports.size > 1 && sport != null) {
            SecondaryTabRow(
                selectedTabIndex = state.sports.indexOf(sport).coerceAtLeast(0),
                containerColor = AtlasColors.surfaceRaised,
                contentColor = AtlasColors.textPrimary,
                indicator = {
                    TabRowDefaults.SecondaryIndicator(
                        Modifier.tabIndicatorOffset(state.sports.indexOf(sport).coerceAtLeast(0)),
                        color = AtlasColors.accent,
                    )
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                state.sports.forEach { item ->
                    Tab(
                        selected = item == sport,
                        onClick = { state.selectedSport = item },
                        text = { Text(item.replaceFirstChar { it.titlecase() }) },
                    )
                }
            }
        }
        if (layout != null && sport != null) {
            Box(Modifier.onPlaced { treeTop = it.positionInParent().y.toInt() }) {
                LaneTree(layout, state.selectedNodeId) { state.select(it) }
            }
        }
        Spacer(Modifier.height(StazaTheme.spacing.lg))
    }
}

private fun androidx.compose.ui.layout.LayoutCoordinates.positionInParent(): Offset =
    parentLayoutCoordinates?.localPositionOf(this, Offset.Zero) ?: Offset.Zero

@Composable
private fun Header(atlas: SkillAtlas) {
    val locale = LocalConfiguration.current.locales[0]
    Column(
        Modifier
            .fillMaxWidth()
            .background(AtlasColors.surfaceRaised, RoundedCornerShape(16.dp))
            .border(1.dp, AtlasColors.border, RoundedCornerShape(16.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(
                atlas.balance.toString(),
                fontSize = 56.sp,
                fontWeight = FontWeight.Bold,
                color = if (atlas.balance > 0) AtlasColors.accent else AtlasColors.textPrimary,
            )
            Text(stringResource(R.string.atlas_points, atlas.balance), color = AtlasColors.textPrimary, style = MaterialTheme.typography.titleMedium)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            StatTile(stringResource(R.string.atlas_earned), atlas.earnedPoints.toString(), Modifier.weight(1f))
            StatTile(stringResource(R.string.atlas_spent), atlas.spentPoints.toString(), Modifier.weight(1f))
        }
        LinearProgressIndicator(
            progress = { atlas.nextSkillPoint.progress.toFloat() },
            color = AtlasColors.accent,
            trackColor = AtlasColors.track,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            stringResource(R.string.atlas_next_point, atlas.nextSkillPoint.level, StazaFormat.number(atlas.nextSkillPoint.xpRemaining, locale)),
            color = AtlasColors.textMuted,
            style = MaterialTheme.typography.labelMedium,
        )
    }
}

@Composable
private fun StatTile(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier.background(AtlasColors.surface, RoundedCornerShape(12.dp)).padding(12.dp)) {
        Text(label.uppercase(), color = AtlasColors.textSubtle, style = MaterialTheme.typography.labelMedium)
        Text(value, color = AtlasColors.textPrimary, style = MaterialTheme.typography.titleLarge)
    }
}

@Composable
private fun NextUp(state: SkillAtlasState) {
    val nodes = state.nextUpNodes
    if (nodes.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            stringResource(R.string.atlas_next_up).uppercase(),
            color = AtlasColors.textMuted,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.semantics { heading() },
        )
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            nodes.forEach { node ->
                Row(
                    Modifier
                        .background(AtlasColors.surfaceRaised, CircleShape)
                        .border(1.dp, AtlasColors.accent.copy(alpha = 0.4f), CircleShape)
                        .clickable(role = Role.Button) { state.select(node.id) }
                        .padding(start = 8.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    NodeGlyph(node, compact = true)
                    Column {
                        Text(node.name, color = AtlasColors.textPrimary, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, maxLines = 1)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Icon(sportIcon(node.sport), contentDescription = null, tint = AtlasColors.accent, modifier = Modifier.size(12.dp))
                            Text(stringResource(R.string.atlas_sp, node.cost), color = AtlasColors.accent, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }
        }
    }
}

private fun rowTop(row: Int): Dp = TopPadding + RowHeight * row + if (row >= 1) LaneHeaderHeight else 0.dp

@Composable
private fun LaneTree(layout: SkillAtlasLaneLayout, selectedNodeId: String?, onSelect: (String) -> Unit) {
    val totalHeight = TopPadding + LaneHeaderHeight + RowHeight * layout.rowCount
    val distant = layout.edges.filter { it.distant }.map { it.toId }.toSet()
    BoxWithConstraints(Modifier.fillMaxWidth().height(totalHeight)) {
        val columnWidth = maxWidth / SkillAtlasLaneLayout.COLUMN_COUNT
        fun centerX(col: Int) = columnWidth * (col + 0.5f)
        fun centerY(placed: SkillAtlasLaneLayout.Placed) = rowTop(placed.row) + NodeTopInset + glyphFrame(placed.node) / 2
        val positions = layout.nodes.associate { it.id to (centerX(it.col) to centerY(it)) }

        Canvas(Modifier.fillMaxSize()) {
            layout.lanes.forEach { lane ->
                val x = centerX(lane.col).toPx()
                drawLine(
                    AtlasColors.border.copy(alpha = 0.35f),
                    Offset(x, rowTop(1).toPx()),
                    Offset(x, size.height),
                    strokeWidth = 1.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(1.dp.toPx(), 6.dp.toPx())),
                )
            }
            layout.edges.forEach { edge ->
                val (fx, fy) = positions[edge.fromId] ?: return@forEach
                val (tx, ty) = positions[edge.toId] ?: return@forEach
                val from = Offset(fx.toPx(), fy.toPx())
                val to = Offset(tx.toPx(), ty.toPx())
                val midY = (from.y + to.y) / 2
                val path = Path().apply {
                    moveTo(from.x, from.y)
                    cubicTo(from.x, midY, to.x, midY, to.x, to.y)
                }
                when (edge.style) {
                    SkillAtlasLaneLayout.EdgeStyle.Active -> drawPath(
                        path, AtlasColors.accent.copy(alpha = 0.85f),
                        style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round),
                    )
                    SkillAtlasLaneLayout.EdgeStyle.Reachable -> drawPath(
                        path, AtlasColors.accent.copy(alpha = 0.75f),
                        style = Stroke(
                            width = 2.dp.toPx(),
                            cap = StrokeCap.Round,
                            pathEffect = PathEffect.dashPathEffect(floatArrayOf(0.1f, 5.dp.toPx())),
                        ),
                    )
                    SkillAtlasLaneLayout.EdgeStyle.Locked -> drawPath(
                        path, AtlasColors.textSubtle.copy(alpha = if (edge.distant) 0.18f else 0.4f),
                        style = Stroke(width = 1.2.dp.toPx()),
                    )
                }
            }
        }

        layout.lanes.forEach { lane ->
            Box(
                Modifier
                    .width(columnWidth * 1.8f)
                    .offset(x = centerX(lane.col) - columnWidth * 0.9f, y = rowTop(1) - LaneHeaderHeight + 6.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    stringResource(laneTitle(lane.branch)),
                    color = AtlasColors.textMuted,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = 1.5.sp,
                    maxLines = 1,
                    modifier = Modifier
                        .background(AtlasColors.canvas, RoundedCornerShape(4.dp))
                        .padding(horizontal = 4.dp)
                        .semantics { heading() },
                )
            }
        }

        layout.nodes.forEach { placed ->
            val density = LocalDensity.current
            Box(
                Modifier
                    .width(columnWidth)
                    .height(RowHeight - NodeTopInset)
                    .offset {
                        with(density) {
                            IntOffset((columnWidth * placed.col).roundToPx(), (rowTop(placed.row) + NodeTopInset).roundToPx())
                        }
                    },
            ) {
                LaneNode(
                    placed = placed,
                    selected = placed.id == selectedNodeId,
                    distant = placed.id in distant,
                    onClick = { onSelect(placed.id) },
                )
            }
        }
    }
}

@Composable
private fun LaneNode(placed: SkillAtlasLaneLayout.Placed, selected: Boolean, distant: Boolean, onClick: () -> Unit) {
    val node = placed.node
    val stateText = stateLabel(node.state)
    val costText = if (node.state == SkillNode.State.Unlockable) stringResource(R.string.atlas_cost, node.cost) else ""
    Column(
        Modifier
            .fillMaxWidth()
            .alpha(if (distant) 0.55f else 1f)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics {
                contentDescription = listOf(node.name, costText).filter { it.isNotEmpty() }.joinToString(", ")
                stateDescription = stateText
            },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        NodeGlyph(node, selected = selected, linksOtherSport = placed.externalPrerequisites.isNotEmpty())
        Text(
            node.name,
            color = if (node.state == SkillNode.State.Unlocked || node.state == SkillNode.State.Unlockable) AtlasColors.textPrimary else AtlasColors.textMuted,
            fontSize = 11.sp,
            lineHeight = 13.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .background(AtlasColors.canvas.copy(alpha = 0.85f), RoundedCornerShape(4.dp))
                .padding(horizontal = 1.dp),
        )
    }
}

/** The glyph plus room for its corner badges. */
private fun glyphFrame(node: SkillNode): Dp = glyphDiameter(node) + 12.dp

private fun glyphDiameter(node: SkillNode, compact: Boolean = false): Dp = when {
    compact -> 28.dp
    node.branch == "root" -> 52.dp
    else -> 44.dp
}

@Composable
private fun NodeGlyph(node: SkillNode, selected: Boolean = false, linksOtherSport: Boolean = false, compact: Boolean = false) {
    val diameter = glyphDiameter(node, compact)
    val fill = when (node.state) {
        SkillNode.State.Unlocked -> AtlasColors.accent
        SkillNode.State.Unlockable -> AtlasColors.surfaceRaised
        else -> AtlasColors.surface
    }
    val ring = when (node.state) {
        SkillNode.State.Unlocked -> Color.Transparent
        SkillNode.State.Unlockable -> AtlasColors.accent
        SkillNode.State.Locked -> AtlasColors.borderStrong
        SkillNode.State.PremiumLocked -> AtlasColors.epic.copy(alpha = 0.7f)
    }
    val iconTint = when (node.state) {
        SkillNode.State.Unlocked -> AtlasColors.onAccent
        SkillNode.State.Unlockable -> AtlasColors.accent
        else -> AtlasColors.textSubtle
    }
    Box(Modifier.size(if (compact) diameter else glyphFrame(node)), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(diameter)
                .then(
                    if (node.state == SkillNode.State.Unlockable) {
                        Modifier.shadow(if (compact) 4.dp else 10.dp, CircleShape, ambientColor = AtlasColors.accent, spotColor = AtlasColors.accent)
                    } else {
                        Modifier
                    },
                )
                .background(fill, CircleShape)
                .border(BorderStroke(if (node.state == SkillNode.State.Unlocked) 0.dp else 2.dp, ring), CircleShape)
                .then(if (selected) Modifier.border(2.dp, AtlasColors.textPrimary, CircleShape) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            Icon(nodeIcon(node), contentDescription = null, tint = iconTint, modifier = Modifier.size(diameter * 0.45f))
        }
        if (!compact) {
            if (node.branch != "root") {
                node.tierGlyph?.let { glyph ->
                    Badge(Modifier.align(Alignment.TopStart), AtlasColors.textMuted) {
                        Text(glyph, color = AtlasColors.textMuted, fontSize = 7.sp, fontWeight = FontWeight.Black)
                    }
                }
            }
            if (node.premium && node.state != SkillNode.State.Unlocked) {
                Badge(Modifier.align(Alignment.TopEnd), AtlasColors.epic) {
                    Icon(Icons.Filled.WorkspacePremium, contentDescription = null, tint = AtlasColors.epic, modifier = Modifier.size(10.dp))
                }
            }
            if (linksOtherSport) {
                Badge(Modifier.align(Alignment.BottomEnd), AtlasColors.link) {
                    Icon(Icons.Filled.NorthEast, contentDescription = null, tint = AtlasColors.link, modifier = Modifier.size(10.dp))
                }
            }
            if (node.state == SkillNode.State.Unlockable) {
                Text(
                    stringResource(R.string.atlas_sp, node.cost),
                    color = AtlasColors.onAccent,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .offset(y = 4.dp)
                        .background(AtlasColors.accent, CircleShape)
                        .padding(horizontal = 6.dp, vertical = 1.dp),
                )
            }
        }
    }
}

@Composable
private fun Badge(modifier: Modifier, tint: Color, content: @Composable () -> Unit) {
    Box(
        modifier
            .size(18.dp)
            .background(AtlasColors.surfaceRaised, CircleShape)
            .border(1.dp, tint.copy(alpha = 0.6f), CircleShape),
        contentAlignment = Alignment.Center,
    ) { content() }
}

@Composable
private fun NodeDetail(node: SkillNode, state: SkillAtlasState) {
    val scope = rememberCoroutineScope()
    val locale = LocalConfiguration.current.locales[0]
    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp)
            .padding(bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Top) {
            NodeGlyph(node)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(node.name, color = AtlasColors.textPrimary, style = MaterialTheme.typography.titleLarge)
                Text(node.grant.label, color = AtlasColors.accent, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            }
            Chip(stateLabel(node.state), stateColor(node.state), null)
        }
        Text(node.description, color = AtlasColors.textMuted, style = MaterialTheme.typography.bodyMedium)
        state.unlockError?.let { Text(it, color = AtlasColors.danger, fontSize = 13.sp) }
        if (node.state != SkillNode.State.Unlocked) {
            Text(stringResource(R.string.atlas_cost, node.cost), color = AtlasColors.textMuted, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            node.requirements.forEach { requirement ->
                val progress = when {
                    requirement.met -> 1f
                    requirement.target > 0 -> (requirement.current / requirement.target).coerceIn(0.0, 1.0).toFloat()
                    else -> 0f
                }
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Icon(
                            if (requirement.met) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked,
                            contentDescription = null,
                            tint = if (requirement.met) AtlasColors.success else AtlasColors.textSubtle,
                            modifier = Modifier.size(16.dp),
                        )
                        Text(
                            requirement.label,
                            color = if (requirement.met) AtlasColors.textPrimary else AtlasColors.textMuted,
                            fontSize = 13.sp,
                            maxLines = 2,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            "${StazaFormat.number(minOf(requirement.current, requirement.target), locale)} / ${StazaFormat.number(requirement.target, locale)}",
                            color = AtlasColors.textMuted,
                            fontSize = 12.sp,
                        )
                    }
                    LinearProgressIndicator(
                        progress = { progress },
                        color = if (requirement.met) AtlasColors.success else AtlasColors.accent,
                        trackColor = AtlasColors.track,
                        modifier = Modifier.fillMaxWidth().height(4.dp),
                    )
                }
            }
            if (node.prerequisites.isNotEmpty()) {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    node.prerequisites.forEach { id ->
                        val prerequisite = state.node(id)
                        val met = prerequisite?.state == SkillNode.State.Unlocked
                        val label = if (prerequisite != null && prerequisite.sport != node.sport) {
                            stringResource(R.string.atlas_requires_in_sport, prerequisite.name, prerequisite.sport.replaceFirstChar { it.titlecase() })
                        } else {
                            stringResource(R.string.atlas_requires, prerequisite?.name ?: id)
                        }
                        Chip(label, if (met) AtlasColors.success else AtlasColors.textSubtle, if (met) Icons.Filled.Check else Icons.Filled.Lock) {
                            state.select(id)
                        }
                    }
                }
            }
        }
        if (node.state == SkillNode.State.Unlockable) {
            Button(
                onClick = { scope.launch { state.unlock(node) } },
                enabled = state.unlockingNodeId == null,
                colors = ButtonDefaults.buttonColors(containerColor = AtlasColors.accent, contentColor = AtlasColors.onAccent),
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (state.unlockingNodeId == node.id) {
                    CircularProgressIndicator(color = AtlasColors.onAccent, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                } else {
                    Icon(Icons.Filled.LockOpen, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.atlas_unlock), fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
private fun Chip(text: String, tint: Color, icon: ImageVector?, onClick: (() -> Unit)? = null) {
    Row(
        Modifier
            .border(1.dp, tint.copy(alpha = 0.5f), CircleShape)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        icon?.let { Icon(it, contentDescription = null, tint = tint, modifier = Modifier.size(12.dp)) }
        Text(text, color = tint, fontSize = 12.sp, fontWeight = FontWeight.Medium, maxLines = 1)
    }
}

@Composable
private fun stateLabel(state: SkillNode.State): String = stringResource(
    when (state) {
        SkillNode.State.Unlocked -> R.string.atlas_state_unlocked
        SkillNode.State.Unlockable -> R.string.atlas_state_unlockable
        SkillNode.State.Locked -> R.string.atlas_state_locked
        SkillNode.State.PremiumLocked -> R.string.atlas_state_premium
    },
)

private fun stateColor(state: SkillNode.State): Color = when (state) {
    SkillNode.State.Unlocked -> AtlasColors.success
    SkillNode.State.Unlockable -> AtlasColors.accent
    SkillNode.State.Locked -> AtlasColors.textSubtle
    SkillNode.State.PremiumLocked -> AtlasColors.epic
}

private fun laneTitle(branch: String): Int = when (branch) {
    "rush" -> R.string.atlas_lane_flow
    "speed" -> R.string.atlas_lane_speed
    "summit" -> R.string.atlas_lane_summit
    "adventure" -> R.string.atlas_lane_explore
    else -> R.string.atlas_lane_endurance
}

internal fun sportIcon(sport: String): ImageVector = when (sport) {
    "running" -> Icons.Filled.DirectionsRun
    "hiking" -> Icons.Filled.Hiking
    else -> Icons.Filled.DirectionsBike
}

private fun nodeIcon(node: SkillNode): ImageVector {
    if (node.branch == "root") return sportIcon(node.sport)
    if (node.state == SkillNode.State.Unlocked && node.grant.type != "badge") return Icons.Filled.Check
    return when (node.grant.type) {
        "tree_access" -> Icons.Filled.Explore
        "quest_unlock" -> Icons.Filled.Flag
        "world_filter" -> Icons.Filled.Public
        "segment_filter" -> Icons.Filled.Route
        "title" -> Icons.Filled.MilitaryTech
        "badge" -> Icons.Filled.VerifiedUser
        else -> Icons.Filled.RadioButtonUnchecked
    }
}
