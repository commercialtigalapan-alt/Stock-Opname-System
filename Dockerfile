FROM mcr.microsoft.com/playwright:v1.57.0-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production TZ=Asia/Makassar PORT=3000
EXPOSE 3000
CMD ["node", "src/server.mjs"]
