package com.imirae.incheon.di

import com.imirae.incheon.auth.AuthManager
import com.imirae.incheon.auth.SecureStorage
import com.imirae.incheon.auth.SessionPolicy
import com.imirae.incheon.auth.StepUpAuth
import com.imirae.incheon.data.remote.*
import com.imirae.incheon.deeplink.DeepLinkRouter
import com.imirae.incheon.media.MediaPicker
import com.imirae.incheon.notification.NotificationManager
import com.imirae.incheon.network.ApiClient
import com.imirae.incheon.network.RateLimitHandler
import com.imirae.incheon.viewmodel.AdminViewModel
import com.imirae.incheon.viewmodel.AuthViewModel
import com.imirae.incheon.viewmodel.ChatViewModel
import com.imirae.incheon.viewmodel.FileListViewModel
import com.imirae.incheon.viewmodel.MessageTemplateViewModel
import com.imirae.incheon.viewmodel.SettingsViewModel
import org.koin.core.qualifier.named
import org.koin.dsl.module

val networkModule = module {
    single { RateLimitHandler() }
    single { ApiClient(baseUrl = getProperty("API_BASE_URL"), tokenProviderLazy = lazy { get<AuthManager>() }, rateLimitHandler = get()) }
}

val serviceModule = module {
    single<AuthService> { AuthServiceImpl(get()) }
    single<ClientService> { ClientServiceImpl(get()) }
    single<EmployeeService> { EmployeeServiceImpl(get()) }
    single<DocumentService> { DocumentServiceImpl(get()) }
    single<TemplateService> { TemplateServiceImpl(get()) }
    single<ChatService> { ChatServiceImpl(get()) }
    single<NotificationService> { NotificationServiceImpl(get()) }
    single<FileService> { FileServiceImpl(get()) }
    single<SettingsService> { SettingsServiceImpl(get()) }
}

val authModule = module {
    single {
        AuthManager(
            authService = get(),
            secureStorage = get(),
            apiBaseUrl = getProperty("API_BASE_URL"),
        )
    }
    single { SessionPolicy(get()) }
    single { StepUpAuth(get()) }
    single { AuthViewModel(get()) }
}

val phaseFiveAndSixModule = module {
    single { DeepLinkRouter() }
    single { NotificationManager(get(), get()) }

    single { MessageTemplateViewModel(get()) }
    single { ChatViewModel(get()) }
    single { FileListViewModel(get()) }
    single { SettingsViewModel(get()) }
    single { AdminViewModel() }

    single<MediaPicker> { get(named("platformMediaPicker")) }
    single(named("callRecordingManager")) { get<Any>(named("androidCallRecordingManager")) }
}

val sharedModules = listOf(networkModule, serviceModule, authModule, phaseFiveAndSixModule)
