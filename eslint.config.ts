import tseslint from "typescript-eslint"

export default tseslint.config(
    // Global ignores
    {
        ignores: [ "**/dist/**", "**/build/**", "**/*.md" ],
    },

    // TypeScript recommended configurations
    ...tseslint.configs.recommended,

    // Custom rules
    {
        files: [ "**/*.ts" ],
        rules: {
            // Style preferences
            "indent": [ "error", 4 ],
            "semi": [ "error", "never" ],
            "quotes": [ "error", "double" ],
            "comma-dangle": [ "error", "only-multiline" ],
            "space-before-function-paren": [ "error", {
                "anonymous": "always",
                "named": "never",
                "asyncArrow": "always"
            } ],
            "key-spacing": [ "error", { "beforeColon": false } ],
            "space-in-parens": [ "error", "always" ],
            "array-bracket-spacing": [ "error", "always" ],
            "object-curly-spacing": [ "error", "always" ],
            "computed-property-spacing": [ "error", "always" ],

            // Enhanced unused vars handling
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    "vars": "all",
                    "varsIgnorePattern": "^_",
                    "args": "after-used",
                    "argsIgnorePattern": "^_",
                    "ignoreRestSiblings": true
                }
            ],
            // Turn off conflicting base rule
            "no-unused-vars": "off",

            "@typescript-eslint/no-explicit-any": "off",

            // Code organization
            // "max-lines": ["warn", { "max": 300, "skipBlankLines": true, "skipComments": true }],
            // "max-lines-per-function": ["warn", { "max": 50, "skipBlankLines": true, "skipComments": true }],

        },
    }, 

    // Test files - more lenient
    {
        files: [ "**/*.spec.ts", "**/*.test.ts" ],
        rules: {
            "@typescript-eslint/no-unused-vars": "off", // Allow unused vars
            "@typescript-eslint/no-explicit-any": "off", // Allow any in tests
            "@typescript-eslint/no-unsafe-assignment": "off", // Allow unsafe assignments
            "@typescript-eslint/no-unsafe-member-access": "off", // Allow unsafe property access
            "max-lines": "off", // Test files can be long
            "max-lines-per-function": "off", // Test functions can be long
        },
    },
)