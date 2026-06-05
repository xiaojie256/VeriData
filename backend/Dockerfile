FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

# 安装全部依赖（含 nodemon 用于开发热重载）
RUN npm install

COPY . .

RUN mkdir -p /app/uploads /app/logs

EXPOSE 3000

CMD ["npm", "start"]
