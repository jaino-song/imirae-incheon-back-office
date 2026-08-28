package com.imirae.incheon.deeplink

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DeepLinkRouterTest {
    private val router = DeepLinkRouter()

    @Test
    fun mapsAllowlistedHttpsAndCustomAppLinks() {
        assertEquals(
            NavigationIntent.ClientDetail("client-42"),
            router.route("https://app.imirae-incheon.com/clients/client-42"),
        )
        assertEquals(
            NavigationIntent.MessageTemplateDetail("template-7"),
            router.route("imirae://app/messages/templates/template-7"),
        )
    }

    @Test
    fun rejectsUntrustedHostsAndSchemes() {
        assertEquals(
            NavigationIntent.Unknown,
            router.route("https://evil.example/clients/client-42"),
        )
        assertEquals(
            NavigationIntent.Unknown,
            router.route("http://app.imirae-incheon.com/clients/client-42"),
        )
        assertEquals(
            NavigationIntent.Unknown,
            router.route("imirae://app/clients/../../settings"),
        )
    }

    @Test
    fun emitsOneCanonicalPathForEveryAllowlistedRoute() {
        assertEquals(
            "/clients/client-42",
            router.routePath("https://app.imirae-incheon.com/clients/client-42?source=push"),
        )
        assertEquals(
            "/messages/templates/template-7",
            router.routePath("imirae://app/messages/templates/template-7#detail"),
        )
        assertEquals("/dashboard", router.routePath("imirae://app/dashboard"))
    }

    @Test
    fun canonicalPathRejectsUnknownOrForeignDestinations() {
        assertNull(router.routePath("https://evil.example/settings"))
        assertNull(router.routePath("imirae://app/clients/../../settings"))
        assertNull(router.routePath("imirae://app/unknown"))
    }
}
