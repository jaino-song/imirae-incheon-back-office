plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.imirae.incheon"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.imirae.incheon"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:3001\"")
        manifestPlaceholders["KAKAO_NATIVE_APP_KEY"] =
            providers.gradleProperty("KAKAO_NATIVE_APP_KEY").orElse("placeholder").get()
    }
    buildTypes {
        release {
            buildConfigField("String", "API_BASE_URL", "\"https://api.imirae-incheon.com\"")
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlin {
        jvmToolchain(17)
    }
}

dependencies {
    implementation(project(":shared"))
    implementation(platform(libs.compose.bom))
    implementation(libs.activity.compose)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.compose.ui.tooling.preview)
    implementation("androidx.compose.runtime:runtime-saveable")
    implementation(libs.androidx.navigation.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.koin.compose)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.kakao.sdk)
    debugImplementation(libs.compose.ui.tooling)
}
