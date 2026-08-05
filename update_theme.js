const fs = require('fs');

let file = fs.readFileSync('views/index.ejs', 'utf-8');

// Replace static tailwind config colors
file = file.replace(/colors:\s*\{[\s\S]*?danger:\s*'#EF4444'\s*\}/, `colors: {
                        base: 'var(--color-base)',
                        surface: 'var(--color-surface)',
                        border: 'var(--color-border)',
                        textMain: 'var(--text-main)',
                        textMuted: 'var(--text-muted)',
                        accent: '#3B82F6',
                        success: '#10B981',
                        warning: '#F59E0B',
                        danger: '#EF4444'
                    }`);

// Inject CSS variables and update style block
file = file.replace(/<style>[\s\S]*?<\/style>/, `<style>
        :root {
            --color-base: #f8fafc;
            --color-surface: #ffffff;
            --color-border: #e2e8f0;
            --text-main: #0f172a;
            --text-muted: #64748b;
        }
        .dark {
            --color-base: #050505;
            --color-surface: #111111;
            --color-border: #262626;
            --text-main: #ffffff;
            --text-muted: #9ca3af;
        }
        body {
            background-color: var(--color-base);
            color: var(--text-main);
            scroll-behavior: smooth;
        }
        .grid-lines {
            background-image: linear-gradient(to right, var(--color-surface) 1px, transparent 1px),
                linear-gradient(to bottom, var(--color-surface) 1px, transparent 1px);
            background-size: 40px 40px;
        }
        .pro-card {
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            transition: all 0.2s ease-in-out;
        }
        .pro-card:hover { border-color: #3B82F6; }
        .active-module { border-color: #3B82F6; background: rgba(59, 130, 246, 0.05); }
        [x-cloak] { display: none !important; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: var(--color-base); }
        ::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #3B82F6; }
    </style>`);

// Add script to prevent FOUC
file = file.replace('<head>', `<head>
    <script>
        const storedTheme = localStorage.getItem('theme');
        if (storedTheme === 'light') {
            document.documentElement.classList.remove('dark');
        }
    </script>`);

// Replace classes
// Except text-white inside buttons which have bg-accent or bg-blue-500
// So we use dark:text-white dark:bg-black etc where appropriate
// We actually just want to change:
file = file.replace(/text-white(?! px-4| font-medium p-3| px-8)/g, 'text-textMain');
// Wait, regex might be too dangerous. Let's use simple string replacements or just inject the CSS override snippet.
// It is vastly safer to inject CSS overrides than trying to regex parse HTML class names.
