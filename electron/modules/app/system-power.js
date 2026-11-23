const { execFile } = require("child_process");

function shutdownCommand(platform) {
  if (platform === "win32") return ["shutdown.exe", ["/s", "/t", "0"]];
  if (platform === "linux") return ["systemctl", ["poweroff"]];
  if (platform === "darwin") return ["/usr/bin/osascript", ["-e", 'tell application "System Events" to shut down']];
  return null;
}

function shutdownSystem(platform = process.platform, execute = execFile) {
  const command = shutdownCommand(platform);
  if (!command) return Promise.resolve({ success: false, error: "System shutdown is unavailable on this platform." });
  return new Promise(resolve => {
    execute(command[0], command[1], { windowsHide: true, timeout: 15000 }, error => {
      resolve(error
        ? { success: false, error: "The system could not shut down. Check operating-system permissions and open applications, then try again." }
        : { success: true });
    });
  });
}

function sleepCommand(platform) {
  if (platform === "win32") return ["rundll32.exe", ["powrprof.dll,SetSuspendState", "0,1,0"]];
  if (platform === "linux") return ["systemctl", ["suspend"]];
  if (platform === "darwin") return ["pmset", ["sleepnow"]];
  return null;
}

function sleepSystem(platform = process.platform, execute = execFile) {
  const command = sleepCommand(platform);
  if (!command) return Promise.resolve({ success: false, error: "System sleep is unavailable on this platform." });
  return new Promise(resolve => {
    execute(command[0], command[1], { windowsHide: true, timeout: 15000 }, error => {
      resolve(error
        ? { success: false, error: "The system could not enter sleep mode." }
        : { success: true });
    });
  });
}

module.exports = { shutdownCommand, shutdownSystem, sleepCommand, sleepSystem };
