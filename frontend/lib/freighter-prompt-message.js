// Freighter install prompt message helper.
//
// Builds a contextual, human-readable message when the Freighter extension is
// not installed, so every call-to-action uses the same copy.

const FREIGHTER_APP_URL = 'https://www.freighter.app/';

/**
 * Return the standard Freighter install prompt message.
 *
 * @param {string | undefined} action - Optional action name (e.g. 'pay', 'create invoice').
 * @returns {string} Localised install prompt message.
 */
function freighterPromptMessage(action) {
  const verb = action && typeof action === 'string' ? action.trim() : 'continue';
  return `You need the Freighter browser extension before you can ${verb}. Install it from ${FREIGHTER_APP_URL}`;
}

module.exports = { freighterPromptMessage, FREIGHTER_APP_URL };
