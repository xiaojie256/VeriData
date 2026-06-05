const { defineConfig } = require("@vue/cli-service");

module.exports = defineConfig({
  transpileDependencies: true,
  lintOnSave: false,
  productionSourceMap: false,

  devServer: {
    port: 8080,
    proxy: {
      "/api": {
        // 🔴 核心修复：既然运行在 Docker 内部，就利用 Docker DNS 机制直接指向后端的容器服务名 'backend'
        // 彻底丢弃会引发容器自解析死循环的 'localhost'
        target: "http://backend:3000",
        changeOrigin: true,
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
