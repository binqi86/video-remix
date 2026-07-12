// Electron entry point - fixes module resolution, then loads main.ts via tsx
const path = require('path');
const fs = require('fs');

// Add project root node_modules to Electron's module resolution
const projectRoot = path.resolve(__dirname, '..');
const nodeModulesPath = path.join(projectRoot, 'node_modules');
if (fs.existsSync(nodeModulesPath)) {
  module.paths.push(nodeModulesPath);
}

// Register tsx for TypeScript support
require('tsx');

// Now load our main TypeScript file
require('./main.ts');
