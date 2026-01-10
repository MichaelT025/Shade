/**
 * UI Helper Functions
 * Utility functions for common UI operations
 */

import { getIcon } from '../assets/icons/icons.js';

/**
 * Create a screenshot preview chip
 * @param {string} thumbnailBase64 - Base64 encoded thumbnail image
 * @returns {HTMLElement} Screenshot chip element
 */
export function createScreenshotChip(thumbnailBase64) {
  const chip = document.createElement('div');
  chip.className = 'screenshot-chip';
  chip.id = 'screenshot-chip';
  
  chip.innerHTML = `
    <div class="screenshot-thumbnail">
      <img src="data:image/jpeg;base64,${thumbnailBase64}" alt="Screenshot preview" />
    </div>
    <span class="screenshot-chip-text">Screenshot attached</span>
    <button class="screenshot-remove" id="screenshot-remove" title="Remove screenshot" aria-label="Remove screenshot">
      ${getIcon('close', 'icon-svg-sm')}
    </button>
  `;
  
  return chip;
}

/**
 * Format timestamp for message display
 * @param {Date} date - Date object
 * @returns {string} Formatted timestamp
 */
export function formatTimestamp(date) {
  const now = new Date();
  const diffMins = Math.floor((now - date) / 60000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Show a toast notification
 * @param {string} message - Toast message
 * @param {string} type - Toast type: 'success', 'error', 'warning', 'info'
 * @param {number} duration - Duration in ms (default 3000)
 */
export function showToast(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const iconName = type === 'success' ? 'check' : type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info';
  
  toast.innerHTML = `
    ${getIcon(iconName, 'toast-icon')}
    <span class="toast-message">${message}</span>
  `;
  
  document.body.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);
  
  // Remove after duration
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} Success status
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}
