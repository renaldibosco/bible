package com.reno.bible

import android.app.Activity
import android.app.AlarmManager
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.text.DateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** "Scripture alarm": wakes you with a chime, then reads the verse of the day aloud. */
object ScriptureAlarm {
    private const val PREFS = "scripture_alarm"
    const val ACTION_FIRE = "com.reno.bible.ALARM_FIRE"
    const val ACTION_SNOOZE = "com.reno.bible.ALARM_SNOOZE"
    const val ACTION_STOP = "com.reno.bible.ALARM_STOP"
    const val ACTION_TEST = "com.reno.bible.ALARM_TEST"
    const val SNOOZE_MIN = 5
    const val CHANNEL = "scripture_alarm"

    fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(ctx: Context, json: String) {
        val o = JSONObject(json)
        val days = o.optJSONArray("days") ?: JSONArray()
        var mask = 0
        for (i in 0 until days.length()) mask = mask or (1 shl days.getInt(i))
        prefs(ctx).edit()
            .putBoolean("on", o.optBoolean("on"))
            .putInt("h", o.optInt("h", 6)).putInt("m", o.optInt("m", 0))
            .putInt("days", mask)
            .putString("lang", o.optString("lang", "en"))
            .putString("names", (o.optJSONArray("names") ?: JSONArray()).toString())
            .apply()
        schedule(ctx)
    }

    private fun firePending(ctx: Context, snooze: Boolean): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, if (snooze) 22 else 21,
            Intent(ctx, AlarmReceiver::class.java).setAction(ACTION_FIRE),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

    private fun showPending(ctx: Context): PendingIntent =
        PendingIntent.getActivity(
            ctx, 23, Intent(ctx, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

    /** Next time the alarm should ring, or null if it's off. */
    fun nextTime(ctx: Context): Long? {
        val p = prefs(ctx)
        if (!p.getBoolean("on", false)) return null
        val mask = p.getInt("days", 127)
        if (mask == 0) return null
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, p.getInt("h", 6))
            set(Calendar.MINUTE, p.getInt("m", 0))
            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }
        val now = System.currentTimeMillis() + 5_000
        for (i in 0..7) {
            val dow = cal.get(Calendar.DAY_OF_WEEK) - 1   // 0 = Sunday
            if (cal.timeInMillis > now && (mask shr dow) and 1 == 1) return cal.timeInMillis
            cal.add(Calendar.DAY_OF_YEAR, 1)
        }
        return null
    }

    fun canExact(ctx: Context): Boolean {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        return Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
    }

    private fun setAt(ctx: Context, time: Long, pi: PendingIntent) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        try {
            if (canExact(ctx)) am.setAlarmClock(AlarmManager.AlarmClockInfo(time, showPending(ctx)), pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, time, pi)
        } catch (_: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, time, pi)
        }
    }

    fun schedule(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = firePending(ctx, false)
        am.cancel(pi)
        val t = nextTime(ctx) ?: return
        setAt(ctx, t, pi)
    }

    fun snooze(ctx: Context) {
        setAt(ctx, System.currentTimeMillis() + SNOOZE_MIN * 60_000L, firePending(ctx, true))
    }

    fun cancelSnooze(ctx: Context) {
        (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(firePending(ctx, true))
    }

    fun start(ctx: Context, test: Boolean) {
        val i = Intent(ctx, AlarmService::class.java).setAction(if (test) ACTION_TEST else ACTION_FIRE)
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
    }

    fun greeting(lang: String, book: String, c: Int, v: String): String = when (lang) {
        "ta" -> "காலை வணக்கம். இன்றைய வசனம். $book, அதிகாரம் $c, வசனம் $v."
        "or" -> "ଶୁଭ ସକାଳ। ଆଜିର ପଦ। $book, ଅଧ୍ୟାୟ $c, ପଦ $v।"
        "he" -> "בוקר טוב. הפסוק של היום. $book, פרק $c, פסוק $v."
        else -> "Good morning. Here is today's verse. $book, chapter $c, verse $v."
    }

    fun ui(lang: String): Array<String> = when (lang) {
        "ta" -> arrayOf("இன்றைய வசனம்", "நான் எழுந்துவிட்டேன்", "$SNOOZE_MIN நிமிடம் கழித்து", "வேதத்தில் திற")
        "or" -> arrayOf("ଆଜିର ପଦ", "ମୁଁ ଉଠିଗଲି", "$SNOOZE_MIN ମିନିଟ ପରେ", "ବାଇବଲରେ ଖୋଲନ୍ତୁ")
        "he" -> arrayOf("הפסוק של היום", "התעוררתי", "עוד $SNOOZE_MIN דקות", "פתח בתנ״ך")
        else -> arrayOf("Verse of the day", "I'm awake", "Snooze $SNOOZE_MIN min", "Open in Bible")
    }
}

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            ScriptureAlarm.ACTION_FIRE -> {
                ScriptureAlarm.schedule(ctx)   // line up the next day first
                ScriptureAlarm.start(ctx, false)
            }
        }
    }
}

class AlarmService : Service() {
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var player: MediaPlayer? = null
    private var wake: PowerManager.WakeLock? = null
    private val handler = Handler(Looper.getMainLooper())
    private var rounds = 0
    private var lang = "en"
    private var verse: Array<Any>? = null
    private var running = false

    companion object {
        const val MAX_ROUNDS = 5
        const val GAP_MS = 45_000L
        var current: AlarmService? = null
        var onChange: (() -> Unit)? = null
        fun verseInfo(): Array<Any>? = current?.verse
        fun langNow(): String = current?.lang ?: "en"
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ScriptureAlarm.ACTION_STOP -> { finish(); return START_NOT_STICKY }
            ScriptureAlarm.ACTION_SNOOZE -> { ScriptureAlarm.snooze(this); finish(); return START_NOT_STICKY }
        }
        if (running) return START_NOT_STICKY
        running = true
        current = this
        ScriptureAlarm.cancelSnooze(this)
        loadVerse()
        startForegroundNow()
        wake = (getSystemService(Context.POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "bible:alarm").apply { acquire(6 * 60_000L) }
        tts = TextToSpeech(applicationContext) { st ->
            if (st == TextToSpeech.SUCCESS) {
                ttsReady = true
                tts?.setAudioAttributes(
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
                )
                tts?.setSpeechRate(0.9f)
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(id: String) {}
                    override fun onDone(id: String) { if (id == "end") handler.postDelayed({ round() }, GAP_MS) }
                    @Deprecated("old api") override fun onError(id: String) { handler.postDelayed({ round() }, GAP_MS) }
                })
            }
        }
        vibrate()
        handler.postDelayed({ round() }, 400)
        // stop by itself after a while so it never rings forever
        handler.postDelayed({ finish() }, 6 * 60_000L)
        return START_NOT_STICKY
    }

    private fun loadVerse() {
        val p = ScriptureAlarm.prefs(this)
        lang = p.getString("lang", "en") ?: "en"
        val names = try { JSONArray(p.getString("names", "[]")) } catch (_: Exception) { null }
        verse = try { DailyVerse.today(this, lang, names) } catch (_: Exception) { null }
    }

    private fun startForegroundNow() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(ScriptureAlarm.CHANNEL, "Scripture alarm", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(null, null)
                enableVibration(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
        )
        val full = PendingIntent.getActivity(
            this, 31, Intent(this, AlarmActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        fun action(a: String, code: Int) = PendingIntent.getService(
            this, code, Intent(this, AlarmService::class.java).setAction(a),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val labels = ScriptureAlarm.ui(lang)
        val v = verse
        val title = if (v != null) v[4] as String else labels[0]
        val text = if (v != null) v[3] as String else labels[0]
        val n = Notification.Builder(this, ScriptureAlarm.CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("⏰ $title")
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setCategory(Notification.CATEGORY_ALARM)
            .setOngoing(true)
            .setColor(0xFF7A1F2B.toInt())
            .setFullScreenIntent(full, true)
            .setContentIntent(full)
            .addAction(Notification.Action.Builder(null, labels[2], action(ScriptureAlarm.ACTION_SNOOZE, 32)).build())
            .addAction(Notification.Action.Builder(null, labels[1], action(ScriptureAlarm.ACTION_STOP, 33)).build())
            .build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(2, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else startForeground(2, n)
        // if the phone is unlocked the full-screen intent may only show a banner, so open the alarm screen too
        val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        if (!km.isKeyguardLocked) {
            try { startActivity(Intent(this, AlarmActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {}
        }
    }

    private fun vibrate() {
        try {
            val vib = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            vib.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 400, 250, 400), -1))
        } catch (_: Exception) {}
    }

    private fun round() {
        if (!running) return
        if (rounds >= MAX_ROUNDS) { finish(); return }
        rounds++
        chime { speakVerse() }
    }

    private fun chime(then: () -> Unit) {
        try {
            player?.release()
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            player = MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                setDataSource(this@AlarmService, uri)
                isLooping = false
                setOnCompletionListener { handler.postDelayed({ then() }, 600) }
                setOnErrorListener { _, _, _ -> then(); true }
                prepare()
                start()
            }
            handler.postDelayed({ if (player?.isPlaying == true) { player?.stop(); then() } }, 5000)
        } catch (_: Exception) {
            then()
        }
    }

    private var spoke = false
    private fun speakVerse() {
        if (!running) return
        val t = tts
        if (t == null || !ttsReady) { handler.postDelayed({ speakVerse() }, 800); return }
        var useLang = lang
        var v = verse
        val tag = when (lang) { "ta" -> "ta-IN"; "or" -> "or-IN"; "he" -> "he-IL"; else -> "en-IN" }
        val ok = t.setLanguage(Locale.forLanguageTag(tag)) >= TextToSpeech.LANG_AVAILABLE
        if (!ok) {
            // voice for this language not installed: read the English verse instead
            useLang = "en"
            if (t.setLanguage(Locale.forLanguageTag("en-IN")) < TextToSpeech.LANG_AVAILABLE) t.setLanguage(Locale.US)
            v = try { DailyVerse.today(this, "en", JSONArray(BOOK_EN)) } catch (_: Exception) { null }
        }
        if (v == null) {
            t.speak(if (useLang == "en") "Good morning. Time to wake up." else ScriptureAlarm.ui(useLang)[0], TextToSpeech.QUEUE_FLUSH, Bundle(), "end")
            return
        }
        val ref = v[4] as String
        val book = ref.substringBeforeLast(" ").trim()
        val label = ref.substringAfterLast(":")
        t.speak(ScriptureAlarm.greeting(useLang, book, v[1] as Int, label), TextToSpeech.QUEUE_FLUSH, Bundle(), "intro")
        t.playSilentUtterance(500, TextToSpeech.QUEUE_ADD, "gap")
        t.speak(v[3] as String, TextToSpeech.QUEUE_ADD, Bundle(), "end")
        spoke = true
    }

    private fun finish() {
        running = false
        handler.removeCallbacksAndMessages(null)
        try { tts?.stop(); tts?.shutdown() } catch (_: Exception) {}
        tts = null
        try { player?.stop() } catch (_: Exception) {}
        try { player?.release() } catch (_: Exception) {}
        player = null
        try { if (wake?.isHeld == true) wake?.release() } catch (_: Exception) {}
        current = null
        onChange?.invoke()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        if (running) finish()
        super.onDestroy()
    }
}

private val BOOK_EN = """["Genesis","Exodus","Leviticus","Numbers","Deuteronomy","Joshua","Judges","Ruth","1 Samuel","2 Samuel","1 Kings","2 Kings","1 Chronicles","2 Chronicles","Ezra","Nehemiah","Esther","Job","Psalms","Proverbs","Ecclesiastes","Song of Solomon","Isaiah","Jeremiah","Lamentations","Ezekiel","Daniel","Hosea","Joel","Amos","Obadiah","Jonah","Micah","Nahum","Habakkuk","Zephaniah","Haggai","Zechariah","Malachi","Matthew","Mark","Luke","John","Acts","Romans","1 Corinthians","2 Corinthians","Galatians","Ephesians","Philippians","Colossians","1 Thessalonians","2 Thessalonians","1 Timothy","2 Timothy","Titus","Philemon","Hebrews","James","1 Peter","2 Peter","1 John","2 John","3 John","Jude","Revelation"]"""

/** Full-screen alarm page shown over the lock screen. */
class AlarmActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        @Suppress("DEPRECATION")
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        )
        window.statusBarColor = Color.parseColor("#3E0D15")
        window.navigationBarColor = Color.parseColor("#2A080E")
        build()
        AlarmService.onChange = { handler.post { finish() } }
        if (AlarmService.current == null) handler.postDelayed({ if (AlarmService.current == null) finish() }, 1500)
    }

    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt()

    private fun build() {
        val lang = AlarmService.langNow()
        val v = AlarmService.verseInfo()
        val labels = ScriptureAlarm.ui(lang)
        val gold = Color.parseColor("#E2B769")
        val cream = Color.parseColor("#FBF3E2")
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(28f), dp(56f), dp(28f), dp(32f))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.parseColor("#7E2330"), Color.parseColor("#2A080E")))
        }
        root.addView(TextView(this).apply {
            text = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())
            setTextColor(cream); textSize = 64f; typeface = Typeface.create("serif", Typeface.NORMAL)
            gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = labels[0].uppercase()
            setTextColor(gold); textSize = 13f; letterSpacing = 0.15f; typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER; setPadding(0, dp(18f), 0, dp(14f))
        })
        val scroll = ScrollView(this)
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        box.addView(TextView(this).apply {
            text = if (v != null) v[3] as String else "☀"
            setTextColor(cream); textSize = 24f; typeface = Typeface.create("serif", Typeface.NORMAL)
            setLineSpacing(0f, 1.3f); gravity = Gravity.CENTER
            if (lang == "he") textDirection = View.TEXT_DIRECTION_RTL
        })
        box.addView(TextView(this).apply {
            text = if (v != null) v[4] as String else ""
            setTextColor(gold); textSize = 17f; typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER; setPadding(0, dp(16f), 0, 0)
        })
        scroll.addView(box)
        root.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        fun button(label: String, filled: Boolean, onClick: () -> Unit) = Button(this).apply {
            text = label; isAllCaps = false; textSize = 17f
            setTextColor(if (filled) Color.parseColor("#3E0D15") else cream)
            background = GradientDrawable().apply {
                cornerRadius = dp(28f).toFloat()
                if (filled) setColor(gold) else { setColor(Color.TRANSPARENT); setStroke(dp(1.5f), Color.parseColor("#88FBF3E2")) }
            }
            setOnClickListener { onClick() }
        }
        val lp = { LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56f)).apply { topMargin = dp(12f) } }
        root.addView(button(labels[1], true) { send(ScriptureAlarm.ACTION_STOP); finish() }, lp())
        root.addView(button(labels[2], false) { send(ScriptureAlarm.ACTION_SNOOZE); finish() }, lp())
        root.addView(button(labels[3], false) {
            send(ScriptureAlarm.ACTION_STOP)
            if (v != null) {
                startActivity(Intent(this, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    .putExtra(DailyVerse.EXTRA_REF, intArrayOf(v[0] as Int, v[1] as Int, v[2] as Int)))
            }
            finish()
        }, lp())
        setContentView(root)
    }

    private fun send(action: String) {
        startService(Intent(this, AlarmService::class.java).setAction(action))
    }

    override fun onDestroy() {
        AlarmService.onChange = null
        super.onDestroy()
    }
}
