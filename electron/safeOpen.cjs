// EXTERNAL LINKS (v0.236.0, round-two R7). Every window hands window.open() to the system browser.
// The app builds all of its own URLs, but only http(s) may ever reach the shell — a file:, javascript:
// or custom-scheme URL is refused and named in the log.
const isSafeExternal = (url) => typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url);
module.exports = { isSafeExternal };
