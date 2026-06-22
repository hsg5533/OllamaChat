package com.ollamachat

import android.speech.tts.TextToSpeech
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.Locale

// Text-to-speech using Android's built-in TextToSpeech engine (no external lib).
class SpeakModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  private var tts: TextToSpeech? = null
  private var ready = false

  init {
    tts =
        TextToSpeech(reactContext) { status ->
          if (status == TextToSpeech.SUCCESS) {
            tts?.language = Locale.KOREAN
            ready = true
          }
        }
  }

  override fun getName(): String = "SpeakModule"

  @ReactMethod
  fun speak(text: String) {
    if (!ready) {
      return
    }
    tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "ollama-tts")
  }

  @ReactMethod
  fun stop() {
    tts?.stop()
  }

  override fun invalidate() {
    tts?.stop()
    tts?.shutdown()
    tts = null
    super.invalidate()
  }
}
