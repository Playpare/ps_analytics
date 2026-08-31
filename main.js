/**
 * Entry point for the hub document.
 *
 * Import order is the contract: styles first so the shell paints correctly on
 * the frame the theme module's DOMContentLoaded pass lands on, then the theme,
 * then the hub logic that depends on `window.toggleThemeGlobal` existing.
 */

import './src/shared/styles/motion.css';
import './src/hub/hub.css';

import './src/shared/theme.js';
import './src/hub/hub.js';
