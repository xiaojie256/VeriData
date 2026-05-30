# 构建阶段
FROM node:18-alpine as build-stage

# 设置字符集环境变量
ENV LANG=zh_CN.UTF-8
ENV LANGUAGE=zh_CN:zh
ENV LC_ALL=zh_CN.UTF-8

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# 生产阶段
FROM nginx:alpine as production-stage

COPY --from=build-stage /app/dist /usr/share/nginx/html

# 复制nginx配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
