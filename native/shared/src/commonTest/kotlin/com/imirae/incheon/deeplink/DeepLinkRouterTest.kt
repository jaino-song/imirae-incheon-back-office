package com.imirae.incheon.deeplink

import kotlin.test.Test
import kotlin.test.assertEquals

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
}
