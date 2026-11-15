package expo.modules.termuxrun

import android.content.Intent
import android.content.pm.PackageManager
import android.os.PowerManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Starts a command inside Termux with its RUN_COMMAND intent.
// Needs `allow-external-apps=true` in ~/.termux/termux.properties and the RUN_COMMAND permission granted to this app.
class TermuxRunModule : Module() {
  private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("TermuxRun")

    AsyncFunction("isInstalled") {
      try {
        context.packageManager.getPackageInfo("com.termux", 0)
        true
      } catch (e: Exception) {
        false
      }
    }

    AsyncFunction("run") { path: String, args: List<String>, workdir: String, background: Boolean ->
      val intent = Intent("com.termux.RUN_COMMAND").apply {
        setClassName("com.termux", "com.termux.app.RunCommandService")
        putExtra("com.termux.RUN_COMMAND_PATH", path)
        putExtra("com.termux.RUN_COMMAND_ARGUMENTS", args.toTypedArray())
        putExtra("com.termux.RUN_COMMAND_WORKDIR", workdir)
        putExtra("com.termux.RUN_COMMAND_BACKGROUND", background)
      }
      context.startService(intent)
      true
    }

    AsyncFunction("hasPermission") {
      context.checkSelfPermission("com.termux.permission.RUN_COMMAND") == PackageManager.PERMISSION_GRANTED
    }

    AsyncFunction("batteryUnrestricted") { pkg: String ->
      val pm = context.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(pkg)
    }

    AsyncFunction("open") {
      val intent = context.packageManager.getLaunchIntentForPackage("com.termux")
      if (intent == null) {
        false
      } else {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        true
      }
    }
  }
}
