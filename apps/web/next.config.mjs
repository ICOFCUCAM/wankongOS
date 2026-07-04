/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Compile the shared workspace package from source.
  transpilePackages: ["@wankong/core"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
