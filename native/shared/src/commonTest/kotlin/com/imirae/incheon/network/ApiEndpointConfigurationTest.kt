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
    fun releaseAcceptsDnsNamesThatBeginWithIpv6PrivatePrefixes() {
        listOf(
            "https://fc-api.company.com",
            "https://fd-api.company.com",
        ).forEach { rawUrl ->
            assertEquals(
                rawUrl,
                ApiEndpointConfiguration.resolve(
                    rawUrl = rawUrl,
                    platform = ApiEndpointPlatform.IOS_DEVICE,
                    buildVariant = ApiBuildVariant.RELEASE,
                ),
            )
        }
    }

    @Test
    fun releaseAcceptsPublicCompressedIpv6LiteralWithBracketedAuthority() {
        assertEquals(
            "https://[2001:db8::1]:443/api",
            ApiEndpointConfiguration.resolve(
                rawUrl = "https://[2001:db8::1]:443/api/",
                platform = ApiEndpointPlatform.IOS_DEVICE,
                buildVariant = ApiBuildVariant.RELEASE,
            ),
        )
    }

    @Test
    fun releaseRejectsPrivateIpv6LiteralFamilies() {
        listOf(
            "https://[fc00::1]",
            "https://[fd12:3456::1]",
            "https://[fe80::1]",
            "https://[fe9f::1]",
            "https://[::1]",
            "https://[0:0:0:0:0:0:0:1]",
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
    fun releaseRejectsScopedLinkLocalIpv6Literals() {
        listOf(
            "https://[fe80::1%25en0]",
            "https://[fe80::1%en0]",
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
    fun releaseRejectsCompressedAndExpandedUnspecifiedIpv6Literals() {
        listOf(
            "https://[::]",
            "https://[0:0:0:0:0:0:0:0]",
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
    fun releaseRejectsIpv4MappedPrivateIpv6Literals() {
        listOf(
            "https://[::ffff:127.0.0.1]",
            "https://[::ffff:10.0.0.1]",
            "https://[::ffff:192.168.1.1]",
            "https://[::ffff:169.254.1.1]",
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
    fun releaseAcceptsIpv4MappedPublicIpv6Literal() {
        assertEquals(
            "https://[::ffff:8.8.8.8]:443/api",
            ApiEndpointConfiguration.resolve(
                rawUrl = "https://[::ffff:8.8.8.8]:443/api/",
                platform = ApiEndpointPlatform.IOS_DEVICE,
                buildVariant = ApiBuildVariant.RELEASE,
            ),
        )
    }

    @Test
    fun releaseAcceptsCanonicalPublicIpv4Literal() {
        assertEquals(
            "https://8.8.8.8:443/api",
            ApiEndpointConfiguration.resolve(
                rawUrl = "https://8.8.8.8:443/api/",
                platform = ApiEndpointPlatform.IOS_DEVICE,
                buildVariant = ApiBuildVariant.RELEASE,
            ),
        )
    }

    @Test
    fun releaseRejectsNonCanonicalNumericIpv4Literals() {
        listOf(
            "https://127.1",
            "https://127.0.1",
            "https://2130706433",
            "https://0x7f000001",
            "https://0177.0.0.1",
            "https://127.000.000.001",
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
    fun malformedBracketedLiteralsFailClosed() {
        listOf(
            "https://[fe80::1%25]",
            "https://[gggg::1]",
            "https://[1:2:3:4:5:6:7]",
            "https://[::ffff:999.1.1.1]",
            "https://[fc-api.company.com]",
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
            "https://169.254.1.1",
            "https://172.16.0.1",
            "https://192.168.1.1",
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
