package com.reno.bible

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.content.ContentValues
import android.content.pm.PackageManager
import android.provider.MediaStore
import android.util.Base64
import java.io.File
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

class MainActivity : Activity() {

    private lateinit var web: ReaderWebView
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var ttsFailed = false
    private var pageReady = false
    private var pendingRef: IntArray? = null
    private val handler = Handler(Looper.getMainLooper())
    private val sleepRunnable = Runnable {
        try { tts?.stop() } catch (_: Exception) {}
        js("window.sleepFired && window.sleepFired()")
    }
    private val books = object : LinkedHashMap<String, String>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > 12
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = ReaderWebView(this).apply {
            setBackgroundColor(Color.parseColor("#FBF8F2"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.textZoom = 100
            settings.allowFileAccess = true
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                    val url = req.url.toString()
                    if (url.startsWith("file:///android_asset/")) return false
                    try { startActivity(Intent(Intent.ACTION_VIEW, req.url)) } catch (_: Exception) {}
                    return true
                }
                override fun onPageFinished(view: WebView?, url: String?) {
                    pageReady = true
                    deliverPendingRef()
                }
            }
            addJavascriptInterface(Bridge(), "Bible")
            onReadSelection = { readSelectionFromMenu() }
        }
        setContentView(web)
        takeRef(intent)
        web.loadUrl("file:///android_asset/index.html")
        startTts()
        DailyVerse.reschedule(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        takeRef(intent)
        deliverPendingRef()
    }

    // a tap on the daily-verse notification opens that verse
    private fun takeRef(i: Intent?) {
        val ref = i?.getIntArrayExtra(DailyVerse.EXTRA_REF) ?: return
        pendingRef = ref
        i.removeExtra(DailyVerse.EXTRA_REF)
    }

    private fun deliverPendingRef() {
        val r = pendingRef ?: return
        if (!pageReady) return
        pendingRef = null
        handler.postDelayed({ js("window.openRef && window.openRef(${r[0]}, ${r[1]}, ${r[2]})") }, 400)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_NOTIFY) {
            val ok = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            js("window.notifyPermission && window.notifyPermission($ok)")
        }
    }

    private fun shareOrSaveImage(b64: String, name: String, save: Boolean) {
        val bytes = try { Base64.decode(b64, Base64.DEFAULT) } catch (_: Exception) { return }
        val safe = name.replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank { "verse.png" }
        if (save) {
            val ok = try {
                if (Build.VERSION.SDK_INT >= 29) {
                    val values = ContentValues().apply {
                        put(MediaStore.Images.Media.DISPLAY_NAME, safe)
                        put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                        put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Holy Bible")
                    }
                    val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                    uri != null && contentResolver.openOutputStream(uri)?.use { it.write(bytes); true } == true
                } else {
                    val dir = File(getExternalFilesDir(android.os.Environment.DIRECTORY_PICTURES), "Holy Bible").apply { mkdirs() }
                    File(dir, safe).writeBytes(bytes); true
                }
            } catch (_: Exception) { false }
            js("window.imageSaved && window.imageSaved($ok)")
            return
        }
        val dir = File(cacheDir, "shared").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        File(dir, safe).writeBytes(bytes)
        val uri = ShareProvider.uriFor(this, safe)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "image/png"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(send, "Share verse"))
    }

    // ---------------------------------------------------------------- speech
    private fun startTts() {
        tts = TextToSpeech(applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                ttsReady = true
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(id: String) = js("window.ttsEvent('start', ${q(id)})")
                    override fun onDone(id: String) = js("window.ttsEvent('done', ${q(id)})")
                    @Deprecated("old api")
                    override fun onError(id: String) = js("window.ttsEvent('error', ${q(id)}, 'engine')")
                    override fun onError(id: String, errorCode: Int) =
                        js("window.ttsEvent('error', ${q(id)}, ${q(if (errorCode == TextToSpeech.ERROR_NOT_INSTALLED_YET) "nolang" else "code $errorCode")})")
                    override fun onStop(id: String, interrupted: Boolean) {}
                })
            } else {
                ttsFailed = true
            }
            js("window.voicesChanged && window.voicesChanged()")
        }
    }

    private fun localeOf(tag: String): Locale = Locale.forLanguageTag(tag)

    private fun statusFor(tag: String): String {
        if (ttsFailed) return "noengine"
        val t = tts ?: return "noengine"
        if (!ttsReady) return "unknown"
        val loc = localeOf(tag)
        val r = try { t.isLanguageAvailable(loc) } catch (_: Exception) { TextToSpeech.LANG_NOT_SUPPORTED }
        if (r >= TextToSpeech.LANG_AVAILABLE) return "ok"
        // some engines list a voice without reporting the language as available
        val hasVoice = try {
            t.voices?.any { v -> v.locale.language == loc.language && !v.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) } == true
        } catch (_: Exception) { false }
        return if (hasVoice) "ok" else "missing"
    }

    private fun doSpeakQueue(json: String, rate: Float) {
        val t = tts ?: return
        if (!ttsReady) { js("window.ttsEvent('error', null, 'starting')"); return }
        val items = JSONArray(json)
        t.stop()
        t.setSpeechRate(rate)
        var currentTag = ""
        for (i in 0 until items.length()) {
            val it: JSONObject = items.getJSONObject(i)
            val id = it.getString("id")
            val tag = it.optString("tag", "en-IN")
            if (tag != currentTag) {
                val r = t.setLanguage(localeOf(tag))
                if (r < TextToSpeech.LANG_AVAILABLE && tag.startsWith("en")) t.setLanguage(Locale.US)
                else if (r < TextToSpeech.LANG_AVAILABLE) {
                    js("window.ttsEvent('error', ${q(id)}, 'nolang')")
                    return
                }
                currentTag = tag
            }
            var text = it.getString("text")
            val max = TextToSpeech.getMaxSpeechInputLength() - 10
            if (text.length > max) text = text.substring(0, max)
            t.speak(text, TextToSpeech.QUEUE_ADD, Bundle(), id)
        }
    }

    private fun readSelectionFromMenu() {
        web.evaluateJavascript("(function(){return String(window.getSelection()||'')})()") { raw ->
            val text = try { JSONArray("[$raw]").getString(0) } catch (_: Exception) { "" }
            js("window.readSelection(${q(text)})")
        }
    }

    // ---------------------------------------------------------------- bridge
    inner class Bridge {
        @JavascriptInterface
        fun loadBook(lang: String, book: Int): String {
            val key = "$lang/$book"
            synchronized(books) { books[key]?.let { return it } }
            val name = "data/$lang/%02d.json".format(book)
            val text = try { assets.open(name).bufferedReader(Charsets.UTF_8).use { it.readText() } } catch (_: Exception) { "" }
            synchronized(books) { books[key] = text }
            return text
        }

        @JavascriptInterface
        fun loadText(name: String): String =
            if (name.contains("..")) "" else try { assets.open(name).bufferedReader(Charsets.UTF_8).use { it.readText() } } catch (_: Exception) { "" }

        @JavascriptInterface
        fun shareImage(b64: String, name: String, save: Boolean) = runOnUiThread { shareOrSaveImage(b64, name, save) }

        @JavascriptInterface
        fun sleepTimer(ms: Long) = runOnUiThread {
            handler.removeCallbacks(sleepRunnable)
            if (ms > 0) handler.postDelayed(sleepRunnable, ms)
        }

        @JavascriptInterface
        fun setDailyVerse(on: Boolean, hour: Int, minute: Int, lang: String, names: String) =
            DailyVerse.save(this@MainActivity, on, hour, minute, lang, names)

        @JavascriptInterface
        fun askNotifications() = runOnUiThread {
            if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFY)
            }
        }

        @JavascriptInterface
        fun speakQueue(json: String, rate: Float) = runOnUiThread { doSpeakQueue(json, rate) }

        @JavascriptInterface
        fun stopSpeaking() = runOnUiThread { try { tts?.stop() } catch (_: Exception) {} }

        @JavascriptInterface
        fun voiceStatus(tag: String): String = statusFor(tag)

        @JavascriptInterface
        fun copy(text: String) = runOnUiThread {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("Bible", text))
        }

        @JavascriptInterface
        fun share(text: String) = runOnUiThread {
            val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }
            startActivity(Intent.createChooser(send, "Share verse"))
        }

        @JavascriptInterface
        fun openVoiceSettings() = runOnUiThread {
            val tries = listOf(
                Intent("com.android.settings.TTS_SETTINGS"),
                Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA),
                Intent(android.provider.Settings.ACTION_SETTINGS)
            )
            for (i in tries) {
                try { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); break } catch (_: Exception) {}
            }
        }

        @JavascriptInterface
        fun keepAwake(on: Boolean) = runOnUiThread {
            if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }

        @JavascriptInterface
        fun setBars(color: String, dark: Boolean) = runOnUiThread { applyBars(color, dark) }
    }

    @Suppress("DEPRECATION")
    private fun applyBars(color: String, dark: Boolean) {
        val c = try { Color.parseColor(color) } catch (_: Exception) { return }
        window.statusBarColor = c
        window.navigationBarColor = c
        web.setBackgroundColor(c)
        if (Build.VERSION.SDK_INT >= 30) {
            val flags = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (dark) 0 else flags, flags)
        } else {
            var v = window.decorView.systemUiVisibility
            v = if (dark) v and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv() else v or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
            window.decorView.systemUiVisibility = v
        }
    }

    // ---------------------------------------------------------------- lifecycle
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("(window.onBack && window.onBack()) ? 1 : 0") { r ->
            if (r != "1") finish()
        }
    }

    override fun onDestroy() {
        handler.removeCallbacks(sleepRunnable)
        try { tts?.stop(); tts?.shutdown() } catch (_: Exception) {}
        web.destroy()
        super.onDestroy()
    }

    private fun js(code: String) {
        if (!::web.isInitialized) return
        web.post { web.evaluateJavascript(code, null) }
    }

    private fun q(s: String?): String = if (s == null) "null" else JSONObject.quote(s)

    companion object { private const val REQ_NOTIFY = 41 }
}

/** WebView that adds "Read aloud" to the long-press text selection menu. */
class ReaderWebView(context: Context) : WebView(context) {
    var onReadSelection: (() -> Unit)? = null

    override fun startActionMode(callback: ActionMode.Callback, type: Int): ActionMode? =
        super.startActionMode(wrap(callback), type)

    override fun startActionMode(callback: ActionMode.Callback): ActionMode? =
        super.startActionMode(wrap(callback))

    private fun wrap(cb: ActionMode.Callback): ActionMode.Callback {
        val base = cb as? ActionMode.Callback2
        return object : ActionMode.Callback2() {
            override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
                val ok = cb.onCreateActionMode(mode, menu)
                menu.add(Menu.NONE, READ_ID, 0, "Read aloud").setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
                return ok
            }
            override fun onPrepareActionMode(mode: ActionMode, menu: Menu) = cb.onPrepareActionMode(mode, menu)
            override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
                if (item.itemId == READ_ID) {
                    onReadSelection?.invoke()
                    postDelayed({ try { mode.finish() } catch (_: Exception) {} }, 400)
                    return true
                }
                return cb.onActionItemClicked(mode, item)
            }
            override fun onDestroyActionMode(mode: ActionMode) = cb.onDestroyActionMode(mode)
            override fun onGetContentRect(mode: ActionMode, view: View, outRect: android.graphics.Rect) {
                if (base != null) base.onGetContentRect(mode, view, outRect) else super.onGetContentRect(mode, view, outRect)
            }
        }
    }

    companion object { private const val READ_ID = 0x5EAD }
}
