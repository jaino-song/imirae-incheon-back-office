package com.imirae.incheon.logging

import android.util.Log

internal actual fun platformLog(level: SafeLogger.Level, message: String) {
    val priority = when (level) {
        SafeLogger.Level.DEBUG -> Log.DEBUG
        SafeLogger.Level.INFO -> Log.INFO
        SafeLogger.Level.WARN -> Log.WARN
        SafeLogger.Level.ERROR, SafeLogger.Level.SECURITY -> Log.ERROR
    }
    Log.println(priority, "Imirae", message)
}
