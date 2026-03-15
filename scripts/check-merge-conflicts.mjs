import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIRS = ['src']
const ALLOWED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.md'])
const MARKERS = ['<<<<<<<', '=======', '>>>>>>>']

const skippedDirs = new Set(['node_modules', '.git', 'out', 'dist', 'build'])
const matches = []

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stats = statSync(fullPath)

    if (stats.isDirectory()) {
      if (!skippedDirs.has(entry)) {
        walk(fullPath)
      }
      continue
    }

    if (!ALLOWED_EXTENSIONS.has(extname(entry))) {
      continue
    }

    const content = readFileSync(fullPath, 'utf8')
    const lines = content.split(/\r?\n/)

    lines.forEach((line, index) => {
      if (MARKERS.some((marker) => line.startsWith(marker))) {
        matches.push(`${fullPath.replace(`${ROOT}/`, '')}:${index + 1}: ${line.trim()}`)
      }
    })
  }
}

for (const dir of SCAN_DIRS) {
  walk(join(ROOT, dir))
}

if (matches.length > 0) {
  console.error('❌ Merge conflict markers found. Resolve these before building:')
  matches.forEach((match) => console.error(`  - ${match}`))
  process.exit(1)
}

console.log('✅ No merge conflict markers found in scanned source files.')
