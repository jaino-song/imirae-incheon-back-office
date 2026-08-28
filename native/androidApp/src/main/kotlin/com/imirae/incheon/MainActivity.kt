package com.imirae.incheon

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.navigation.compose.rememberNavController
import androidx.navigation.NavHostController
import com.imirae.incheon.notification.NotificationNavigationDecision
import com.imirae.incheon.notification.NotificationNavigationGate
import com.imirae.incheon.deeplink.DeepLinkRouter
import com.imirae.incheon.navigation.AppNavGraph
import com.imirae.incheon.navigation.NotificationNavigation
import com.imirae.incheon.navigation.Routes
import com.imirae.incheon.ui.theme.ImiRaeTheme
import com.imirae.incheon.viewmodel.*
import org.koin.android.ext.android.inject
import org.koin.android.ext.android.get

class MainActivity : ComponentActivity() {
    private val deepLinkRouter: DeepLinkRouter by inject()
    private val authViewModel: AuthViewModel by inject()
    private val navigationGate = NotificationNavigationGate()
    private var navController: NavHostController? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        authViewModel.restoreSession()
        enqueueNotificationIntent(intent)
        setContent {
            ImiRaeTheme {
                val rememberedNavController = rememberNavController()
                val authState by authViewModel.authState.collectAsState()
                AppNavGraph(
                    navController = rememberedNavController,
                    authViewModel = authViewModel,
                    dashboardViewModel = get(),
                    clientListViewModel = get(),
                    clientDetailViewModel = get(),
                    employeeListViewModel = get(),
                    contractListViewModel = get(),
                    messageTemplateViewModel = get(),
                    chatViewModel = get(),
                    fileListViewModel = get(),
                    settingsViewModel = get(),
                    adminViewModel = get(),
                    shouldNavigateToDashboard = {
                        !this@MainActivity.navigationGate.shouldSuppressDefaultDashboardNavigation()
                    },
                    onClearPendingNavigation = {
                        this@MainActivity.navigationGate.clearPendingNavigation()
                    },
                )
                LaunchedEffect(rememberedNavController) {
                    this@MainActivity.navController = rememberedNavController
                    this@MainActivity.flushPendingNavigation()
                }
                LaunchedEffect(authState) {
                    this@MainActivity.navigationGate.onAuthStateChanged(authState)
                    this@MainActivity.flushPendingNavigation()
                }
            }
        }
    }

    /** A notification PendingIntent is delivered here for both cold and warm starts. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        enqueueNotificationIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        // Foreground transitions re-check the shared session policy and use
        // the same synchronized refresh path as API 401 retries.
        authViewModel.onAppResume()
    }

    override fun onDestroy() {
        navigationGate.clearPendingNavigation()
        navController = null
        super.onDestroy()
    }

    private fun enqueueNotificationIntent(intent: Intent?) {
        if (intent == null) {
            navigationGate.clearPendingNavigation()
            return
        }

        val parsedNavigation = NotificationNavigation.parse(intent, deepLinkRouter) ?: run {
            navigationGate.clearPendingNavigation()
            return
        }
        navigationGate.enqueue(parsedNavigation.intent, parsedNavigation.deliveryKey)
        flushPendingNavigation()
    }

    private fun flushPendingNavigation() {
        val controller = navController ?: return
        val decision = navigationGate.consumePendingNavigation() ?: return

        when (decision) {
            is NotificationNavigationDecision.NavigateProtected -> {
                val route = NotificationNavigation.routeFor(decision.intent) ?: run {
                    navigationGate.clearPendingNavigation()
                    return
                }
                controller.navigate(route) {
                    // A protected notification continuation replaces auth screens
                    // so Back cannot reveal Login or branch selection underneath.
                    popUpTo(0) { inclusive = true }
                    // A repeated PendingIntent must not add another copy of
                    // the same destination to the back stack.
                    launchSingleTop = true
                }
            }

            NotificationNavigationDecision.Login -> {
                controller.navigate(Routes.LOGIN) {
                    popUpTo(0) { inclusive = true }
                    launchSingleTop = true
                }
            }

            NotificationNavigationDecision.SelectBranch -> {
                controller.navigate(Routes.SELECT_BRANCH) {
                    popUpTo(0) { inclusive = true }
                    launchSingleTop = true
                }
            }

            NotificationNavigationDecision.Deferred,
            NotificationNavigationDecision.Duplicate,
            NotificationNavigationDecision.Rejected,
            -> Unit
        }
    }
}
