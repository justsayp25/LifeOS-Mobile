package expo.modules.termuxrun

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The phone's own text-to-speech (the engine chosen in Android's settings, e.g. Samsung) for R.E.N.E.E.'s voice, like OmaLauncher.
// Events to JS as "onTts": { type: ready | unavailable | start | done | error, id }. Sentences are queued, so they play one after another.
class ReneeTtsModule : Module() {
  private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val main = Handler(Looper.getMainLooper())
  private var tts: TextToSpeech? = null
  private var ready = false
  private val pending = ArrayList<Triple<String, String, Float>>()

  private fun emit(type: String, id: String = "") {
    sendEvent("onTts", mapOf("type" to type, "id" to id))
  }

  private fun say(id: String, text: String, rate: Float) {
    val t = tts ?: return
    t.setSpeechRate(rate)
    val b = Bundle()
    val r = t.speak(text, TextToSpeech.QUEUE_ADD, b, id)
    if (r != TextToSpeech.SUCCESS) emit("error", id)
  }

  override fun definition() = ModuleDefinition {
    Name("ReneeTts")
    Events("onTts")

    // Starts the engine (once). Answers with a "ready" or "unavailable" event.
    Function("init") {
      main.post {
        if (tts != null) { emit(if (ready) "ready" else "unavailable"); return@post }
        try {
          tts = TextToSpeech(context) { status ->
            main.post {
              if (status == TextToSpeech.SUCCESS) {
                ready = true
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                  override fun onStart(utteranceId: String?) { emit("start", utteranceId ?: "") }
                  override fun onDone(utteranceId: String?) { emit("done", utteranceId ?: "") }
                  @Deprecated("old callback") override fun onError(utteranceId: String?) { emit("error", utteranceId ?: "") }
                  override fun onError(utteranceId: String?, errorCode: Int) { emit("error", utteranceId ?: "") }
                })
                emit("ready")
                for (p in pending) say(p.first, p.second, p.third)
                pending.clear()
              } else { tts = null; emit("unavailable") }
            }
          }
        } catch (e: Exception) { tts = null; emit("unavailable") }
      }
    }

    Function("speak") { id: String, text: String, rate: Float ->
      main.post { if (ready) say(id, text, rate) else if (tts != null) pending.add(Triple(id, text, rate)) else emit("error", id) }
    }

    Function("stop") {
      main.post { pending.clear(); try { tts?.stop() } catch (e: Exception) { } }
    }
  }
}
