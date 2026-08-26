package com.imirae.incheon.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class ApiEndpointConfigurationTest {
    @Test
    fun androidEmulatorDebugRetainsTheExistingHostAlias() {
        assertEquals(
            "http://10.0.2.2:3001",
            ApiEndpointConfiguration.resolve(
                rawUrl = "http://10.0.2.2:3001/",
                platform = ApiEndpointPlatform.ANDROID_EMULATOR,
                buildVariant = ApiBuildVariant.DEBUG,
            ),
        )
    }

    @Test
    fun androidReleaseRejectsTheEmulatorCleartextEndpoint() {
        assertFailsWith<InvalidApiEndpointConfigurationException> {
            ApiEndpointConfiguration.resolve(
                rawUrl = "http://10.0.2.2:3001",
                platform = ApiEndpointPlatform.ANDROID_EMULATOR,
                buildVariant = ApiBuildVariant.RELEASE,
            )
        }
    }

    @Test
    fun iosSimulatorAcceptsAnExplicitHttpsEndpoint() {
        assertEquals(
            "https://staging.example.test/api",
            ApiEndpointConfiguration.resolve(
                rawUrl = "https://staging.example.test/api/",
                platform = ApiEndpointPlatform.IOS_SIMULATOR,
                buildVariant = ApiBuildVariant.DEBUG,
            ),
        )
    }

    @Test
    fun iosDeviceAcceptsAnExplicitHttpsEndpoint() {
        assertEquals(
            "https://api.imirae-incheon.com",
            ApiEndpointConfiguration.resolve(
                rawUrl = "https://api.imirae-incheon.com",
                platform = ApiEndpointPlatform.IOS_DEVICE,
                buildVariant = ApiBuildVariant.RELEASE,
            ),
        )
    }

    @Test
    fun iosSimulatorRejectsTheAndroidEmulatorAlias() {
        assertFailsWith<InvalidApiEndpointConfigurationException> {
            ApiEndpointConfiguration.resolve(
                rawUrl = "http://10.0.2.2:3001",
                platform = ApiEndpointPlatform.IOS_SIMULATOR,
                buildVariant = ApiBuildVariant.DEBUG,
            )
        }
    }

    @Test
    fun iosDeviceRejectsTheAndroidEmulatorAlias() {
        assertFailsWith<InvalidApiEndpointConfigurationException> {
            ApiEndpointConfiguration.resolve(
                rawUrl = "https://10.0.2.2:3001",
                platform = ApiEndpointPlatform.IOS_DEVICE,
                buildVariant = ApiBuildVariant.RELEASE,
            )
        }
    }

    @Test
    fun iosRejectsCleartextEndpointsEvenForDebugBuilds() {
        assertFailsWith<InvalidApiEndpointConfigurationException> {
            ApiEndpointConfiguration.resolve(
                rawUrl = "http://localhost:3001",
                platform = ApiEndpointPlatform.IOS_SIMULATOR,
                buildVariant = ApiBuildVariant.DEBUG,
            )
        }
    }

    @Test
    fun releaseRejectsMissingConfiguration() {
        assertFailsWith<InvalidApiEndpointConfigurationException> {
            ApiEndpointConfiguration.resolve(
                rawUrl = null,
                platform = ApiEndpointPlatform.IOS_DEVICE,
                buildVariant = ApiBuildVariant.RELEASE,
            )
        }
    }

    @Test
    fun releaseRejectsUnresolvedBuildSetting() {
        assertFailsWith<InvalidApiEndpointConfigurationException> {
            ApiEndpointConfiguration.resolve(
                rawUrl = "$(API_BASE_URL)",
                platform = ApiEndpointPlatform.IOS_DEVICE,
                buildVariant = ApiBuildVariant.RELEASE,
            )
        }
    }

    @Test
    fun releaseRejectsDevelopmentHostsEvenWhenTheyUseHttps() {
        listOf(
            "https://localhost:3001",
            "https://127.0.0.1:3001",
            "https://10.0.2.2:3001",
            "https://10.0.2.2.:3001",
            "https://staging.example.test",
        ).forEach { rawUrl ->
            assertFailsWith<InvalidApiEndpointConfigurationException> {
                ApiEndpointConfiguration.resolve(
                    rawUrl = rawUrl,
                    platform = ApiEndpointPlatform.IOS_DEVICE,
                    buildVariant = ApiBuildVariant.RELEASE,
                )
            }
        }
    }

    @Test
    fun malformedAndUnsupportedEndpointsFailClosed() {
        listOf(
            "",
            "   ",
            "not-a-url",
            "ftp://api.example.test",
            "https://api.example.test?token=secret",
            "https://user:password@api.example.test",
            "https://api.example.test:0",
            "https://api.example.test:65536",
        ).forEach { rawUrl ->
            assertFailsWith<InvalidApiEndpointConfigurationException> {
                ApiEndpointConfiguration.resolve(
                    rawUrl = rawUrl,
                    platform = ApiEndpointPlatform.IOS_SIMULATOR,
                    buildVariant = ApiBuildVariant.DEBUG,
                )
            }
        }
    }

    @Test
    fun resolveOrNullExposesAFailClosedInteropBoundary() {
        assertEquals(
            "https://api.imirae-incheon.com",
            ApiEndpointConfiguration.resolveOrNull(
                rawUrl = "https://api.imirae-incheon.com",
                platform = ApiEndpointPlatform.IOS_DEVICE,
                buildVariant = ApiBuildVariant.RELEASE,
            ),
        )
        assertNull(
            ApiEndpointConfiguration.resolveOrNull(
                rawUrl = "http://10.0.2.2:3001",
                platform = ApiEndpointPlatform.IOS_DEVICE,
                buildVariant = ApiBuildVariant.RELEASE,
            )
        )
    }
}
