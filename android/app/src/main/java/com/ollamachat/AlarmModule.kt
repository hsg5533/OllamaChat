package com.ollamachat

import android.content.Intent
import android.provider.AlarmClock
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

// Sets a system alarm with proper int extras. React Native's Linking.sendIntent
// passes numbers as Double, which AlarmClock.EXTRA_HOUR (int) ignores — so we
// build the intent natively instead.
class AlarmModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "AlarmModule"

  @ReactMethod
  fun setAlarm(hour: Double, minute: Double, message: String, promise: Promise) {
    try {
      val intent =
          Intent(AlarmClock.ACTION_SET_ALARM).apply {
            putExtra(AlarmClock.EXTRA_HOUR, hour.toInt())
            putExtra(AlarmClock.EXTRA_MINUTES, minute.toInt())
            putExtra(AlarmClock.EXTRA_MESSAGE, message)
            putExtra(AlarmClock.EXTRA_SKIP_UI, false)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
      reactApplicationContext.startActivity(intent)
      promise.resolve("ok")
    } catch (e: Exception) {
      promise.reject("ALARM_ERROR", e.message)
    }
  }

  @ReactMethod
  fun setTimer(seconds: Double, message: String, promise: Promise) {
    try {
      val intent =
          Intent(AlarmClock.ACTION_SET_TIMER).apply {
            putExtra(AlarmClock.EXTRA_LENGTH, seconds.toInt())
            putExtra(AlarmClock.EXTRA_MESSAGE, message)
            putExtra(AlarmClock.EXTRA_SKIP_UI, false)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
      reactApplicationContext.startActivity(intent)
      promise.resolve("timer set for ${seconds.toInt()}s")
    } catch (e: Exception) {
      promise.reject("TIMER_ERROR", e.message)
    }
  }
}
