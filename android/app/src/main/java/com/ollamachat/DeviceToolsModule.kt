package com.ollamachat

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.CalendarContract
import android.provider.ContactsContract
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// Self-contained native device tools (no external libraries).
class DeviceToolsModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "DeviceToolsModule"

  @ReactMethod
  fun flashlight(on: Boolean, promise: Promise) {
    try {
      val cm = reactApplicationContext.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val id =
          cm.cameraIdList.firstOrNull {
            cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
          }
      if (id == null) {
        promise.reject("NO_FLASH", "no flashlight on this device")
        return
      }
      cm.setTorchMode(id, on)
      promise.resolve(if (on) "flashlight on" else "flashlight off")
    } catch (e: Exception) {
      promise.reject("FLASH_ERROR", e.message)
    }
  }

  @ReactMethod
  fun vibrate(ms: Double, promise: Promise) {
    try {
      val vibrator =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (reactApplicationContext.getSystemService(Context.VIBRATOR_MANAGER_SERVICE)
                    as VibratorManager)
                .defaultVibrator
          } else {
            @Suppress("DEPRECATION")
            reactApplicationContext.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
          }
      vibrator.vibrate(
          VibrationEffect.createOneShot(ms.toLong(), VibrationEffect.DEFAULT_AMPLITUDE))
      promise.resolve("vibrated ${ms.toInt()}ms")
    } catch (e: Exception) {
      promise.reject("VIBRATE_ERROR", e.message)
    }
  }

  @ReactMethod
  fun setVolume(percent: Double, promise: Promise) {
    try {
      val am = reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
      val level = (percent / 100.0 * max).toInt().coerceIn(0, max)
      am.setStreamVolume(AudioManager.STREAM_MUSIC, level, 0)
      promise.resolve("volume set to ${percent.toInt()}%")
    } catch (e: Exception) {
      promise.reject("VOLUME_ERROR", e.message)
    }
  }

  @ReactMethod
  fun notify(title: String, body: String, promise: Promise) {
    try {
      val ctx = reactApplicationContext
      val channelId = "ollama_default"
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        nm.createNotificationChannel(
            NotificationChannel(
                channelId, "OllamaChat", NotificationManager.IMPORTANCE_DEFAULT))
      }
      val n =
          NotificationCompat.Builder(ctx, channelId)
              .setSmallIcon(ctx.applicationInfo.icon)
              .setContentTitle(title)
              .setContentText(body)
              .setAutoCancel(true)
              .build()
      nm.notify(System.currentTimeMillis().toInt(), n)
      promise.resolve("notification posted")
    } catch (e: Exception) {
      promise.reject("NOTIFY_ERROR", e.message)
    }
  }

  // start: "yyyy-MM-dd HH:mm"
  @ReactMethod
  fun addCalendarEvent(
      title: String,
      start: String,
      durationMinutes: Double,
      location: String,
      promise: Promise
  ) {
    try {
      val fmt = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault())
      val begin = fmt.parse(start)?.time ?: throw IllegalArgumentException("bad start time")
      val end = begin + (durationMinutes.toLong() * 60_000L)
      val intent =
          Intent(Intent.ACTION_INSERT)
              .setData(CalendarContract.Events.CONTENT_URI)
              .putExtra(CalendarContract.Events.TITLE, title)
              .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, begin)
              .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end)
              .putExtra(CalendarContract.Events.EVENT_LOCATION, location)
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
      promise.resolve("opened calendar for '$title'")
    } catch (e: Exception) {
      promise.reject("CALENDAR_ERROR", e.message)
    }
  }

  // Read upcoming events within the next [days] days (needs READ_CALENDAR).
  @ReactMethod
  fun readCalendar(days: Double, promise: Promise) {
    try {
      val now = System.currentTimeMillis()
      val end = now + (days.toLong() * 86_400_000L)
      val proj =
          arrayOf(
              CalendarContract.Events.TITLE,
              CalendarContract.Events.DTSTART,
              CalendarContract.Events.EVENT_LOCATION)
      val sel =
          "${CalendarContract.Events.DTSTART} >= ? AND ${CalendarContract.Events.DTSTART} <= ?"
      val args = arrayOf(now.toString(), end.toString())
      val cursor =
          reactApplicationContext.contentResolver.query(
              CalendarContract.Events.CONTENT_URI,
              proj,
              sel,
              args,
              "${CalendarContract.Events.DTSTART} ASC")
      val fmt = SimpleDateFormat("MM-dd HH:mm", Locale.getDefault())
      val sb = StringBuilder()
      cursor?.use {
        var count = 0
        while (it.moveToNext() && count < 20) {
          val title = it.getString(0) ?: "(no title)"
          val start = it.getLong(1)
          val loc = it.getString(2) ?: ""
          sb.append(fmt.format(Date(start))).append("  ").append(title)
          if (loc.isNotEmpty()) sb.append(" @ ").append(loc)
          sb.append("\n")
          count++
        }
      }
      promise.resolve(if (sb.isEmpty()) "no upcoming events" else sb.toString().trim())
    } catch (e: Exception) {
      promise.reject("CAL_READ_ERROR", e.message)
    }
  }

  // Open the contact editor prefilled (user confirms to save; no write permission).
  @ReactMethod
  fun createContact(name: String, phone: String, email: String, promise: Promise) {
    try {
      val intent =
          Intent(Intent.ACTION_INSERT)
              .setType(ContactsContract.Contacts.CONTENT_TYPE)
              .putExtra(ContactsContract.Intents.Insert.NAME, name)
              .putExtra(ContactsContract.Intents.Insert.PHONE, phone)
              .putExtra(ContactsContract.Intents.Insert.EMAIL, email)
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
      promise.resolve("opened contact editor for $name")
    } catch (e: Exception) {
      promise.reject("CONTACT_ERROR", e.message)
    }
  }
}
