module.exports = {
  displayName: "aidk-ai-sdk",
  preset: "../../../jest.preset.js", // Shared preset (3 levels up for adapters/ai-sdk)
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.spec.json",
        useESM: true,
      },
    ],
  },
  testMatch: ["**/*.spec.ts", "**/*.spec.tsx"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
};
