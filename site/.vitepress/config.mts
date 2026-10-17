import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(defineConfig({
    title: "x402.Nano",
    description: "Draft specification for Nano payment mechanisms under x402 v2.",
    base: '/x402.Nano/',
    head: [
        ['meta', { name: 'google-site-verification', content: 'VgY_8BRCQtKfSIeArkhfYHFkP8q5YL9vELKICxFOlmQ' }]
    ],
    srcDir: './gen/docs', // Point to the generated docs folder
    outDir: './gen/dist',
    cacheDir: './gen/.vitepress/cache',
    cleanUrls: true,
    mermaid: {},
    vite: {
        ssr: {
            noExternal: ['nano-rspow-web']
        }
    },
    themeConfig: {
        nav: [
            { text: 'Intro', link: '/' },
            { text: 'Specification', link: '/protocol' },
            // { text: 'Demo', link: '/protected' }
        ],

        sidebar: [
            {
                text: 'About',
                items: [
                    { text: 'Intro', link: '/' },
                    // { text: 'Protected Demo (legacy)', link: '/protected' }
                ]
            },
            {
                text: 'Specification',
                items: [
                    { text: 'Specification', link: '/protocol' },
                    { text: 'Review proposal', link: '/review' },
                    { text: 'One wallet, ten purchases', link: '/execution-model' },
                    { text: 'Track A: nanoTxn', link: '/extensions/track-a-nanotxn' },
                    { text: 'Track B: nanoSignature', link: '/extensions/track-b-nanosignature' },
                    { text: 'Ecosystem', link: '/ecosystem' }
                ]
            },
            {
                text: 'Project status',
                items: [
                    { text: 'Implementation conformance status', link: '/audits/protocol-consistency-audit' }
                ]
            },
            // {
            //     text: 'Live Demos',
            //     items: [
            //         { text: 'Track A Demo', link: '/demo-track-a' },
            //         { text: 'Track B Demo', link: '/demo-track-b' }
            //     ]
            // },
            {
                text: 'Links',
                items: [
                    { text: '↗ GitHub', link: 'https://github.com/CasualSecurityInc/x402.Nano' },
                    { text: '↗ x402.org', link: 'https://www.x402.org/' },
                    { text: '↗ Nano.org', link: 'https://nano.org' }
                ]
            }
        ],

        socialLinks: [
            { icon: 'github', link: 'https://github.com/CasualSecurityInc/x402.Nano' }
        ],

        footer: {
            message: 'Released under the MIT License.',
            copyright: 'Copyright © 2026 Casual Security Inc.'
        }
    }
}))
