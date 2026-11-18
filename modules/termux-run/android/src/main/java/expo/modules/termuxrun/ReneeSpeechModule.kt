package expo.modules.termuxrun

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The phone's own speech recognition for R.E.N.E.E.'s conversation mode. It listens while you talk, so the text is ready almost as soon as you stop
// (the page's Whisper has to transcribe a finished recording). Events go to JS as "onSpeech": { type, text, code }.
//   type = ready | speech | end | partial | final | error   (code is Android's SpeechRecognizer error number for "error")
class ReneeSpeechModule : Module() {
  private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val main = Handler(Looper.getMainLooper())
  private var rec: SpeechRecognizer? = null
  private var session = 0

  private fun emit(type: String, text: String = "", code: Int = 0) {
    sendEvent("onSpeech", mapOf("type" to type, "text" to text, "code" to code))
  }

  private fun best(b: Bundle?): String {
    val list = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
    return if (list != null && list.isNotEmpty()) list[0] else ""
  }

  private fun destroy() {
    try { rec?.cancel() } catch (e: Exception) { }
    try { rec?.destroy() } catch (e: Exception) { }
    rec = null
  }

  override fun definition() = ModuleDefinition {
    Name("ReneeSpeech")
    Events("onSpeech")

    Function("isAvailable") {
      SpeechRecognizer.isRecognitionAvailable(context)
    }

    // Everything the recognizer does must happen on the main thread.
    // lang "" = the phone's own language. offline = true asks for the on-device model (private); false lets the phone use the network (the system default).
    Function("start") { lang: String, silenceMs: Int, offline: Boolean ->
      session += 1
      val my = session
      main.post {
        destroy()
        try {
          val r = SpeechRecognizer.createSpeechRecognizer(context)
          rec = r
          r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { if (my == session) emit("ready") }
            override fun onBeginningOfSpeech() { if (my == session) emit("speech") }
            override fun onRmsChanged(rmsdB: Float) { }
            override fun onBufferReceived(buffer: ByteArray?) { }
            override fun onEndOfSpeech() { if (my == session) emit("end") }
            override fun onError(error: Int) { if (my == session) emit("error", "", error) }
            override fun onResults(results: Bundle?) { if (my == session) emit("final", best(results)) }
            override fun onPartialResults(partialResults: Bundle?) { if (my == session) emit("partial", best(partialResults)) }
            override fun onEvent(eventType: Int, params: Bundle?) { }
          })
          val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
          i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          if (lang.isNotEmpty()) i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
          i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
          i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
          i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, offline)
          i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
          i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, silenceMs.toLong())
          i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, silenceMs.toLong())
          r.startListening(i)
        } catch (e: Exception) {
          emit("error", e.message ?: "", -1)
        }
      }
      true
    }

    // "stop" = you are done talking: the recognizer returns what it has. "cancel" = drop it.
    Function("stop") {
      main.post { try { rec?.stopListening() } catch (e: Exception) { } }
      true
    }

    Function("cancel") {
      session += 1
      main.post { destroy() }
      true
    }

    OnDestroy {
      main.post { destroy() }
    }
  }
}
