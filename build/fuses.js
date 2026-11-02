// Runs after the app is packed (before the installer is made). It flips Electron's "fuses": switches baked into
// the app file that turn off ways someone could misuse it, e.g. running it as plain Node.js to execute their own
// code, or attaching a debugger. The app doesn't need any of these.
const path = require("path");
module.exports = async (context) => {
  const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");
  const name = context.packager.appInfo.productFilename;
  const exe = context.electronPlatformName === "win32" ? path.join(context.appOutDir, name + ".exe")
    : path.join(context.appOutDir, context.packager.executableName);
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,                          // can't be used as a Node.js runner
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,      // no debugger attaching
    [FuseV1Options.OnlyLoadAppFromAsar]: true                  // only runs the app's own packed code
  });
  console.log("fuses set on", exe);
};
