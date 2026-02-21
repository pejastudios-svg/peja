/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  
  generateBuildId: async () => {
    return `build-${Date.now()}`;
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
    unoptimized: true,
  },

  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
  
  trailingSlash: true,
};

module.exports = nextConfig;
