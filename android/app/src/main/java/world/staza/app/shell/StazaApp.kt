package world.staza.app.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import world.staza.app.R
import world.staza.app.core.auth.AuthState
import world.staza.app.designsystem.StazaTheme
import world.staza.app.ui.FoundationsScreen
import world.staza.app.ui.PlaceholderScreen

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StazaApp(authState: AuthState) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val destination = backStackEntry?.destination
    val onAddActivity = destination?.route == ADD_ACTIVITY_ROUTE

    Scaffold(
        topBar = {
            if (onAddActivity) {
                CenterAlignedTopAppBar(
                    title = { Text(stringResource(R.string.add_activity_placeholder_title)) },
                    navigationIcon = {
                        IconButton(onClick = { navController.popBackStack() }) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                        }
                    },
                )
            }
        },
        bottomBar = {
            if (!onAddActivity) {
                NavigationBar {
                    TopLevelDestination.entries.forEach { item ->
                        NavigationBarItem(
                            selected = destination?.hierarchy?.any { it.route == item.route } == true,
                            onClick = {
                                navController.navigate(item.route) {
                                    popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(item.icon, contentDescription = null) },
                            label = { Text(stringResource(item.label)) },
                        )
                    }
                }
            }
        },
        floatingActionButton = {
            if (!onAddActivity) {
                FloatingActionButton(onClick = { navController.navigate(ADD_ACTIVITY_ROUTE) }) {
                    Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.add_activity))
                }
            }
        },
    ) { padding: PaddingValues ->
        NavHost(
            navController = navController,
            startDestination = TopLevelDestination.Home.route,
            modifier = Modifier.padding(padding),
        ) {
            TopLevelDestination.entries.forEach { item ->
                composable(item.route) {
                    if (item == TopLevelDestination.More) {
                        FoundationsScreen(authState)
                    } else {
                        PlaceholderScreen(title = stringResource(item.label))
                    }
                }
            }
            composable(ADD_ACTIVITY_ROUTE) {
                PlaceholderScreen(title = stringResource(R.string.add_activity_placeholder_title))
            }
        }
    }
}
