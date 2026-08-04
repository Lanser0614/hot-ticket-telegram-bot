// @ts-check

/**
 * @param {string} filePath
 * @returns {boolean}
 */
export function validateDeployPath(filePath) {
  return filePath === 'schema.js'
    || /^handlers\/[^/]+\.js$/.test(filePath)
    || /^lib\/.+\.js$/.test(filePath);
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isAllowedRuntimeImport(value) {
  return value === 'sdk'
    || value === 'schema'
    || value.startsWith('sdk/')
    || value.startsWith('lib/')
    || value.startsWith('handlers/');
}

