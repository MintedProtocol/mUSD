/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/relay", "<rootDir>/frontend/src"],
  moduleNameMapper: {
    "^@/lib/(.*)$": "<rootDir>/frontend/src/lib/$1",
  },
  testMatch: ["**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          // Relax for tests
          noUnusedLocals: false,
          noUnusedParameters: false,
          paths: {
            "@/lib/*": ["frontend/src/lib/*"],
          },
        },
      },
    ],
  },
};
