package com.imirae.incheon.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.imirae.incheon.ui.auth.*
import com.imirae.incheon.ui.clients.*
import com.imirae.incheon.ui.contracts.*
import com.imirae.incheon.ui.dashboard.DashboardScreen
import com.imirae.incheon.ui.employees.EmployeeDetailScreen
import com.imirae.incheon.ui.employees.EmployeeListScreen
import com.imirae.incheon.ui.messages.*
import com.imirae.incheon.ui.chat.ChatScreen
import com.imirae.incheon.ui.files.FileListScreen
import com.imirae.incheon.ui.settings.*
import com.imirae.incheon.ui.admin.AdminFeedbackScreen
import com.imirae.incheon.auth.AuthState
import com.imirae.incheon.viewmodel.*

object Routes {
    const val LOGIN = "login"
    const val REGISTER = "register"
    const val FORGOT_PASSWORD = "forgot-password"
    const val RESET_PASSWORD = "reset-password/{token}"
    const val VERIFY_EMAIL = "verify-email"
    const val SELECT_BRANCH = "select-branch"
    const val DASHBOARD = "dashboard"
    const val CLIENT_LIST = "clients"
    const val CLIENT_DETAIL = "clients/{clientId}"
    const val CLIENT_NEW = "clients/new"
    const val EMPLOYEE_LIST = "employees"
    const val EMPLOYEE_DETAIL = "employees/{employeeId}"
    const val CONTRACT_LIST = "contracts"
    const val CONTRACT_CREATE = "contracts/create"
    const val CONTRACT_DETAIL = "contracts/{documentId}"
    const val MESSAGES = "messages"
    const val MESSAGE_NEW = "messages/new"
    const val MESSAGE_EDIT = "messages/{templateId}/edit"
    const val CHAT = "chat"
    const val FILES = "files"
    const val SETTINGS = "settings"
    const val VOUCHER_PRICES = "settings/voucher-prices"
    const val ADMIN = "admin"

    fun clientDetail(clientId: Int): String = "clients/$clientId"
    fun employeeDetail(employeeId: Int): String = "employees/$employeeId"
    fun contractDetail(documentId: String): String = "contracts/$documentId"
    fun messageEdit(templateId: String): String = "messages/$templateId/edit"
}

@Composable
fun AppNavGraph(
    navController: NavHostController,
    authViewModel: AuthViewModel,
    dashboardViewModel: DashboardViewModel,
    clientListViewModel: ClientListViewModel,
    clientDetailViewModel: ClientDetailViewModel,
    employeeListViewModel: EmployeeListViewModel,
    employeeDetailViewModel: EmployeeDetailViewModel,
    contractListViewModel: ContractListViewModel,
    messageTemplateViewModel: MessageTemplateViewModel,
    chatViewModel: ChatViewModel,
    fileListViewModel: FileListViewModel,
    settingsViewModel: SettingsViewModel,
    adminViewModel: AdminViewModel,
    startDestination: String = Routes.LOGIN,
    modifier: Modifier = Modifier,
    shouldNavigateToDashboard: () -> Boolean = { true },
    onClearPendingNavigation: () -> Unit = {}
) {
    NavHost(navController = navController, startDestination = startDestination, modifier = modifier) {
        // Auth
        composable(Routes.LOGIN) {
            LoginScreen(
                viewModel = authViewModel,
                onNavigateToRegister = { navController.navigate(Routes.REGISTER) },
                onNavigateToForgotPassword = { navController.navigate(Routes.FORGOT_PASSWORD) },
                onNavigateToVerifyEmail = { navController.navigate(Routes.VERIFY_EMAIL) },
                onNavigateToDashboard = { navController.navigate(Routes.DASHBOARD) { popUpTo(Routes.LOGIN) { inclusive = true } } },
                shouldNavigateToDashboard = shouldNavigateToDashboard,
                onNavigateToSelectBranch = { navController.navigate(Routes.SELECT_BRANCH) }
            )
        }
        composable(Routes.REGISTER) {
            RegisterScreen(
                viewModel = authViewModel,
                onNavigateToLogin = { navController.popBackStack() },
                onRegistrationSuccess = { navController.navigate(Routes.VERIFY_EMAIL) }
            )
        }
        composable(Routes.FORGOT_PASSWORD) {
            ForgotPasswordScreen(viewModel = authViewModel, onNavigateBack = { navController.popBackStack() })
        }
        composable(Routes.RESET_PASSWORD, arguments = listOf(navArgument("token") { type = NavType.StringType })) { backStackEntry ->
            val token = backStackEntry.arguments?.getString("token") ?: ""
            ResetPasswordScreen(viewModel = authViewModel, token = token, onNavigateToLogin = { navController.navigate(Routes.LOGIN) { popUpTo(0) } })
        }
        composable(Routes.VERIFY_EMAIL) {
            VerifyEmailScreen(onNavigateToLogin = { navController.navigate(Routes.LOGIN) { popUpTo(0) } }, onResendVerification = { /* TODO */ })
        }
        composable(Routes.SELECT_BRANCH) {
            SelectBranchScreen(
                viewModel = authViewModel,
                onNavigateToDashboard = { navController.navigate(Routes.DASHBOARD) { popUpTo(0) } },
                onNavigateToLogin = {
                    onClearPendingNavigation()
                    authViewModel.logout()
                    navController.navigate(Routes.LOGIN) { popUpTo(0) }
                },
                shouldNavigateToDashboard = shouldNavigateToDashboard,
            )
        }

        // Core screens
        composable(Routes.DASHBOARD) {
            DashboardScreen(
                viewModel = dashboardViewModel,
                onNavigateToClients = { navController.navigate(Routes.CLIENT_LIST) },
                onNavigateToEmployees = { navController.navigate(Routes.EMPLOYEE_LIST) },
                onNavigateToContracts = { navController.navigate(Routes.CONTRACT_LIST) },
                onNavigateToClientDetail = { id -> navController.navigate(Routes.clientDetail(id)) }
            )
        }
        composable(Routes.CLIENT_LIST) {
            ClientListScreen(
                viewModel = clientListViewModel,
                onNavigateToDetail = { id -> navController.navigate(Routes.clientDetail(id)) },
                onNavigateToNew = { navController.navigate(Routes.CLIENT_NEW) }
            )
        }
        composable(Routes.CLIENT_DETAIL, arguments = listOf(navArgument("clientId") { type = NavType.IntType })) { backStackEntry ->
            val arguments = backStackEntry.arguments
            if (arguments == null || !arguments.containsKey("clientId")) return@composable
            val clientId = arguments.getInt("clientId")
            if (clientId <= 0) return@composable
            ClientDetailScreen(viewModel = clientDetailViewModel, clientId = clientId, onNavigateBack = { navController.popBackStack() })
        }
        composable(Routes.CLIENT_NEW) {
            ClientNewScreen(viewModel = clientListViewModel, onNavigateBack = { navController.popBackStack() })
        }
        composable(Routes.EMPLOYEE_LIST) {
            EmployeeListScreen(
                viewModel = employeeListViewModel,
                onNavigateToDetail = { id -> navController.navigate(Routes.employeeDetail(id)) },
            )
        }
        composable(
            Routes.EMPLOYEE_DETAIL,
            arguments = listOf(navArgument("employeeId") { type = NavType.IntType }),
        ) { backStackEntry ->
            val employeeId = backStackEntry.arguments?.getInt("employeeId") ?: return@composable
            if (employeeId <= 0) return@composable
            EmployeeDetailScreen(
                viewModel = employeeDetailViewModel,
                employeeId = employeeId,
                onNavigateBack = { navController.popBackStack() },
            )
        }
        composable(Routes.CONTRACT_LIST) {
            ContractListScreen(
                viewModel = contractListViewModel,
                onNavigateToDetail = { id -> navController.navigate(Routes.contractDetail(id)) },
                onNavigateToCreate = { navController.navigate(Routes.CONTRACT_CREATE) }
            )
        }
        composable(
            Routes.CONTRACT_DETAIL,
            arguments = listOf(navArgument("documentId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val documentId = backStackEntry.arguments?.getString("documentId")?.trim().orEmpty()
            if (documentId.isEmpty()) return@composable
            ContractDetailScreen(
                viewModel = contractListViewModel,
                documentId = documentId,
                onNavigateBack = { navController.popBackStack() },
            )
        }
        composable(Routes.CONTRACT_CREATE) {
            ContractCreationScreen(viewModel = contractListViewModel, onNavigateBack = { navController.popBackStack() })
        }

        // Phase 5: Feature screens
        composable(Routes.MESSAGES) {
            TemplateListScreen(
                viewModel = messageTemplateViewModel,
                onNavigateToNew = { navController.navigate(Routes.MESSAGE_NEW) },
                onNavigateToEdit = { id -> navController.navigate(Routes.messageEdit(id)) }
            )
        }
        composable(Routes.MESSAGE_NEW) {
            TemplateNewScreen(viewModel = messageTemplateViewModel, onNavigateBack = { navController.popBackStack() })
        }
        composable(Routes.MESSAGE_EDIT, arguments = listOf(navArgument("templateId") { type = NavType.StringType })) { backStackEntry ->
            val templateId = backStackEntry.arguments?.getString("templateId") ?: ""
            TemplateEditScreen(viewModel = messageTemplateViewModel, templateId = templateId, onNavigateBack = { navController.popBackStack() })
        }
        composable(Routes.CHAT) {
            ChatScreen(viewModel = chatViewModel)
        }
        composable(Routes.FILES) {
            FileListScreen(viewModel = fileListViewModel)
        }
        composable(Routes.SETTINGS) {
            val authState by authViewModel.authState.collectAsState()
            var logoutRequested by remember { mutableStateOf(false) }

            LaunchedEffect(authState, logoutRequested) {
                if (logoutRequested && authState is AuthState.Unauthenticated) {
                    navController.navigate(Routes.LOGIN) {
                        popUpTo(0) { inclusive = true }
                        launchSingleTop = true
                    }
                }
            }

            SettingsScreen(
                viewModel = settingsViewModel,
                onNavigateToVoucherPrices = { navController.navigate(Routes.VOUCHER_PRICES) },
                onLogout = {
                    if (!logoutRequested) {
                        logoutRequested = true
                        authViewModel.logout()
                    }
                }
            )
        }
        composable(Routes.VOUCHER_PRICES) {
            VoucherPriceScreen(viewModel = settingsViewModel, onNavigateBack = { navController.popBackStack() })
        }
        composable(Routes.ADMIN) {
            AdminFeedbackScreen(viewModel = adminViewModel)
        }
    }
}
