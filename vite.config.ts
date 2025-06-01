import { resolve } from "node:path"
import { defineConfig } from "vite"

export default defineConfig( {
    build: {
        lib: {
            entry: resolve( __dirname, "src/index.ts" ),
            name: "RaTs",
            fileName: format => `index.${format === "es" ? "es" : format}.js`,
            formats: [ "es", "cjs" ]
        },
        rollupOptions: {
            external: [ "isomorphic-dompurify", "validator" ],
            output: {
                globals: {
                    "isomorphic-dompurify": "DOMPurify",
                    "validator": "validator"
                }
            }
        },
        sourcemap: true,
        outDir: "dist",
        emptyOutDir: true
    }
} )