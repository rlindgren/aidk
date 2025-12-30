module.exports = {
  displayName: "aidk-react",
  preset: "../../jest.preset.js", // Shared preset
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
  moduleNameMapper: {
    // Map internal packages for tests
    "^aidk-client$": "<rootDir>/src/index.ts",
    "^aidk-client/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["**/*.spec.ts", "**/*.spec.tsx"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
};
