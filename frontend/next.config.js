/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['antd', '@ant-design/icons', 'rc-util', 'rc-pagination', 'rc-picker'],
  async rewrites() {
    return [
      {
        source: '/api-proxy/:path*',
        destination: (process.env.BACKEND_URL || 'http://localhost:3101') + '/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
