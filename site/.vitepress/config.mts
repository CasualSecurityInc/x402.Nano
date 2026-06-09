import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(defineConfig({
    title: "x402.NanoSession",
    description: "Feeless, instant machine-to-machine payments via HTTP 402 using Nano cryptocurrency",
    base: '/x402.NanoSession/',
    head: [
        ['meta', { name: 'google-site-verification', content: 'VgY_8BRCQtKfSIeArkhfYHFkP8q5YL9vELKICxFOlmQ' }]
    ],
    srcDir: './gen/docs', // Point to the generated docs folder
    outDir: './gen/dist',
    cacheDir: './gen/.vitepress/cache',
    cleanUrls: true,
    mermaid: {}, // Optional mermaid configuration
    themeConfig: {
        nav: [
            { text: 'Intro', link: '/' },
            { text: 'Protocol', link: '/protocol' },
            { text: 'Demo', link: '/protected' }
        ],

        sidebar: [
            {
                text: 'About',
                items: [
                    { text: 'Intro', link: '/' },
                    { text: 'Protected Demo (legacy)', link: '/protected' }
                ]
            },
            {
                text: 'Specification',
                items: [
                    { text: 'Protocol', link: '/protocol' },
                    { text: 'Track A: nanoTxn', link: '/extensions/track-a-nanotxn' },
                    { text: 'Track B: nanoSignature', link: '/extensions/track-b-nanosignature' }
                ]
            },
            {
                text: 'Live Demos (Rev 8)',
                items: [
                    { text: 'Track A Demo', link: '/demo-track-a' },
                    { text: 'Track B Demo', link: '/demo-track-b' }
                ]
            },
            {
                text: 'Links',
                items: [
                    { text: '↗ GitHub', link: 'https://github.com/CasualSecurityInc/x402.NanoSession' },
                    { text: '↗ x402 Spec', link: 'https://docs.x402.org' },
                    { text: '↗ Nano.org', link: 'https://nano.org' }
                ]
            }
        ],

        socialLinks: [
            { icon: 'github', link: 'https://github.com/CasualSecurityInc/x402.NanoSession' }
        ],

        footer: {
            message: 'Released under the MIT License.',
            copyright: 'Copyright © 2026 Casual Security Inc.'
        }
    }
}))
