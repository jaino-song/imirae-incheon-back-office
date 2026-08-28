package com.imirae.incheon

import android.app.Application
import com.imirae.incheon.deeplink.DeepLinkRouter
import com.imirae.incheon.di.androidModule
import com.imirae.incheon.di.sharedModules
import com.imirae.incheon.logging.SafeLogger
import com.imirae.incheon.notification.FCMService
import com.imirae.incheon.notification.NotificationManager
import com.imirae.incheon.network.ApiBuildVariant
import com.imirae.incheon.network.ApiEndpointConfiguration
import com.imirae.incheon.network.ApiEndpointPlatform
import com.imirae.incheon.recording.CallRecordingManager
import com.imirae.incheon.viewmodel.AdminViewModel
import com.imirae.incheon.viewmodel.ChatViewModel
import com.imirae.incheon.viewmodel.ClientDetailViewModel
import com.imirae.incheon.viewmodel.ClientListViewModel
import com.imirae.incheon.viewmodel.ContractListViewModel
import com.imirae.incheon.viewmodel.DashboardViewModel
import com.imirae.incheon.viewmodel.EmployeeListViewModel
import com.imirae.incheon.viewmodel.FileListViewModel
import com.imirae.incheon.viewmodel.MessageTemplateViewModel
import com.imirae.incheon.viewmodel.SettingsViewModel
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.GlobalContext
import org.koin.core.context.startKoin
import org.koin.dsl.module

private val phaseFiveAndSixModule = module {
    single { DashboardViewModel(get(), get(), get()) }
    single { ClientListViewModel(get()) }
    single { ClientDetailViewModel(get()) }
    single { EmployeeListViewModel(get()) }
    single { ContractListViewModel(get()) }

    single { MessageTemplateViewModel(get()) }
    single { ChatViewModel(get()) }
    single { FileListViewModel(get()) }
    single { SettingsViewModel(get()) }
    single { AdminViewModel() }

    single { DeepLinkRouter() }
    single { NotificationManager(get(), get()) }
    single { CallRecordingManager(get()) }
}

class ImiraeApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        SafeLogger.configure(
            environment = if (BuildConfig.DEBUG) {
                SafeLogger.Environment.DEV
            } else {
                SafeLogger.Environment.PROD
            },
            service = SafeLogger.Service.ANDROID_APP
        )

        if (GlobalContext.getOrNull() == null) {
            val apiBaseUrl = ApiEndpointConfiguration.resolve(
                rawUrl = BuildConfig.API_BASE_URL,
                platform = ApiEndpointPlatform.ANDROID_EMULATOR,
                buildVariant = if (BuildConfig.DEBUG) ApiBuildVariant.DEBUG else ApiBuildVariant.RELEASE,
            )
            startKoin {
                androidContext(this@ImiraeApplication)
                properties(mapOf("API_BASE_URL" to apiBaseUrl))
                modules(sharedModules + androidModule + phaseFiveAndSixModule)
            }
        }

        FCMService.createNotificationChannels(this)
        SafeLogger.info(
            eventType = "app.startup",
            context = mapOf("entry_point" to "ImiraeApplication", "koin_started" to true)
        )
    }
}
