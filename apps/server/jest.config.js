/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: "ts-jest/presets/default-esm",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          module: "ESNext",
          moduleResolution: "bundler",
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strict: true,
          skipLibCheck: true,
          composite: false,
          declaration: false,
          rootDir: ".",
          ignoreDeprecations: "6.0",
        },
      },
    ],
  },
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts", "!src/index.ts"],
};
