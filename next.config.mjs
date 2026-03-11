/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fix workspace root when multiple lockfiles exist (e.g. parent directory)
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
