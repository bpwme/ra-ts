import { resolve } from "node:path"
import { defineConfig } from "vite"

export default defineConfig( {
    build: {
        lib: {
            entry: resolve( __dirname, "src/index.ts" ),
            name: "ra-ts",
            fileName: format => `index.${format}.js`,
            formats: [ "es", "cjs", "umd" ]
        },
        sourcemap: true,
        outDir: "dist"
    }
} )
