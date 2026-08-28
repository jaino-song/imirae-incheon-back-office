package com.imirae.incheon.navigation

import androidx.compose.runtime.Composable
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
import com.imirae.incheon.ui.employees.EmployeeListScreen
import com.imirae.incheon.ui.messages.*
import com.imirae.incheon.ui.chat.ChatScreen
import com.imirae.incheon.ui.files.FileListScreen
import com.imirae.incheon.ui.settings.*
import com.imirae.incheon.ui.admin.AdminFeedbackScreen
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
    const val CONTRACT_LIST = "contracts"
    const val CONTRACT_CREATE = "contracts/create"
    const val MESSAGES = "messages"
    const val MESSAGE_NEW = "messages/new"
    const val MESSAGE_EDIT = "messages/{templateId}/edit"
    const val CHAT = "chat"
    const val FILES = "files"
    const val SETTINGS = "settings"
    const val VOUCHER_PRICES = "settings/voucher-prices"
    const val ADMIN = "admin"

    fun clientDetail(clientId: String): String = "clients/$clientId"
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
        composable(Routes.CLIENT_DETAIL, arguments = listOf(navArgument("clientId") { type = NavType.StringType })) { backStackEntry ->
            val clientId = backStackEntry.arguments?.getString("clientId") ?: ""
            ClientDetailScreen(viewModel = clientDetailViewModel, clientId = clientId, onNavigateBack = { navController.popBackStack() })
        }
        composable(Routes.CLIENT_NEW) {
            ClientNewScreen(viewModel = clientListViewModel, onNavigateBack = { navController.popBackStack() })
        }
        composable(Routes.EMPLOYEE_LIST) {
            EmployeeListScreen(viewModel = employeeListViewModel, onNavigateToDetail = { /* TODO: Employee detail */ })
        }
        composable(Routes.CONTRACT_LIST) {
            ContractListScreen(
                viewModel = contractListViewModel,
                onNavigateToDetail = { /* TODO: Contract detail */ },
                onNavigateToCreate = { navController.navigate(Routes.CONTRACT_CREATE) }
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
            SettingsScreen(
                viewModel = settingsViewModel,
                onNavigateToVoucherPrices = { navController.navigate(Routes.VOUCHER_PRICES) },
                onLogout = { navController.navigate(Routes.LOGIN) { popUpTo(0) } }
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
