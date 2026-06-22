package com.ollamachat

import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

// Speech-to-text using Android's built-in SpeechRecognizer (no external lib).
class SttModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  private var recognizer: SpeechRecognizer? = null

  override fun getName(): String = "SttModule"

  private fun emit(event: String, data: WritableMap?) {
    reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(event, data)
  }

  @ReactMethod
  fun start(locale: String) {
    UiThreadUtil.runOnUiThread {
      try {
        recognizer?.destroy()
        recognizer = SpeechRecognizer.createSpeechRecognizer(reactApplicationContext)
        recognizer?.setRecognitionListener(
            object : RecognitionListener {
              override fun onResults(results: Bundle) {
                val matches =
                    results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val map = Arguments.createMap()
                map.putString("text", matches?.firstOrNull() ?: "")
                emit("stt_results", map)
              }
              override fun onError(error: Int) {
                val map = Arguments.createMap()
                map.putInt("code", error)
                emit("stt_error", map)
              }
              override fun onEndOfSpeech() = emit("stt_end", null)
              override fun onReadyForSpeech(params: Bundle?) {}
              override fun onBeginningOfSpeech() {}
              override fun onRmsChanged(rms: Float) {}
              override fun onBufferReceived(buffer: ByteArray?) {}
              override fun onPartialResults(partial: Bundle?) {}
              override fun onEvent(eventType: Int, params: Bundle?) {}
            })
        val intent =
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
              putExtra(
                  RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                  RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
              putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
              putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            }
        recognizer?.startListening(intent)
      } catch (e: Exception) {
        val map = Arguments.createMap()
        map.putString("message", e.message)
        emit("stt_error", map)
      }
    }
  }

  @ReactMethod
  fun stop() {
    UiThreadUtil.runOnUiThread { recognizer?.stopListening() }
  }

  // Required so JS NativeEventEmitter doesn't warn.
  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Double) {}

  override fun invalidate() {
    UiThreadUtil.runOnUiThread { recognizer?.destroy() }
    super.invalidate()
  }
}
