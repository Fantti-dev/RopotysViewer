/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx,html}'],
  theme: {
    extend: {
      colors: {
        'cs-bg':      '#0d0f14',
        'cs-surface': '#111420',
        'cs-panel':   '#151a28',
        'cs-card':    '#1a2035',
        'cs-border':  '#1e2130',
        'cs-border2': '#2a2f45',
        'cs-accent':  '#f97316',
        'cs-ct':      '#5b9cf6',
        'cs-t':       '#f97316',
        'cs-green':   '#22c55e',
        'cs-red':     '#ef4444',
        'cs-gray':    '#6b7280',
        'cs-text':    '#e2e8f0',
        'cs-muted':   '#4b5563',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'pill': '9999px',
      }
    }
  },
  plugins: []
}