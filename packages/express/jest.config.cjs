module.exports = {
  displayName: "aidk-express",
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
  testMatch: ["**/*.spec.ts", "**/*.spec.tsx"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
};
