FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js drive-midia.js backup-drive.js backup-email.js ./
ENV NODE_ENV=production
CMD ["node", "index.js"]
