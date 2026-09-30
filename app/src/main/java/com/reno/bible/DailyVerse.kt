package com.reno.bible

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONArray
import java.time.LocalDate
import java.util.Calendar

/** The morning "verse of the day" notification. */
object DailyVerse {
    const val EXTRA_REF = "com.reno.bible.REF"
    private const val ACTION = "com.reno.bible.DAILY_VERSE"
    private const val CHANNEL = "daily_verse"
    private const val PREFS = "daily_verse"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(ctx: Context, on: Boolean, hour: Int, minute: Int, lang: String, names: String) {
        prefs(ctx).edit()
            .putBoolean("on", on).putInt("h", hour).putInt("m", minute)
            .putString("lang", lang).putString("names", names).apply()
        reschedule(ctx)
    }

    private fun pending(ctx: Context): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, 7,
            Intent(ctx, DailyVerseReceiver::class.java).setAction(ACTION),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

    fun reschedule(ctx: Context, fromTomorrow: Boolean = false) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = pending(ctx)
        am.cancel(pi)
        val p = prefs(ctx)
        if (!p.getBoolean("on", false)) return
        val next = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, p.getInt("h", 7))
            set(Calendar.MINUTE, p.getInt("m", 0))
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
            if (fromTomorrow || timeInMillis <= System.currentTimeMillis()) add(Calendar.DAY_OF_YEAR, 1)
        }
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.timeInMillis, pi)
    }

    private fun readAsset(ctx: Context, name: String): String? =
        try { ctx.assets.open(name).bufferedReader(Charsets.UTF_8).use { it.readText() } } catch (_: Exception) { null }

    private fun numbers(label: String): List<Int> {
        val m = Regex("^(\\d+)(?:-(\\d+))?").find(label) ?: return emptyList()
        val a = m.groupValues[1].toInt()
        val b = m.groupValues[2].toIntOrNull() ?: a
        return (a..b).toList()
    }

    /** Returns [book (1-based), chapter, verse, text, reference] for today, or null. */
    fun today(ctx: Context, lang: String, names: JSONArray?): Array<Any>? {
        val list = JSONArray(readAsset(ctx, "votd.json") ?: return null)
        if (list.length() == 0) return null
        val idx = (LocalDate.now().toEpochDay() % list.length()).toInt()
        val r = list.getJSONArray(idx)
        val b = r.getInt(0); val c = r.getInt(1); val v = r.getInt(2)
        val book = JSONArray(readAsset(ctx, "data/$lang/%02d.json".format(b)) ?: return null)
        if (c - 1 >= book.length()) return null
        val chap = book.getJSONArray(c - 1)
        for (i in 0 until chap.length()) {
            val pair = chap.getJSONArray(i)
            val label = pair.getString(0)
            if (v in numbers(label)) {
                val name = names?.optString(b - 1)?.takeIf { it.isNotBlank() } ?: ""
                return arrayOf<Any>(b, c, v, pair.getString(1), "$name $c:$label".trim())
            }
        }
        return null
    }

    fun show(ctx: Context) {
        val p = prefs(ctx)
        if (!p.getBoolean("on", false)) return
        val day = LocalDate.now().toEpochDay()
        if (p.getLong("lastDay", -1) == day) return
        if (Build.VERSION.SDK_INT >= 33 &&
            ctx.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val lang = p.getString("lang", "en") ?: "en"
        val names = try { JSONArray(p.getString("names", "[]")) } catch (_: Exception) { null }
        val v = today(ctx, lang, names) ?: return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Verse of the day", NotificationManager.IMPORTANCE_DEFAULT)
                .apply { description = "A Bible verse every morning" }
        )
        val open = Intent(ctx, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_REF, intArrayOf(v[0] as Int, v[1] as Int, v[2] as Int))
        val content = PendingIntent.getActivity(
            ctx, 8, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val text = v[3] as String
        val ref = v[4] as String
        val n = Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(ref)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text).setSummaryText("Verse of the day"))
            .setContentIntent(content)
            .setAutoCancel(true)
            .setColor(0xFF7A1F2B.toInt())
            .build()
        nm.notify(1, n)
        p.edit().putLong("lastDay", day).apply()
    }
}

class DailyVerseReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> DailyVerse.reschedule(ctx)
            else -> {
                try { DailyVerse.show(ctx) } catch (_: Exception) {}
                DailyVerse.reschedule(ctx, fromTomorrow = true)
            }
        }
    }
}
