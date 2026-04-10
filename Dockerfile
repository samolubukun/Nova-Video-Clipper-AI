FROM node:18-bullseye

WORKDIR /app

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps --ignore-scripts

COPY . .
RUN npm run build

EXPOSE 7860

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=7860

CMD ["npm", "start"]