const esbuildPlugin = require("craco-esbuild");

module.exports = {
  style: {
    postcss: {
      mode: "file",
    },
  },
  plugins: [{ plugin: esbuildPlugin }],
  webpack: {
    configure: (webpackConfig) => {
      // Remove ESLintWebpackPlugin – linting runs locally/in CI, not during Docker builds
      webpackConfig.plugins = webpackConfig.plugins.filter(
        (p) => p.constructor.name !== "ESLintWebpackPlugin"
      );
      return webpackConfig;
    },
  },
};
