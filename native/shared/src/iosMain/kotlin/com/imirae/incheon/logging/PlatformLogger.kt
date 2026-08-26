package com.imirae.incheon.logging

import platform.Foundation.NSLog

internal actual fun platformLog(level: SafeLogger.Level, message: String) {
    NSLog("%@", message)
}
