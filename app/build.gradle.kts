plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.reno.bible"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.reno.bible"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    // One fixed key so every new version installs over the old one
    signingConfigs {
        getByName("debug") {
            storeFile = file("bible.keystore")
            storePassword = "holybible123"
            keyAlias = "bible"
            keyPassword = "holybible123"
        }
    }

    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("debug")
        }
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

// Built-in Android APIs only: WebView and TextToSpeech.
