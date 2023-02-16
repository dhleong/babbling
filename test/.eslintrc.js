let project = "test/tsconfig.json";
if (process.cwd().endsWith("test")) {
    project = "../" + project;
}

module.exports = {
    extends: "../.eslintrc",
    parserOptions: {
        project,
    },
    rules: {
        "@typescript-eslint/no-non-null-assertion": 0,
        "@typescript-eslint/no-unused-expressions": 0,
        "@typescript-eslint/no-explicit-any": 0,
        "import/no-extraneous-dependencies": 0,
    },
};
