/** @type {import('jest').Config} */
module.exports = {
  projects: ["<rootDir>/packages/*"],
  collectCoverageFrom: ["packages/*/src/**/*.{ts,tsx}"],
  coverageDirectory: "<rootDir>/coverage",
  testTimeout: 30000,
};
