const fs = require('fs');
const path = require('path');

// Find the app/api directory - try common locations
const candidates = [
  path.join(process.cwd(), 'app', 'api'),
  path.join(process.cwd(), '..', 'app', 'api'),
  '/home/user/app/api',
  '/workspace/app/api',
];

// Log cwd for debugging
console.log('CWD:', process.cwd());
console.log('Dir contents:', fs.readdirSync(process.cwd()).join(', '));

let API_DIR = null;
for (const c of candidates) {
  if (fs.existsSync(c)) {
    API_DIR = c;
    break;
  }
}

if (!API_DIR) {
  console.log('Could not find app/api directory. Tried:', candidates.join(', '));
  process.exit(1);
}

console.log('Found API_DIR:', API_DIR);

function getAllRouteFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllRouteFiles(fullPath));
    } else if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
      results.push(fullPath);
    }
  }
  return results;
}

const routeFiles = getAllRouteFiles(API_DIR);
let modified = 0;
let skipped = 0;

for (const filePath of routeFiles) {
  const content = fs.readFileSync(filePath, 'utf-8');
  
  // Skip if already has force-dynamic
  if (content.includes('force-dynamic')) {
    console.log('SKIP (already has force-dynamic): ' + filePath);
    skipped++;
    continue;
  }
  
  // Skip if no GET handler (POST-only routes don't need it)
  if (!content.includes('export async function GET')) {
    console.log('SKIP (no GET handler): ' + filePath);
    skipped++;
    continue;
  }

  // Remove any existing revalidate export
  let newContent = content.replace(/export const revalidate\s*=\s*\d+[^\n]*\n/g, '');
  
  // Find the right place to insert - after the last import statement
  const lines = newContent.split('\n');
  let lastImportIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('import ') || lines[i].startsWith('import{')) {
      lastImportIndex = i;
    }
  }
  
  if (lastImportIndex >= 0) {
    // Insert after the last import
    lines.splice(lastImportIndex + 1, 0, '', 'export const dynamic = "force-dynamic"');
    newContent = lines.join('\n');
    fs.writeFileSync(filePath, newContent, 'utf-8');
    console.log('MODIFIED: ' + filePath);
    modified++;
  } else {
    // No imports found, add at the top
    newContent = 'export const dynamic = "force-dynamic"\n\n' + newContent;
    fs.writeFileSync(filePath, newContent, 'utf-8');
    console.log('MODIFIED (top): ' + filePath);
    modified++;
  }
}

console.log('\nDone! Modified: ' + modified + ', Skipped: ' + skipped + ', Total: ' + routeFiles.length);
