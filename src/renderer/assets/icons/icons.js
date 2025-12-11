/**
 * GhostPad Icon System - Custom Icons Only
 *
 * This system loads icons from the custom-icons directory.
 * NO hardcoded SVG icons - all icons must be uploaded by the user.
 *
 * Icon Directory: src/renderer/assets/icons/custom-icons/
 * See REQUIRED_ICONS.md for list of required icons
 */

// Custom icons storage (loaded from files)
let customIcons = {};
let iconsLoaded = false;

/**
 * Required icons list - used for validation and placeholders
 */
export const REQUIRED_ICONS = {
  // Navigation
  'settings': 'Settings Icon',
  'close': 'Close Icon',

  // Actions
  'camera': 'Camera Icon',
  'send': 'Send Icon',
  'remove': 'Remove Icon',
  'minus': 'Hide Icon',

  // Utility
  'copy': 'Copy Icon',
  'check': 'Check Icon',

  // Providers
  'gemini': 'Gemini Icon',
  'openai': 'OpenAI Icon',
  'anthropic': 'Anthropic Icon',

  // Status
  'error': 'Error Icon',
  'info': 'Info Icon',
  'success': 'Success Icon',
  'warning': 'Warning Icon',

  // UI Navigation
  'chevron-up': 'Chevron Up',
  'chevron-down': 'Chevron Down',
  'chevron-left': 'Chevron Left',
  'chevron-right': 'Chevron Right',

  // Utility
  'arrow-down': 'Arrow Down',
  
  // Optional
  'loading': 'Loading Icon',
  'refresh': 'Refresh Icon',
  'download': 'Download Icon',
  'upload': 'Upload Icon'
};

/**
 * Initialize icon system - load all custom icons from directory
 */
export async function initIcons() {
  try {
    // Load icons via Electron API
    if (window.electronAPI && window.electronAPI.loadCustomIcons) {
      customIcons = await window.electronAPI.loadCustomIcons();
      iconsLoaded = true;
      console.log(`✓ Loaded ${Object.keys(customIcons).length} custom icons`);

      // Check for missing required icons
      const missing = [];
      for (const iconName of Object.keys(REQUIRED_ICONS)) {
        if (!customIcons[iconName]) {
          missing.push(iconName);
        }
      }

      if (missing.length > 0) {
        console.warn(`⚠ Missing ${missing.length} required icons:`, missing);
        console.warn('See: src/renderer/assets/icons/custom-icons/REQUIRED_ICONS.md');
      } else {
        console.log('✓ All required icons loaded successfully');
      }

      return true;
    } else {
      console.error('✗ Icon loading API not available');
      return false;
    }
  } catch (error) {
    console.error('✗ Failed to initialize icons:', error);
    return false;
  }
}

/**
 * Get an icon by name
 * Returns SVG string or placeholder if icon not found
 *
 * @param {string} name - Icon name (without .svg extension)
 * @param {string} className - CSS classes to add to SVG
 * @returns {string} SVG HTML string
 */
export function getIcon(name, className = 'icon-svg') {
  // Check if icons are loaded
  if (!iconsLoaded) {
    return createPlaceholder(name, className);
  }

  // Get icon from loaded custom icons
  let svg = customIcons[name];

  if (!svg) {
    console.warn(`Icon "${name}" not found - using placeholder`);
    return createPlaceholder(name, className);
  }

  // Add class to SVG element
  return svg.trim().replace('<svg', `<svg class="${className}"`);
}

/**
 * Create a placeholder icon when actual icon is missing
 * @param {string} name - Icon name
 * @param {string} className - CSS class
 * @returns {string} Placeholder SVG
 */
function createPlaceholder(name, className) {
  const displayName = REQUIRED_ICONS[name] || name;
  return `
    <svg class="${className} icon-placeholder" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2,2"/>
      <text x="12" y="13" font-size="8" text-anchor="middle" fill="currentColor" opacity="0.5">?</text>
    </svg>
  `.trim();
}

/**
 * Insert icon directly into DOM element
 * @param {HTMLElement} element - Target element
 * @param {string} iconName - Icon name
 * @param {string} className - CSS class
 */
export function insertIcon(element, iconName, className = 'icon-svg') {
  if (!element) {
    console.error('insertIcon: element is null');
    return;
  }
  element.innerHTML = getIcon(iconName, className);
}

/**
 * Add a custom icon at runtime
 * @param {string} name - Icon name (without .svg extension)
 * @param {string} svgContent - SVG content as string
 */
export function addCustomIcon(name, svgContent) {
  customIcons[name] = svgContent;
  console.log(`✓ Custom icon "${name}" added`);
}

/**
 * Get list of all loaded icons
 * @returns {Array<string>} Array of icon names
 */
export function getLoadedIcons() {
  return Object.keys(customIcons);
}

/**
 * Get list of missing required icons
 * @returns {Array<string>} Array of missing icon names
 */
export function getMissingIcons() {
  const missing = [];
  for (const iconName of Object.keys(REQUIRED_ICONS)) {
    if (!customIcons[iconName]) {
      missing.push(iconName);
    }
  }
  return missing;
}

/**
 * Check if a specific icon is loaded
 * @param {string} name - Icon name
 * @returns {boolean} True if icon is loaded
 */
export function hasIcon(name) {
  return !!customIcons[name];
}

// Export for backward compatibility
export const icons = {}; // Empty - all icons come from custom-icons directory

export default {
  initIcons,
  getIcon,
  insertIcon,
  addCustomIcon,
  getLoadedIcons,
  getMissingIcons,
  hasIcon,
  REQUIRED_ICONS
};
