/**
 * UI Helper Functions
 * Utility functions for common UI operations
 */

import { insertIcon } from '../assets/icons/icons.js';

/**
 * Show a toast notification
 * @param {string} message - Toast message
 * @param {string} type - Toast type: 'success', 'error', 'warning', 'info'
 * @param {number} duration - Duration in ms (default 3000)
 */
export function showToast(message, type = 'info', duration = 3000) {
  let toastStack = document.getElementById('toast-stack');
  if (!toastStack) {
    toastStack = document.createElement('div');
    toastStack.id = 'toast-stack';
    toastStack.className = 'toast-stack';
    document.body.appendChild(toastStack);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  
  const iconName = type === 'success' ? 'check' : type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info';

  const iconWrap = document.createElement('span');
  insertIcon(iconWrap, iconName, 'toast-icon');

  const msgEl = document.createElement('span');
  msgEl.className = 'toast-message';
  msgEl.textContent = String(message ?? '');

  toast.appendChild(iconWrap);
  toast.appendChild(msgEl);
  
  toastStack.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);
  
  // Remove after duration
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
      if (toastStack && !toastStack.hasChildNodes()) {
        toastStack.remove();
      }
    }, 300);
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
