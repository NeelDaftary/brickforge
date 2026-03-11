/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Patches os.networkInterfaces() to catch uv_interface_addresses errors
 * (e.g. "Unknown system error 1" in sandboxed/restricted environments).
 * Next.js uses this to display the network URL; on failure we return {} so it falls back to localhost.
 */
const os = require('os');
const original = os.networkInterfaces;
if (original) {
  os.networkInterfaces = function () {
    try {
      return original.call(os);
    } catch (err) {
      console.warn('[BrickForge] os.networkInterfaces() failed, using localhost:', err.message);
      return {};
    }
  };
}
