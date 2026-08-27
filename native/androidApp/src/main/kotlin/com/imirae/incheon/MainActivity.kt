package com.imirae.incheon

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.navigation.compose.rememberNavController
import androidx.navigation.NavHostController
import com.imirae.incheon.deeplink.DeepLinkRouter
import com.imirae.incheon.navigation.AppNavGraph
import com.imirae.incheon.navigation.NotificationNavigation
import com.imirae.incheon.ui.theme.ImiRaeTheme
import com.imirae.incheon.viewmodel.*
import org.koin.android.ext.android.get
import org.koin.android.ext.android.inject

class MainActivity : ComponentActivity() {
    private val deepLinkRouter: DeepLinkRouter by inject()
    private var navController: NavHostController? = null
    private var pendingNavigation: NotificationNavigation.ParsedNavigation? = null
    private val deliveredNavigationKeys = LinkedHashSet<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        enqueueNotificationIntent(intent)
        setContent {
            ImiRaeTheme {
                val rememberedNavController = rememberNavController()
                AppNavGraph(
                    navController = rememberedNavController,
                    authViewModel = get(),
                    dashboardViewModel = get(),
                    clientListViewModel = get(),
                    clientDetailViewModel = get(),
                    employeeListViewModel = get(),
                    contractListViewModel = get(),
                    messageTemplateViewModel = get(),
                    chatViewModel = get(),
                    fileListViewModel = get(),
                    settingsViewModel = get(),
                    adminViewModel = get()
                )
                LaunchedEffect(rememberedNavController) {
                    this@MainActivity.navController = rememberedNavController
                    this@MainActivity.consumePendingNavigation()
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

    private fun enqueueNotificationIntent(intent: Intent?) {
        if (intent == null) return

        val parsedNavigation = NotificationNavigation.parse(intent, deepLinkRouter) ?: return
        if (!deliveredNavigationKeys.add(parsedNavigation.deliveryKey)) return

        // Bound the in-memory dedupe set.  A later notification with the same
        // route can still be delivered after older entries are evicted.
        while (deliveredNavigationKeys.size > MAX_DELIVERED_KEYS) {
            deliveredNavigationKeys.remove(deliveredNavigationKeys.first())
        }

        pendingNavigation = parsedNavigation
        consumePendingNavigation()
    }

    private fun consumePendingNavigation() {
        val controller = navController ?: return
        val navigation = pendingNavigation ?: return
        val route = NotificationNavigation.routeFor(navigation.intent) ?: run {
            pendingNavigation = null
            return
        }

        pendingNavigation = null
        controller.navigate(route) {
            // A repeated PendingIntent must not add another copy of the same
            // destination to the back stack.
            launchSingleTop = true
        }
    }

    private companion object {
        const val MAX_DELIVERED_KEYS = 32
    }
}
