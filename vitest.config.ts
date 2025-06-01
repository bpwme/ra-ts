import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig( {
    test: {
        environment: "jsdom",
        globals: true,
        include: [ "**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}" ],
        exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "**/.{idea,git,cache,output,temp}/**",
            "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
        ],
        coverage: {
            provider: "v8",
            reporter: [ "text", "json", "html" ],
            exclude: [
                "coverage/**",
                "dist/**",
                "**/node_modules/**",
                "**/test{,s}/**",
                "**/*.d.ts",
                "**/*.config.*",
                "**/*.test.*",
                "**/*.spec.*",
            ],
            thresholds: {
                global: {
                    branches: 90,
                    functions: 90,
                    lines: 90,
                    statements: 90
                }
            }
        },
        setupFiles: [ "./tests/setup/test-setup.ts" ],
        testTimeout: 10000,
        hookTimeout: 10000,
    },
    resolve: {
        alias: {
            "~": resolve( __dirname, "." ),
            "@": resolve( __dirname, "." ),
        },
    },
} )
