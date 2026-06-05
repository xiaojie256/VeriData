const { defineConfig } = require("@vue/cli-service");

module.exports = defineConfig({
  transpileDependencies: true,
  lintOnSave: false,
  productionSourceMap: false,

  devServer: {
    port: 8080,
    proxy: {
      "/api": {
        target: process.env.VUE_APP_API_URL || "http://localhost:3000",
        changeOrigin: true,
        xfwd: true, // 🔴 核心修复：强制 Webpack 开发服务器代理透传 X-Forwarded-For 真实物理机 IP 头
        pathRewrite: {
          "^/api": "/api",
        },
      },
    },
  },

  configureWebpack: {
    resolve: {
      alias: {
        "@": require("path").resolve(__dirname, "src"),
      },
    },
  },
});
