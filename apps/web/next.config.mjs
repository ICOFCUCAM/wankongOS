/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Compile the shared workspace packages from source (the API is embedded).
  transpilePackages: [
    "@wankong/core",
    "@wankong/agents",
    "@wankong/store",
    "@wankong/workflow",
    "@wankong/knowledge",
    "@wankong/evals",
    "@wankong/api",
  ],
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => {
    // Workspace packages use NodeNext-style ".js" specifiers in TS source;
    // teach webpack to resolve them to .ts files when transpiling.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".js", ".ts", ".tsx"],
    };
    return config;
  },
};

export default nextConfig;
